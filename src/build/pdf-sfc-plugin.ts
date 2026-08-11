import { Buffer } from 'node:buffer'
import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, resolve } from 'node:path'
import {
  babelParse,
  compileScript,
  compileTemplate,
  parse,
  type SFCBlock,
  type BindingMetadata,
  type SFCDescriptor,
  type SFCScriptBlock,
} from '@vue/compiler-sfc'
import { transform as transformWithEsbuild } from 'esbuild'
import { PDF_DEFINITION_PROPERTY } from '../runtime/shared/template'

export type PdfSfcKind = 'component' | 'template'

export type PdfSfcPluginOptions = {
  /** Absolute filenames discovered by the Nuxt module. The map may be updated in development. */
  files: ReadonlyMap<string, PdfSfcKind>
  isProduction?: boolean
  /**
   * Absolute import path to the runtime composables barrel. When a PDF SFC uses
   * an auto-imported PDF composable (e.g. `usePdfPageNumbers`) without importing
   * it, the plugin injects the import from here so the self-contained virtual
   * module resolves it independently of Nuxt's global auto-import transform.
   */
  composablesImport?: string
}

// Auto-imported PDF composables the plugin injects on demand.
const PDF_COMPOSABLES = ['usePdfPageNumbers'] as const

export type PdfSfcTransformResult = {
  code: string
  map: {
    file?: string
    mappings: string
    names: string[]
    sourceRoot?: string
    sources: string[]
    sourcesContent?: string[]
    version: number
  } | null
}

export type PdfSfcPlugin = {
  enforce: 'pre'
  load(id: string): Promise<PdfSfcTransformResult | null>
  name: 'nuxt-pdf:sfc'
  resolveId(source: string, importer?: string): string | null
  transform(source: string, id: string): Promise<PdfSfcTransformResult | null>
}

export class PdfSfcCompileError extends Error {
  readonly column: number
  readonly filename: string
  readonly line: number

  constructor(filename: string, line: number, column: number, message: string) {
    super(`[nuxt-pdf] ${filename}:${line}:${column} ${message}`)
    this.name = 'PdfSfcCompileError'
    this.filename = filename
    this.line = line
    this.column = column
  }
}

const COMPONENT_VARIABLE = '__nuxtPdfComponent'
const VIRTUAL_PREFIX = '\0nuxt-pdf:sfc:'
const VIRTUAL_SUFFIX = '.mjs'
const METADATA_KEYS = new Set([
  'filename',
  'language',
  'maxPasses',
  'sampleData',
  'scenarios',
  'title',
])
const PRODUCTION_METADATA_KEYS = new Set([
  'filename',
  'language',
  'maxPasses',
  'title',
])

type AstLocation = {
  start: { column: number, line: number }
}

type AstNode = {
  [key: string]: unknown
  end?: number | null
  loc?: AstLocation | null
  start?: number | null
  type: string
}

type TemplateAstNode = {
  children?: TemplateAstNode[]
  loc?: AstLocation | null
  name?: string
  props?: TemplateAstNode[]
  tag?: string
  type: number
}

type MacroCall = {
  argument?: AstNode
  block: SFCScriptBlock
  call: AstNode
  statement?: AstNode
}

type ExtractedMetadata = {
  expression: string
  source: string
}

export const createPdfSfcPlugin = (
  options: PdfSfcPluginOptions,
): PdfSfcPlugin => ({
  name: 'nuxt-pdf:sfc',
  enforce: 'pre',
  resolveId(source, importer) {
    const filename = resolvePdfImport(source, importer)

    if (!filename) return null
    if (options.files.has(filename)) return virtualPdfId(filename)

    return importer?.startsWith(VIRTUAL_PREFIX)
      ? resolveRelativeModule(filename)
      : null
  },
  async load(id) {
    const filename = filenameFromVirtualId(id)
    if (!filename) return null

    const kind = options.files.get(filename)
    if (!kind) return null

    return compilePdfSfc(
      await readFile(filename, 'utf8'),
      filename,
      kind,
      options.isProduction,
      options.composablesImport,
    )
  },
  async transform(source, id) {
    if (id.includes('?') || id.startsWith(VIRTUAL_PREFIX)) return null

    const filename = resolve(id)
    const kind = options.files.get(filename)

    if (!kind) return null

    return compilePdfSfc(
      source,
      filename,
      kind,
      options.isProduction,
      options.composablesImport,
    )
  },
})

const MODULE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
] as const

function resolveRelativeModule(filename: string): string | null {
  const extension = extname(filename)
  const candidates = MODULE_EXTENSIONS.includes(
    extension as (typeof MODULE_EXTENSIONS)[number],
  )
    ? [filename]
    : [
        filename,
        ...MODULE_EXTENSIONS.map(extension => `${filename}${extension}`),
        ...MODULE_EXTENSIONS.map(extension => resolve(filename, `index${extension}`)),
      ]

  for (const candidate of candidates) {
    if (candidate.endsWith('.vue') || !existsSync(candidate)) continue

    try {
      if (statSync(candidate).isFile()) return candidate
    }
    catch {
      // The normal module resolver will provide the final missing-import error.
    }
  }

  return null
}

function resolvePdfImport(source: string, importer?: string): string | undefined {
  if (source.startsWith('\0') || source.includes('?')) return undefined

  if (isAbsolute(source)) return resolve(source)
  if (!source.startsWith('.')) return undefined

  const importerFilename = importer?.startsWith(VIRTUAL_PREFIX)
    ? filenameFromVirtualId(importer)
    : importer?.split('?', 1)[0]

  return importerFilename
    ? resolve(dirname(importerFilename), source)
    : undefined
}

function virtualPdfId(filename: string): string {
  return `${VIRTUAL_PREFIX}${Buffer.from(filename).toString('base64url')}${VIRTUAL_SUFFIX}`
}

function filenameFromVirtualId(id: string): string | undefined {
  if (!id.startsWith(VIRTUAL_PREFIX) || !id.endsWith(VIRTUAL_SUFFIX)) return undefined

  const encoded = id.slice(VIRTUAL_PREFIX.length, -VIRTUAL_SUFFIX.length)

  try {
    return Buffer.from(encoded, 'base64url').toString('utf8')
  }
  catch {
    return undefined
  }
}

export async function compilePdfSfc(
  source: string,
  filename: string,
  kind: PdfSfcKind,
  isProduction = false,
  composablesImport?: string,
): Promise<PdfSfcTransformResult> {
  const original = parsePdfSfc(source, filename)

  assertSupportedBlocks(original, filename)
  assertTemplate(original, filename)
  assertSynchronousSetup(original, filename)
  assertSupportedTemplate(original, filename)

  const metadata = extractMetadata(
    source,
    original,
    filename,
    kind,
    isProduction,
  )
  const cleaned = parsePdfSfc(metadata.source, filename)
  const componentCode = compileComponent(cleaned, filename, isProduction)
  const composableImportCode = composableInjection(
    componentCode,
    composablesImport,
  )
  const metadataCode = kind === 'template'
    ? `${COMPONENT_VARIABLE}.${PDF_DEFINITION_PROPERTY} = ${metadata.expression}\n`
    : ''
  const loader = scriptLoader(cleaned)

  try {
    const result = await transformWithEsbuild([
      composableImportCode,
      componentCode,
      metadataCode,
      `export default ${COMPONENT_VARIABLE}`,
    ].filter(Boolean).join('\n'), {
      charset: 'utf8',
      format: 'esm',
      loader,
      sourcefile: filename,
      sourcemap: true,
      sourcesContent: true,
      target: 'es2022',
    })

    return {
      code: result.code,
      map: result.map
        ? JSON.parse(result.map) as PdfSfcTransformResult['map']
        : null,
    }
  }
  catch (error) {
    throw normalizeBuildError(error, filename)
  }
}

function parsePdfSfc(source: string, filename: string): SFCDescriptor {
  const result = parse(source, {
    filename,
    sourceMap: true,
  })

  if (result.errors.length > 0) {
    throw normalizeCompilerError(result.errors[0], filename)
  }

  return result.descriptor
}

function assertSupportedBlocks(descriptor: SFCDescriptor, filename: string): void {
  const style = descriptor.styles[0]
  if (style) {
    throw errorAtBlock(
      filename,
      style,
      '<style> blocks are not supported in PDF components.',
    )
  }

  const customBlock = descriptor.customBlocks[0]
  if (customBlock) {
    throw errorAtBlock(
      filename,
      customBlock,
      `<${customBlock.type}> custom blocks are not supported in PDF components.`,
    )
  }
}

function assertTemplate(descriptor: SFCDescriptor, filename: string): void {
  if (descriptor.template) return

  throw new PdfSfcCompileError(
    filename,
    1,
    1,
    'A PDF component must contain a <template> block.',
  )
}

const FUNCTION_NODE_TYPES = new Set([
  'ArrowFunctionExpression',
  'ClassMethod',
  'ClassPrivateMethod',
  'FunctionDeclaration',
  'FunctionExpression',
  'ObjectMethod',
])

function assertSynchronousSetup(
  descriptor: SFCDescriptor,
  filename: string,
): void {
  const block = descriptor.scriptSetup
  if (!block) return

  const program = parseScriptProgram(block, filename)
  walkAst(program, [], (node, ancestors) => {
    const isTopLevelAwait = node.type === 'AwaitExpression'
      || (node.type === 'ForOfStatement' && node.await === true)
    if (!isTopLevelAwait) return
    if (ancestors.some(parent => FUNCTION_NODE_TYPES.has(parent.type))) return

    throw errorAtNode(
      filename,
      block,
      node,
      'Top-level await is not supported in PDF templates. Load request data before render(props) and pass it through typed props.',
    )
  })
}

function assertSupportedTemplate(
  descriptor: SFCDescriptor,
  filename: string,
): void {
  const block = descriptor.template
  const ast = block?.ast as unknown as TemplateAstNode | undefined
  if (!block || !ast) return

  walkTemplateAst(ast, (node) => {
    if (node.type === 1 && node.tag?.toLowerCase() === 'teleport') {
      throw errorAtTemplateNode(
        filename,
        node,
        'Teleport is not supported in PDF templates because the PDF renderer has no external host target.',
      )
    }

    if (node.type === 7 && node.name === 'show') {
      throw errorAtTemplateNode(
        filename,
        node,
        'v-show is not supported in PDF templates. Use v-if; PDF styles are not browser CSS.',
      )
    }
  })
}

function extractMetadata(
  source: string,
  descriptor: SFCDescriptor,
  filename: string,
  kind: PdfSfcKind,
  isProduction: boolean,
): ExtractedMetadata {
  const calls = [
    ...findMacroCalls(descriptor.script, filename),
    ...findMacroCalls(descriptor.scriptSetup, filename),
  ]

  if (kind === 'component') {
    if (calls[0]) {
      throw errorAtNode(
        filename,
        calls[0].block,
        calls[0].call,
        'definePdf() is only allowed in discovered PDF templates.',
      )
    }

    return { expression: '', source }
  }

  if (calls.length === 0) {
    throw new PdfSfcCompileError(
      filename,
      descriptor.scriptSetup?.loc.start.line ?? 1,
      descriptor.scriptSetup?.loc.start.column ?? 1,
      'A PDF template must contain exactly one top-level definePdf({...}) call.',
    )
  }

  if (calls.length > 1) {
    throw errorAtNode(
      filename,
      calls[1]!.block,
      calls[1]!.call,
      `A PDF template must contain exactly one definePdf() call; found ${calls.length}.`,
    )
  }

  const macro = calls[0]!

  if (macro.block !== descriptor.scriptSetup) {
    throw errorAtNode(
      filename,
      macro.block,
      macro.call,
      'definePdf() must be a top-level statement in <script setup>.',
    )
  }

  if (!macro.statement) {
    throw errorAtNode(
      filename,
      macro.block,
      macro.call,
      'definePdf() must be a standalone top-level statement.',
    )
  }

  if (!macro.argument || macro.argument.type !== 'ObjectExpression') {
    throw errorAtNode(
      filename,
      macro.block,
      macro.call,
      'definePdf() requires one static object argument.',
    )
  }

  const metadataProperties = assertMetadataShape(
    macro.argument,
    filename,
    macro.block,
  )
  assertMetadataHoistable(source, descriptor, filename, macro)

  const blockOffset = macro.block.loc.start.offset
  const argumentStart = requiredOffset(macro.argument.start, filename, macro.block)
  const argumentEnd = requiredOffset(macro.argument.end, filename, macro.block)
  const statementStart = requiredOffset(macro.statement.start, filename, macro.block)
  const statementEnd = requiredOffset(macro.statement.end, filename, macro.block)
  const absoluteStatementStart = blockOffset + statementStart
  const absoluteStatementEnd = blockOffset + statementEnd

  return {
    expression: isProduction
      ? productionMetadataExpression(
          metadataProperties,
          macro.block,
          filename,
        )
      : macro.block.content.slice(argumentStart, argumentEnd),
    source: replaceWithWhitespace(
      source,
      absoluteStatementStart,
      absoluteStatementEnd,
    ),
  }
}

function findMacroCalls(
  block: SFCScriptBlock | null,
  filename: string,
  name = 'definePdf',
): MacroCall[] {
  if (!block) return []

  const program = parseScriptProgram(block, filename)

  const calls: MacroCall[] = []

  walkAst(program, [], (node, ancestors) => {
    if (node.type !== 'CallExpression') return

    const callee = asAstNode(node.callee)
    if (callee?.type !== 'Identifier' || callee.name !== name) return

    const parent = ancestors.at(-1)
    const grandparent = ancestors.at(-2)
    const isTopLevelStatement = parent?.type === 'ExpressionStatement'
      && parent.expression === node
      && grandparent?.type === 'Program'
    const args = Array.isArray(node.arguments) ? node.arguments : []

    calls.push({
      argument: args.length === 1 ? asAstNode(args[0]) : undefined,
      block,
      call: node,
      statement: isTopLevelStatement ? parent : undefined,
    })
  })

  return calls
}

function parseScriptProgram(
  block: SFCScriptBlock,
  filename: string,
): AstNode {
  const plugins: Array<'jsx' | 'typescript'> = []
  if (block.lang === 'ts' || block.lang === 'tsx') plugins.push('typescript')
  if (block.lang === 'jsx' || block.lang === 'tsx') plugins.push('jsx')

  try {
    return babelParse(block.content, {
      plugins,
      sourceType: 'module',
    }).program as unknown as AstNode
  }
  catch (error) {
    throw normalizeScriptParseError(error, filename, block)
  }
}

function assertMetadataHoistable(
  source: string,
  descriptor: SFCDescriptor,
  filename: string,
  macro: MacroCall,
): void {
  const block = descriptor.scriptSetup
  if (!block || !macro.argument || !macro.statement) return

  const blockOffset = block.loc.start.offset
  const argumentStart = requiredOffset(macro.argument.start, filename, block)
  const argumentEnd = requiredOffset(macro.argument.end, filename, block)
  const replacements: Array<{ end: number, start: number, value: string }> = []

  for (const call of findMacroCalls(block, filename, 'defineOptions')) {
    if (!call.statement) continue
    replacements.push({
      start: blockOffset + requiredOffset(call.statement.start, filename, block),
      end: blockOffset + requiredOffset(call.statement.end, filename, block),
      value: '',
    })
  }

  replacements.push({
    start: blockOffset + requiredOffset(macro.statement.start, filename, block),
    end: blockOffset + requiredOffset(macro.statement.end, filename, block),
    value: `defineOptions(${block.content.slice(argumentStart, argumentEnd)})`,
  })

  const validationSource = replacements
    .sort((left, right) => right.start - left.start)
    .reduce(
      (result, replacement) =>
        result.slice(0, replacement.start)
        + replacement.value
        + result.slice(replacement.end),
      source,
    )

  try {
    const validation = parsePdfSfc(validationSource, filename)
    compileScript(validation, {
      id: 'nuxt-pdf-metadata-hoist',
      sourceMap: false,
    })
  }
  catch (error) {
    if (
      errorMessage(error).includes(
        '`defineOptions()` in <script setup> cannot reference locally declared variables',
      )
    ) {
      throw errorAtNode(
        filename,
        block,
        macro.call,
        'definePdf() metadata cannot reference locally declared <script setup> bindings because it is evaluated at module scope. Inline the value or import it from a side-effect-free module.',
      )
    }
  }
}

function assertMetadataShape(
  object: AstNode,
  filename: string,
  block: SFCScriptBlock,
): ReadonlyMap<string, AstNode> {
  const properties = Array.isArray(object.properties) ? object.properties : []
  const keys = new Map<string, AstNode>()

  for (const value of properties) {
    const property = asAstNode(value)

    if (!property || property.type === 'SpreadElement') {
      throw errorAtNode(
        filename,
        block,
        property ?? object,
        'definePdf() metadata cannot contain spread properties.',
      )
    }

    if (property.type !== 'ObjectProperty' && property.type !== 'ObjectMethod') {
      throw errorAtNode(
        filename,
        block,
        property,
        'definePdf() metadata must use ordinary static properties.',
      )
    }

    if (property.computed === true) {
      throw errorAtNode(
        filename,
        block,
        property,
        'definePdf() metadata keys cannot be computed.',
      )
    }

    const key = metadataKey(asAstNode(property.key))

    if (!key || !METADATA_KEYS.has(key)) {
      throw errorAtNode(
        filename,
        block,
        property,
        `Unsupported definePdf() metadata key${key ? ` "${key}"` : ''}.`,
      )
    }

    if (keys.has(key)) {
      throw errorAtNode(
        filename,
        block,
        property,
        `Duplicate definePdf() metadata key "${key}".`,
      )
    }

    if (!isRuntimeMetadataKey(key) && isFunctionProperty(property)) {
      throw errorAtNode(
        filename,
        block,
        property,
        `definePdf() metadata key "${key}" cannot be a function. Functions are only supported for "title" and "filename".`,
      )
    }

    keys.set(key, property)
  }

  return keys
}

function productionMetadataExpression(
  properties: ReadonlyMap<string, AstNode>,
  block: SFCScriptBlock,
  filename: string,
): string {
  const retained = [...properties]
    .filter(([key]) => PRODUCTION_METADATA_KEYS.has(key))
    .map(([, property]) => {
      const start = requiredOffset(property.start, filename, block)
      const end = requiredOffset(property.end, filename, block)
      return block.content.slice(start, end)
    })

  return `{${retained.join(',')}}`
}

function isRuntimeMetadataKey(key: string): boolean {
  return key === 'title' || key === 'filename'
}

function isFunctionProperty(property: AstNode): boolean {
  if (property.type === 'ObjectMethod') return true

  const value = asAstNode(property.value)
  return value?.type === 'ArrowFunctionExpression'
    || value?.type === 'FunctionExpression'
}

function compileComponent(
  descriptor: SFCDescriptor,
  filename: string,
  isProduction: boolean,
): string {
  if (descriptor.scriptSetup) {
    try {
      return compileScript(descriptor, {
        genDefaultAs: COMPONENT_VARIABLE,
        id: 'nuxt-pdf',
        inlineTemplate: true,
        isProd: isProduction,
        sourceMap: true,
        templateOptions: {
          filename,
          isProd: isProduction,
          ssr: false,
          transformAssetUrls: false,
        },
      }).content
    }
    catch (error) {
      throw normalizeCompilerError(error, filename)
    }
  }

  let scriptCode = `const ${COMPONENT_VARIABLE} = { __name: ${JSON.stringify(componentName(filename))} }`
  let bindings: BindingMetadata | undefined

  if (descriptor.script) {
    try {
      const script = compileScript(descriptor, {
        genDefaultAs: COMPONENT_VARIABLE,
        id: 'nuxt-pdf',
        isProd: isProduction,
        sourceMap: true,
      })

      scriptCode = script.content
      bindings = script.bindings
    }
    catch (error) {
      throw normalizeCompilerError(error, filename)
    }
  }

  const template = compileTemplate({
    compilerOptions: { bindingMetadata: bindings },
    filename,
    id: 'nuxt-pdf',
    isProd: isProduction,
    source: descriptor.template!.content,
    ssr: false,
    transformAssetUrls: false,
  })

  if (template.errors.length > 0) {
    throw normalizeCompilerError(template.errors[0], filename)
  }

  return [
    scriptCode,
    template.code,
    `${COMPONENT_VARIABLE}.render = render`,
  ].join('\n')
}

// Build an import statement for the auto-imported PDF composables a compiled
// component references but does not already import. Returns `''` when there is
// nothing to inject or no import path is configured.
function composableInjection(
  componentCode: string,
  composablesImport?: string,
): string {
  if (!composablesImport) return ''

  const needed = PDF_COMPOSABLES.filter((name) => {
    const used = new RegExp(`\\b${name}\\b`).test(componentCode)
    const imported = new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`)
      .test(componentCode)
    return used && !imported
  })

  if (needed.length === 0) return ''

  return `import { ${needed.join(', ')} } from ${JSON.stringify(composablesImport)}`
}

function scriptLoader(descriptor: SFCDescriptor): 'js' | 'jsx' | 'ts' | 'tsx' {
  const languages = [descriptor.script?.lang, descriptor.scriptSetup?.lang]

  if (languages.includes('tsx')) return 'tsx'
  if (languages.includes('ts')) return 'ts'
  if (languages.includes('jsx')) return 'jsx'
  return 'js'
}

function componentName(filename: string): string {
  const basename = filename.replaceAll('\\', '/').split('/').at(-1) ?? 'PdfComponent.vue'
  return basename.replace(/\.vue$/i, '')
}

function metadataKey(node: AstNode | undefined): string | undefined {
  if (!node) return undefined
  if (node.type === 'Identifier' && typeof node.name === 'string') return node.name
  if (node.type === 'StringLiteral' && typeof node.value === 'string') return node.value
  return undefined
}

function walkAst(
  node: AstNode,
  ancestors: AstNode[],
  visit: (node: AstNode, ancestors: AstNode[]) => void,
): void {
  visit(node, ancestors)

  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const child = asAstNode(item)
        if (child) walkAst(child, [...ancestors, node], visit)
      }
      continue
    }

    const child = asAstNode(value)
    if (child) walkAst(child, [...ancestors, node], visit)
  }
}

function walkTemplateAst(
  node: TemplateAstNode,
  visit: (node: TemplateAstNode) => void,
): void {
  visit(node)
  for (const child of node.props ?? []) walkTemplateAst(child, visit)
  for (const child of node.children ?? []) walkTemplateAst(child, visit)
}

function asAstNode(value: unknown): AstNode | undefined {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && typeof value.type === 'string'
    ? value as AstNode
    : undefined
}

function requiredOffset(
  value: number | null | undefined,
  filename: string,
  block: SFCScriptBlock,
): number {
  if (typeof value === 'number') return value

  throw errorAtBlock(
    filename,
    block,
    'Unable to determine the definePdf() source range.',
  )
}

function replaceWithWhitespace(
  source: string,
  start: number,
  end: number,
): string {
  const whitespace = source.slice(start, end).replace(/[^\r\n]/g, ' ')
  return source.slice(0, start) + whitespace + source.slice(end)
}

function errorAtNode(
  filename: string,
  block: SFCScriptBlock,
  node: AstNode,
  message: string,
): PdfSfcCompileError {
  const nodeLine = node.loc?.start.line ?? 1
  const line = block.loc.start.line + nodeLine - 1
  const column = nodeLine === 1
    ? block.loc.start.column + (node.loc?.start.column ?? 0)
    : (node.loc?.start.column ?? 0) + 1

  return new PdfSfcCompileError(filename, line, column, message)
}

function errorAtBlock(
  filename: string,
  block: SFCBlock,
  message: string,
): PdfSfcCompileError {
  return new PdfSfcCompileError(
    filename,
    block.loc.start.line,
    block.loc.start.column,
    message,
  )
}

function errorAtTemplateNode(
  filename: string,
  node: TemplateAstNode,
  message: string,
): PdfSfcCompileError {
  return new PdfSfcCompileError(
    filename,
    node.loc?.start.line ?? 1,
    node.loc?.start.column ?? 1,
    message,
  )
}

function normalizeScriptParseError(
  error: unknown,
  filename: string,
  block: SFCScriptBlock,
): PdfSfcCompileError {
  const location = errorLocation(error)
  const line = block.loc.start.line + (location?.line ?? 1) - 1
  const column = location?.line === 1
    ? block.loc.start.column + (location.column ?? 0)
    : (location?.column ?? 0) + 1

  return new PdfSfcCompileError(filename, line, column, errorMessage(error))
}

function normalizeCompilerError(error: unknown, filename: string): Error {
  if (error instanceof PdfSfcCompileError) return error

  const location = errorLocation(error)
  return new PdfSfcCompileError(
    filename,
    location?.line ?? 1,
    (location?.column ?? 0) + 1,
    errorMessage(error),
  )
}

function normalizeBuildError(error: unknown, filename: string): Error {
  const first = isRecord(error)
    && Array.isArray(error.errors)
    && error.errors.length > 0
    ? error.errors[0]
    : error
  const location = isRecord(first) && isRecord(first.location)
    ? first.location
    : undefined

  return new PdfSfcCompileError(
    filename,
    typeof location?.line === 'number' ? location.line : 1,
    typeof location?.column === 'number' ? location.column + 1 : 1,
    errorMessage(first),
  )
}

function errorLocation(error: unknown): { column: number, line: number } | undefined {
  if (!isRecord(error) || !isRecord(error.loc)) return undefined

  const location = isRecord(error.loc.start) ? error.loc.start : error.loc

  return typeof location.line === 'number' && typeof location.column === 'number'
    ? { column: location.column, line: location.line }
    : undefined
}

function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  if (isRecord(error) && typeof error.text === 'string') return error.text
  if (isRecord(error) && typeof error.message === 'string') return error.message
  return 'Failed to compile PDF component.'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
