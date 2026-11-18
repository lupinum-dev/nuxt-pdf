import { Buffer } from 'node:buffer'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path'
import {
  babelParse,
  compileScript,
  compileTemplate,
  generateCodeFrame,
  parse,
  type SFCBlock,
  type BindingMetadata,
  type CompilerOptions,
  type SFCDescriptor,
  type SFCScriptBlock,
} from '@vue/compiler-sfc'
import remapping, { type SourceMapSegment } from '@jridgewell/remapping'
import { transform as transformWithEsbuild, type Plugin as EsbuildPlugin } from 'esbuild'
import { createUnimport, type Unimport } from 'unimport'
import { PDF_COMPONENT_NAMES } from '../runtime/component-names'
import { EINVOICE_AUTO_IMPORTS } from './generate-authoring-types'
import { displayPath, isLocalModule } from './paths'
import { PDF_BINDINGS_PROPERTY, PDF_CLASSES_PROPERTY, PDF_DEFINITION_PROPERTY, PDF_SOURCE_PROP } from '../runtime/shared/template'
import { PDF_COMPILE_ERROR_PROPERTY, PDF_DEFINITION_SOURCE_PROPERTY, type PdfCompileErrorInfo } from '../runtime/shared/compile-error'
import { isRemovedPdfProp, unsupportedPdfPropMessage } from '../runtime/shared/removed-props'
import {
  compilePdfStyles,
  rewriteTemplateClasses,
  type PdfCompiledStyles,
  type PdfTemplateEdit,
  type PdfTemplateNode,
} from './pdf-style'

export type PdfSfcKind = 'component' | 'template'

export type PdfSfcPluginOptions = {
  /** Absolute filenames discovered by the Nuxt module. The map may be updated in development. */
  files: ReadonlyMap<string, PdfSfcKind>
  isProduction?: boolean
  /**
   * Development only. With it, a file that fails to compile, or that imports
   * a module the bundler cannot resolve, becomes a stub component that fails
   * at render with the message and position, so the Nitro build and the other
   * templates keep working. The callback reports a file when it breaks and
   * when its message changes, not on every rebuild. Without it the build
   * fails.
   */
  onCompileError?: (error: Error) => void
} & PdfSfcCompileOptions

export type PdfSfcCompileOptions = {
  /** Path aliases for `@import` in a `<style>` block (Nuxt's `nuxt.options.alias`). */
  alias?: Readonly<Record<string, string>>
  /**
   * Development build: every `Pdf*` element gets its template source position
   * (`PDF_SOURCE_PROP`), so tree errors and layout warnings can name it.
   * Default `false`; production output must not contain file paths.
   */
  dev?: boolean
  /** Called with every file the compiled module depends on besides the SFC (imported `.css`). */
  onDependency?: (file: string) => void
  /**
   * Root that source positions are relative to, and that a `<style>`
   * `@import` cannot leave. Default: the working directory.
   */
  rootDir?: string
  /**
   * The module that exports the e-invoice functions (`EINVOICE_AUTO_IMPORTS`),
   * auto-imported in templates and components, so the visible PDF can show
   * the totals the embedded XML holds. Without it only the Vue APIs are
   * auto-imported.
   */
  einvoiceImport?: string
}

// One unimport context per e-invoice module path (the Vue preset is shared).
const authoringImportContexts = new Map<string, Unimport>()

// Vue cannot detect Node's filesystem in every ESM build. Imported prop types
// need the same explicit filesystem in metadata validation and compilation.
const compilerFileSystem = {
  fileExists: (file: string) => statSync(file, { throwIfNoEntry: false })?.isFile() ?? false,
  readFile: (file: string) => readFileSync(file, 'utf8'),
}

export type PdfSfcTransformResult = {
  code: string
  map: {
    file?: string
    mappings: string
    names: string[]
    sourceRoot?: string
    sources: string[]
    sourcesContent?: string[]
    version: 3
  } | null
}

type PdfSourceMap = NonNullable<PdfSfcTransformResult['map']>

type CompiledCode = {
  code: string
  map: PdfSourceMap | null
}

/** The part of Rollup's plugin context the SFC plugin uses. */
export type PdfSfcPluginContext = {
  addWatchFile(file: string): void
  load?(options: { id: string, resolveDependencies?: boolean }): Promise<unknown>
  resolve?(source: string, importer?: string, options?: { skipSelf?: boolean }): Promise<unknown>
}

export type PdfSfcPlugin = {
  enforce: 'pre'
  load(this: PdfSfcPluginContext, id: string): Promise<PdfSfcTransformResult | null>
  name: 'nuxt-pdf:sfc'
  resolveId(source: string, importer?: string): string | null
  transform(this: unknown, source: string, id: string): Promise<PdfSfcTransformResult | null>
}

/** The bundler's watcher, when the plugin context has one (Rollup and Vite do). */
const watcherOf = (context: unknown): ((file: string) => void) | undefined => {
  if (typeof context !== 'object' || context === null || !('addWatchFile' in context)) return undefined
  const { addWatchFile } = context
  return typeof addWatchFile === 'function' ? (file: string) => addWatchFile.call(context, file) : undefined
}

/** What the import checks ask the bundler about the compiled module. */
type PdfBundler = {
  /** The id an import of the compiled module resolves to, or `null`. */
  resolve(source: string): Promise<{ external: boolean, id: string } | null>
  /**
   * Loads and transforms a module as the build will; resolves to the ids it
   * imports and rejects with the transform error.
   */
  load?(id: string): Promise<readonly string[]>
}

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

/**
 * The bundler's own resolver and loader, as Rollup will call them for the
 * compiled module. `skipSelf: false` keeps this plugin's resolver for imports
 * relative to a virtual SFC id.
 */
const bundlerOf = (context: unknown, importer: string): PdfBundler | undefined => {
  if (typeof context !== 'object' || context === null || !('resolve' in context)) return undefined
  const { resolve } = context
  if (typeof resolve !== 'function') return undefined
  const load = 'load' in context ? context.load : undefined
  return {
    async resolve(source) {
      const resolved: unknown = await resolve.call(context, source, importer, { skipSelf: false })
      if (typeof resolved !== 'object' || resolved === null || !('id' in resolved) || typeof resolved.id !== 'string') return null
      return { external: 'external' in resolved && resolved.external !== false, id: resolved.id }
    },
    load: typeof load === 'function'
      ? async (id) => {
        const info: unknown = await load.call(context, { id, resolveDependencies: true })
        return typeof info === 'object' && info !== null && 'importedIds' in info ? stringList(info.importedIds) : []
      }
      : undefined,
  }
}

export class PdfSfcCompileError extends Error {
  readonly column: number
  /** The message without the `[nuxt-pdf] file:line:column` prefix. */
  readonly detail: string
  readonly filename: string
  readonly line: number

  constructor(filename: string, line: number, column: number, message: string) {
    // One path form in every message, on every platform (see displayPath).
    const file = displayPath(filename)
    super(`[nuxt-pdf] ${file}:${line}:${column} ${message}`)
    this.name = 'PdfSfcCompileError'
    this.detail = message
    this.filename = file
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
  /** The argument of a directive: `render` in `:render`. */
  arg?: { content?: string, isStatic?: boolean } | null
  children?: TemplateAstNode[]
  loc?: AstLocation | null
  name?: string
  props?: TemplateAstNode[]
  tag?: string
  /** For an element: 1 for a component (see `ELEMENT_COMPONENT`). */
  tagType?: number
  type: number
}

type MacroCall = {
  argument?: AstNode
  block: SFCScriptBlock
  call: AstNode
  statement?: AstNode
}

type ExtractedMetadata = {
  /** Where the `definePdf` call starts in the authored file (templates only). */
  call?: { column: number, line: number }
  expression: string
  source: string
}

/**
 * esbuild plugin for the standalone `/build` and `/test` entries: compiles `.vue` files with the
 * same compiler as the Nuxt module. `kind` says which files are templates.
 */
export const createPdfSfcEsbuildPlugin = (options: {
  kind: (path: string) => PdfSfcKind
  compileOptions?: PdfSfcCompileOptions
  /** Inline the compiler source map so stack traces point at the `.vue` file. */
  sourceMap?: boolean
}): EsbuildPlugin => ({
  name: 'nuxt-pdf:sfc',
  setup(builder) {
    builder.onLoad({ filter: /\.vue$/ }, async ({ path }) => {
      const source = await readFile(path, 'utf8')
      const result = await compilePdfSfc(source, path, options.kind(path), true, options.compileOptions)
      // esbuild reports an import it cannot resolve at the compiled position;
      // checked here, it names the import in the authored file, as the Nuxt build does.
      await assertImportsResolve(result.code, source, displayPath(path), {
        async resolve(specifier) {
          const resolved = await builder.resolve(specifier, { kind: 'import-statement', resolveDir: dirname(path) })
          return resolved.errors.length > 0 ? null : { external: resolved.external, id: resolved.path }
        },
      })
      const sourceMap = options.sourceMap && result.map
        ? `\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(result.map)).toString('base64')}`
        : ''
      return { contents: result.code + sourceMap, loader: 'js', resolveDir: dirname(path) }
    })
  },
})

export const createPdfSfcPlugin = (
  options: PdfSfcPluginOptions,
): PdfSfcPlugin => {
  const recovery = compileRecoveryOf(options.onCompileError)
  return {
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

      // Watched before compiling, so a fix rebuilds even after a failure.
      this.addWatchFile(filename)
      let source: string
      try {
        source = await readFile(filename, 'utf8')
      }
      catch (error) {
      // In development Rollup's watcher can rebuild before the module has
      // dropped a removed file from the registry; the registry rebuild follows.
        if (!recovery || !isMissingFile(error)) throw error
        recovery.succeeded(filename)
        return { code: compileErrorStub(compileErrorInfo(new Error('This file was removed.'), filename, options.rootDir)), map: null }
      }
      return compileOrRecover(
        source,
        filename,
        kind,
        options,
        recovery,
        file => this.addWatchFile(file),
        bundlerOf(this, id),
      )
    },
    async transform(source, id) {
      if (id.includes('?') || id.startsWith(VIRTUAL_PREFIX)) return null

      const filename = resolve(id)
      const kind = options.files.get(filename)

      if (!kind) return null

      return compileOrRecover(
        source,
        filename,
        kind,
        options,
        recovery,
        watcherOf(this),
        bundlerOf(this, id),
      )
    },
  }
}

/** Development: how a failed file is reported. */
type PdfCompileRecovery = {
  failed(filename: string, error: Error): void
  succeeded(filename: string): void
}

/**
 * Rollup compiles every module again on each rebuild. Keeping the last
 * message reported per file, a file still broken after an unrelated edit stays
 * quiet. Nitro keeps the plugin object, and so this state, across its dev
 * rebuilds; a Nuxt restart starts with an empty record.
 */
function compileRecoveryOf(report: ((error: Error) => void) | undefined): PdfCompileRecovery | undefined {
  if (!report) return undefined
  const reported = new Map<string, string>()
  return {
    failed(filename, error) {
      if (reported.get(filename) === error.message) return
      reported.set(filename, error.message)
      report(error)
    },
    succeeded: filename => reported.delete(filename),
  }
}

async function compileOrRecover(
  source: string,
  filename: string,
  kind: PdfSfcKind,
  options: PdfSfcPluginOptions,
  recovery: PdfCompileRecovery | undefined,
  onDependency: ((file: string) => void) | undefined,
  bundler: PdfBundler | undefined,
): Promise<PdfSfcTransformResult> {
  const { files: _files, isProduction, onCompileError: _onCompileError, ...compileOptions } = options
  try {
    const result = await compilePdfSfc(source, filename, kind, isProduction, { ...compileOptions, onDependency })
    // Rollup reports an import it cannot resolve against the virtual module id
    // and, in development, fails the whole build. Checked here, the error names
    // the import in the authored file, in every build; in development the file
    // fails alone, like a compile error.
    if (bundler) {
      const imported = await assertImportsResolve(result.code, source, displayPath(filename), bundler)
      if (recovery && bundler.load) await assertLocalModulesLoad(imported, bundler.load, options.rootDir ?? process.cwd(), onDependency)
    }
    recovery?.succeeded(filename)
    return result
  }
  catch (error) {
    if (!recovery) throw withCodeFrame(error, source, filename)
    const failure = error instanceof Error ? error : new Error(String(error))
    recovery.failed(filename, failure)
    return { code: compileErrorStub(compileErrorInfo(failure, filename, options.rootDir)), map: null }
  }
}

/**
 * A production compile error with the code frame of its position. Nitro prints
 * a failed build's `frame` (and the text "undefined" when it has none).
 */
function withCodeFrame(error: unknown, source: string, filename: string): unknown {
  if (!(error instanceof PdfSfcCompileError) || error.filename !== displayPath(filename)) return error
  const lines = source.split('\n')
  const offset = lines.slice(0, error.line - 1).reduce((total, line) => total + line.length + 1, 0) + error.column - 1
  return Object.assign(error, { frame: generateCodeFrame(source, offset, offset + 1) })
}

/** The import sources of compiled module code: static imports and re-exports. */
function moduleImportSources(code: string): string[] {
  const program = babelParse(code, { sourceType: 'module' }).program as unknown as AstNode
  const sources = moduleStatements(program).map(statement => asAstNode(statement.source)?.value)
  return [...new Set(sources.filter(source => typeof source === 'string'))]
}

/**
 * Fails at the first import of the compiled module that the bundler cannot
 * resolve, at the position of that import in the authored file. Compiled code
 * keeps only imports that are used, so an unused import of a missing file
 * passes here as it passes the production build.
 */
async function assertImportsResolve(
  code: string,
  source: string,
  filename: string,
  bundler: PdfBundler,
): Promise<string[]> {
  const imported: string[] = []
  for (const specifier of moduleImportSources(code)) {
    const resolved = await bundler.resolve(specifier)
    if (resolved) {
      if (!resolved.external) imported.push(resolved.id)
      continue
    }
    const message = `Cannot resolve the import "${specifier}". Check the path or alias, and that the package is installed.`
    const descriptor = parsePdfSfc(source, filename)
    for (const block of [descriptor.scriptSetup, descriptor.script]) {
      if (!block) continue
      for (const statement of moduleStatements(parseScriptProgram(block, filename))) {
        const literal = asAstNode(statement.source)
        if (literal?.value === specifier) throw errorAtNode(filename, block, literal, message)
      }
    }
    throw new PdfSfcCompileError(filename, 1, 1, message)
  }
  return imported
}

/**
 * Development: a project module in the file's import graph that fails to
 * transform (a syntax error in a helper `.ts`) or imports a missing module
 * fails the whole Nitro build. Loaded here through the bundler, which caches
 * the result for the build, it fails only this file, at the module's own
 * position. Each module is watched, so fixing it compiles the file again.
 */
async function assertLocalModulesLoad(
  ids: readonly string[],
  load: NonNullable<PdfBundler['load']>,
  rootDir: string,
  onDependency: ((file: string) => void) | undefined,
): Promise<void> {
  const seen = new Set<string>()
  const queue = ids.filter(id => isLocalModule(id, rootDir))
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    if (seen.has(id)) continue
    seen.add(id)
    onDependency?.(id)
    let imported: readonly string[]
    try {
      imported = await load(id)
    }
    catch (error) {
      throw moduleLoadError(error, id)
    }
    queue.push(...imported.filter(next => isLocalModule(next, rootDir)))
  }
}

/** A bundler error for a module (esbuild's `errors[0].location`, or Rollup's `loc`) at its file position. */
function moduleLoadError(error: unknown, id: string): PdfSfcCompileError {
  const first = isRecord(error) && Array.isArray(error.errors) && error.errors.length > 0 ? error.errors[0] : error
  const location = isRecord(first) && isRecord(first.location)
    ? first.location
    : isRecord(error) && isRecord(error.loc) ? error.loc : undefined
  const file = typeof location?.file === 'string' && isAbsolute(location.file) ? location.file : id
  return new PdfSfcCompileError(
    displayPath(file),
    typeof location?.line === 'number' ? location.line : 1,
    typeof location?.column === 'number' ? location.column + 1 : 1,
    errorMessage(first),
  )
}

/** Top-level statements with a module source: imports and re-exports. */
function moduleStatements(program: AstNode): AstNode[] {
  return (Array.isArray(program.body) ? program.body : [])
    .map(asAstNode)
    .filter((node): node is AstNode => node !== undefined && /^(?:Import|ExportNamed|ExportAll)Declaration$/.test(node.type))
}

const isMissingFile = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT'

/** Position and message of a compile failure, relative to the project root. */
function compileErrorInfo(error: Error, filename: string, rootDir = process.cwd()): PdfCompileErrorInfo {
  const located = error instanceof PdfSfcCompileError
  return {
    message: located ? error.detail : error.message,
    source: {
      file: displayPath(relative(rootDir, located ? error.filename : filename)),
      line: located ? error.line : 1,
      column: located ? error.column : 1,
    },
  }
}

/**
 * Development stand-in for a file that failed to compile. Imports nothing, so
 * it cannot fail to build. The registry and the preview read the marker; a
 * template that uses a failed component gets the thrown `Error`.
 */
function compileErrorStub(info: PdfCompileErrorInfo): string {
  const marker = JSON.stringify(PDF_COMPILE_ERROR_PROPERTY)
  return [
    `const info = Object.freeze(${JSON.stringify({ message: info.message, source: info.source })})`,
    `export default { name: 'NuxtPdfCompileError', [${marker}]: info, setup() { throw Object.assign(new Error(info.message), { [${marker}]: info }) } }`,
    '',
  ].join('\n')
}

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
  options: PdfSfcCompileOptions = {},
): Promise<PdfSfcTransformResult> {
  const compilerFilename = displayPath(filename)
  const original = parsePdfSfc(source, compilerFilename)

  assertSupportedBlocks(original, compilerFilename)
  assertTemplate(original, compilerFilename)
  assertSynchronousSetup(original, compilerFilename)
  assertNoRemovedApi(original, compilerFilename)
  assertNoRemovedProps(original, compilerFilename)
  assertSupportedTemplate(original, compilerFilename)

  const metadata = extractMetadata(
    source,
    original,
    compilerFilename,
    kind,
    isProduction,
  )
  const styles = compilePdfStyles(
    original.styles,
    (line, column, message, file = compilerFilename) => new PdfSfcCompileError(file, line, column, message),
    {
      alias: options.alias,
      filename,
      onDependency: options.onDependency,
      rootDir: options.rootDir ?? process.cwd(),
      typescript: ['ts', 'tsx'].includes(scriptLoader(original)),
    },
  )
  const rewritten = applyClassStyles(metadata.source, original, styles, compilerFilename)
  const cleaned = parsePdfSfc(rewritten.code, compilerFilename)
  const sourcePositions = options.dev
    ? (baseOffset: number) => sourcePositionTransform(
        source,
        rewritten.edits,
        displayPath(relative(options.rootDir ?? process.cwd(), filename)),
        baseOffset,
      )
    : undefined
  const component = compileComponent(cleaned, compilerFilename, isProduction, sourcePositions)
  const autoImportedComponent = await injectAuthoringImports(
    component.code,
    compilerFilename,
    options.einvoiceImport,
  )
  // Development: where definePdf is, so the registry can show a metadata
  // value that fails validation at that position instead of failing to load.
  const definitionSource = options.dev && metadata.call
    ? `${COMPONENT_VARIABLE}[${JSON.stringify(PDF_DEFINITION_SOURCE_PROPERTY)}] = ${JSON.stringify({
      file: displayPath(relative(options.rootDir ?? process.cwd(), filename)),
      ...metadata.call,
    })}\n`
    : ''
  const metadataCode = kind === 'template'
    ? `${COMPONENT_VARIABLE}.${PDF_DEFINITION_PROPERTY} = ${metadata.expression}\n${definitionSource}`
    : ''
  const classesCode = [
    styles.rules.length > 0 ? `${COMPONENT_VARIABLE}.${PDF_CLASSES_PROPERTY} = ${JSON.stringify(styles.rules)}` : '',
    styles.bindings.length > 0 ? `${COMPONENT_VARIABLE}.${PDF_BINDINGS_PROPERTY} = ${JSON.stringify(styles.bindings)}` : '',
  ].filter(Boolean).join('\n')
  const loader = scriptLoader(cleaned)

  try {
    const result = await transformWithEsbuild([
      autoImportedComponent.code,
      metadataCode,
      classesCode,
      `export default ${COMPONENT_VARIABLE}`,
    ].filter(Boolean).join('\n'), {
      charset: 'utf8',
      format: 'esm',
      loader,
      sourcefile: compilerFilename,
      sourcemap: true,
      sourcesContent: true,
      target: 'es2022',
    })

    const esbuildMap = result.map
      ? JSON.parse(result.map) as PdfSourceMap
      : null
    const traced = esbuildMap && autoImportedComponent.map && component.map
      ? remapping(
          [esbuildMap, autoImportedComponent.map, component.map],
          () => null,
          { decodedMappings: true },
        )
      : null
    const map = traced ? restoreAuthoredColumns(traced, rewritten.code, source, rewritten.edits) : null

    if (map) map.sourcesContent = map.sources.map(() => source)

    return { code: result.code, map }
  }
  catch (error) {
    throw normalizeBuildError(error, compilerFilename)
  }
}

const lineStartsOf = (text: string): number[] => {
  const starts = [0]
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) starts.push(index + 1)
  return starts
}

/**
 * The compiler maps into the class-rewritten source. The class edits keep
 * every line but move the columns after them, so each traced position is moved
 * back to the authored column. A position inside a replacement maps to the
 * start of the authored attribute. Style blanking and the `definePdf`
 * removal keep every offset, so the edits are the only difference.
 */
function restoreAuthoredColumns(
  map: ReturnType<typeof remapping>,
  rewritten: string,
  authored: string,
  edits: readonly PdfTemplateEdit[],
): PdfSourceMap {
  if (typeof map.mappings === 'string' || edits.length === 0) {
    return remapping(map as unknown as PdfSourceMap, () => null) as unknown as PdfSourceMap
  }
  const rewrittenStarts = lineStartsOf(rewritten)
  const authoredStarts = lineStartsOf(authored)
  const authoredPosition = (line: number, column: number): [number, number] => {
    const offset = (rewrittenStarts[line] ?? rewritten.length) + column
    let delta = 0
    let result: number | undefined
    for (const edit of edits) {
      const start = edit.start + delta
      if (offset < start) break
      if (offset < start + edit.text.length) {
        result = edit.start
        break
      }
      delta += edit.text.length - (edit.end - edit.start)
    }
    const authoredOffset = result ?? offset - delta
    let low = 0
    let high = authoredStarts.length - 1
    while (low < high) {
      const middle = (low + high + 1) >> 1
      if (authoredStarts[middle]! <= authoredOffset) low = middle
      else high = middle - 1
    }
    return [low, authoredOffset - authoredStarts[low]!]
  }
  const mappings = map.mappings.map(line => line.map((segment): SourceMapSegment => {
    if (segment.length === 1) return segment
    const [line, column] = authoredPosition(segment[2], segment[3])
    return segment.length === 4
      ? [segment[0], segment[1], line, column]
      : [segment[0], segment[1], line, column, segment[4]]
  }))
  return remapping({ ...map, mappings, file: map.file ?? undefined }, () => null) as unknown as PdfSourceMap
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

const UNSUPPORTED_STYLE_ATTRIBUTES = ['scoped', 'module', 'lang', 'src'] as const

function assertSupportedBlocks(descriptor: SFCDescriptor, filename: string): void {
  for (const style of descriptor.styles) {
    const attribute = UNSUPPORTED_STYLE_ATTRIBUTES.find(name => name in style.attrs)
    if (attribute) {
      throw errorAtBlock(
        filename,
        style,
        `<style ${attribute}> is not supported in PDF components. Use a plain <style> block; classes are always local to the file.`,
      )
    }
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

/**
 * Removes the compiled `<style>` content (its rules travel as JSON on the
 * component) and rewrites `class` on component tags into the class helper.
 * Line breaks stay, so later compiler errors keep their lines.
 */
function applyClassStyles(
  source: string,
  original: SFCDescriptor,
  styles: PdfCompiledStyles,
  filename: string,
): { code: string, edits: readonly PdfTemplateEdit[] } {
  const blanked = original.styles.reduce(
    (result, style) => replaceWithWhitespace(result, style.loc.start.offset, style.loc.end.offset),
    source,
  )
  const ast = original.template?.ast
  return ast
    ? rewriteTemplateClasses(
        blanked,
        ast as unknown as PdfTemplateNode,
        styles,
        (line, column, message) => new PdfSfcCompileError(filename, line, column, message),
      )
    : { code: blanked, edits: [] }
}

type NodeTransform = NonNullable<CompilerOptions['nodeTransforms']>[number]

const PDF_COMPONENT_TAGS: ReadonlySet<string> = new Set(PDF_COMPONENT_NAMES)
const ELEMENT_COMPONENT = 1
const ATTRIBUTE_NODE = 6
const DIRECTIVE_NODE = 7
const TEXT_NODE = 2

const componentTagName = (tag: string): string =>
  tag.replace(/(?:^|-)([a-z])/g, (_, letter: string) => letter.toUpperCase())

/**
 * Adds `PDF_SOURCE_PROP="<file>:<line>:<column>"` to every `Pdf*` element.
 * The compiler sees the class-rewritten source, so each element offset is
 * mapped back through the class edits to the authored `.vue` file. A compiler
 * transform, not a text edit: later compiler errors keep their columns.
 * `baseOffset` turns a template-relative offset into a file offset.
 */
function sourcePositionTransform(
  original: string,
  edits: readonly PdfTemplateEdit[],
  file: string,
  baseOffset: number,
): NodeTransform {
  return (node) => {
    if (!('tagType' in node) || node.tagType !== ELEMENT_COMPONENT) return
    if (!PDF_COMPONENT_TAGS.has(componentTagName(node.tag))) return

    let offset = baseOffset + node.loc.start.offset
    // Edits are sorted; one that starts before the element shifted it.
    let delta = 0
    for (const edit of edits) {
      if (edit.start + delta >= offset) break
      delta += edit.text.length - (edit.end - edit.start)
    }
    offset -= delta
    const before = original.slice(0, offset)
    const line = before.split('\n').length
    const column = offset - before.lastIndexOf('\n')

    // First, so the renderer has it before any other prop can fail.
    node.props.unshift({
      type: ATTRIBUTE_NODE,
      name: PDF_SOURCE_PROP,
      nameLoc: node.loc,
      value: { type: TEXT_NODE, content: `${file}:${line}:${column}`, loc: node.loc },
      loc: node.loc,
    })
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

// Temporary hints for API removed on the way to 1.0 (internals/migrations.md).
const REMOVED_API: Readonly<Record<string, string>> = {
  usePdfPageNumbers: 'usePdfPageNumbers() was removed. Print the page of a destination with <PdfPageRef to="id" /> inside a <PdfText>.',
}

function assertNoRemovedApi(descriptor: SFCDescriptor, filename: string): void {
  for (const block of [descriptor.script, descriptor.scriptSetup]) {
    if (!block) continue
    walkAst(parseScriptProgram(block, filename), [], (node) => {
      if (node.type !== 'Identifier' || typeof node.name !== 'string' || !Object.hasOwn(REMOVED_API, node.name)) return
      throw errorAtNode(filename, block, node, REMOVED_API[node.name]!)
    })
  }
}

/**
 * Fails the build for a removed prop on a `Pdf*` tag, in every static binding
 * form (`render`, `:render`, `v-bind:hyphenation-callback`). All occurrences
 * of the file go into one error, so an author fixes them in one round. The
 * renderer keeps its own check for render functions and `v-bind="object"`.
 */
function assertNoRemovedProps(descriptor: SFCDescriptor, filename: string): void {
  const ast = descriptor.template?.ast as unknown as TemplateAstNode | undefined
  if (!ast) return

  const found: { line: number, column: number, message: string }[] = []
  walkTemplateAst(ast, (node) => {
    if (node.type !== 1 || !node.tag) return
    const tag = componentTagName(node.tag)
    if (!PDF_COMPONENT_TAGS.has(tag)) return

    for (const prop of node.props ?? []) {
      const key = prop.type === ATTRIBUTE_NODE
        ? prop.name
        : prop.type === DIRECTIVE_NODE && prop.name === 'bind' && prop.arg?.isStatic
          ? prop.arg.content
          : undefined
      if (!key || !isRemovedPdfProp(key)) continue
      found.push({
        line: prop.loc?.start.line ?? 1,
        column: prop.loc?.start.column ?? 1,
        message: unsupportedPdfPropMessage(key, tag),
      })
    }
  })

  const [first, ...rest] = found
  if (!first) return
  throw new PdfSfcCompileError(
    filename,
    first.line,
    first.column,
    // Line and column only: the dev preview shows the detail without the path.
    [first.message, ...rest.map(({ line, column, message }) => `Also at ${line}:${column}: ${message}`)].join('\n'),
  )
}

function assertSupportedTemplate(
  descriptor: SFCDescriptor,
  filename: string,
): void {
  const block = descriptor.template
  const ast = block?.ast as unknown as TemplateAstNode | undefined
  if (!block || !ast) return

  const provided = providedComponents(descriptor, filename)
  walkTemplateAst(ast, (node) => {
    const name = node.type === 1 && node.tagType === ELEMENT_COMPONENT && node.tag ? componentTagName(node.tag) : undefined
    if (name && /^Pdf[A-Z]/.test(name) && !PDF_COMPONENT_TAGS.has(name) && !provided(node.tag!)) {
      const nearest = nearestComponentName(name)
      throw errorAtTemplateNode(
        filename,
        node,
        `Unknown component <${node.tag}>.${nearest ? ` Did you mean <${nearest}>?` : ''} PDF templates can use the Pdf components of @lupinum/nuxt-pdf and components they import.`,
      )
    }

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

const camelizeTag = (tag: string): string => tag.replace(/-(\w)/g, (_, letter: string) => letter.toUpperCase())
const capitalizeTag = (tag: string): string => tag.charAt(0).toUpperCase() + tag.slice(1)

/** The names Vue tries for a tag, in its order: as written, camelCase, PascalCase. */
const tagNames = (tag: string): string[] => [tag, camelizeTag(tag), capitalizeTag(camelizeTag(tag))]

/** Identifiers that a binding pattern declares (`a`, `{ a, b: c }`, `[d, ...e]`). */
function patternNames(pattern: AstNode | undefined): string[] {
  if (!pattern) return []
  if (pattern.type === 'Identifier' && typeof pattern.name === 'string') return [pattern.name]
  if (pattern.type === 'ObjectPattern' && Array.isArray(pattern.properties)) {
    return pattern.properties.flatMap((property) => {
      const node = asAstNode(property)
      return patternNames(node?.type === 'RestElement' ? asAstNode(node.argument) : asAstNode(node?.value))
    })
  }
  if (pattern.type === 'ArrayPattern' && Array.isArray(pattern.elements)) {
    return pattern.elements.flatMap(element => patternNames(asAstNode(element)))
  }
  if (pattern.type === 'RestElement' || pattern.type === 'AssignmentPattern') {
    return patternNames(asAstNode(pattern.argument ?? pattern.left))
  }
  return []
}

/** Top-level bindings of a script: imports (also `* as`), variables, functions, classes. */
function scriptBindings(program: AstNode): string[] {
  return (Array.isArray(program.body) ? program.body : []).flatMap((statement): string[] => {
    const node = asAstNode(statement)
    const declaration = node?.type === 'ExportNamedDeclaration' ? asAstNode(node.declaration) : node
    if (!declaration) return []
    if (declaration.type === 'ImportDeclaration' && Array.isArray(declaration.specifiers)) {
      return declaration.specifiers.flatMap(specifier => patternNames(asAstNode(asAstNode(specifier)?.local)))
    }
    if (declaration.type === 'VariableDeclaration' && Array.isArray(declaration.declarations)) {
      return declaration.declarations.flatMap(declarator => patternNames(asAstNode(asAstNode(declarator)?.id)))
    }
    if (declaration.type === 'FunctionDeclaration' || declaration.type === 'ClassDeclaration') {
      return patternNames(asAstNode(declaration.id))
    }
    return []
  })
}

/**
 * The keys of a `components` option, or `undefined` when they cannot be read
 * statically (a spread, a computed key, a variable, or `extends` or `mixins`,
 * which can bring components of their own).
 */
function componentOptionKeys(options: AstNode | undefined): string[] | undefined {
  if (options?.type !== 'ObjectExpression' || !Array.isArray(options.properties)) return undefined
  const properties = options.properties.map(asAstNode)
  const inherits = properties.some(property =>
    property?.type === 'ObjectProperty' && ['extends', 'mixins'].includes(metadataKey(asAstNode(property.key)) ?? ''))
  if (inherits) return undefined
  const option = properties.find(property =>
    property?.type === 'ObjectProperty' && metadataKey(asAstNode(property.key)) === 'components')
  if (!option) return options.properties.some(property => asAstNode(property)?.type === 'SpreadElement') ? undefined : []
  const value = asAstNode(option.value)
  if (value?.type !== 'ObjectExpression' || !Array.isArray(value.properties)) return undefined
  const keys: string[] = []
  for (const property of value.properties.map(asAstNode)) {
    const key = property?.type === 'ObjectProperty' && property.computed !== true ? metadataKey(asAstNode(property.key)) : undefined
    if (key === undefined) return undefined
    keys.push(key)
  }
  return keys
}

/** The options object of `export default {…}` or `export default defineComponent({…})`. */
function defaultExportOptions(program: AstNode): AstNode | undefined | null {
  const exported = (Array.isArray(program.body) ? program.body : []).map(asAstNode)
    .find(statement => statement?.type === 'ExportDefaultDeclaration')
  if (!exported) return null
  const declaration = asAstNode(exported.declaration)
  if (declaration?.type === 'CallExpression' && Array.isArray(declaration.arguments)) return asAstNode(declaration.arguments[0])
  return declaration
}

/** The options object of a top-level `defineOptions({…})` in `<script setup>`. */
function defineOptionsArgument(program: AstNode): AstNode | undefined {
  for (const statement of (Array.isArray(program.body) ? program.body : []).map(asAstNode)) {
    const call = statement?.type === 'ExpressionStatement' ? asAstNode(statement.expression) : undefined
    const callee = asAstNode(call?.callee)
    if (call?.type === 'CallExpression' && callee?.type === 'Identifier' && callee.name === 'defineOptions' && Array.isArray(call.arguments)) {
      return asAstNode(call.arguments[0])
    }
  }
  return undefined
}

/**
 * Says whether a template tag can be a component the file provides, by the
 * rules Vue resolves a tag with: a `<script setup>` binding (for `A.B`, the
 * binding `A`), a key of a `components` option, or the file's own name (a
 * recursive component). Each is tried as written, camelCase and PascalCase.
 * Components under `pdfs/components/` are imported, never registered
 * globally. When a `components` option cannot be read statically, every tag
 * may be provided.
 */
function providedComponents(descriptor: SFCDescriptor, filename: string): (tag: string) => boolean {
  const names = new Set<string>()
  let open = false
  if (descriptor.scriptSetup) {
    const program = parseScriptProgram(descriptor.scriptSetup, filename)
    for (const name of scriptBindings(program)) names.add(name)
    const options = defineOptionsArgument(program)
    if (options) {
      const keys = componentOptionKeys(options)
      if (keys) keys.forEach(key => names.add(key))
      else open = true
    }
  }
  if (descriptor.script) {
    const options = defaultExportOptions(parseScriptProgram(descriptor.script, filename))
    const keys = options === null ? [] : componentOptionKeys(options)
    if (keys) keys.forEach(key => names.add(key))
    else open = true
  }
  const self = capitalizeTag(camelizeTag(componentName(filename)))
  return (tag) => {
    if (open) return true
    const [root = tag] = tag.split('.', 1)
    if (root !== tag) return names.has(root)
    return capitalizeTag(camelizeTag(tag)) === self || tagNames(tag).some(name => names.has(name))
  }
}

/** Edit distance between two names (insert, delete, replace). */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i]
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    previous = current
  }
  return previous[b.length]!
}

/** The known component closest to a mistyped name, when it is close enough to be a typo. */
function nearestComponentName(name: string): string | undefined {
  let best: { distance: number, name: string } | undefined
  for (const known of PDF_COMPONENT_NAMES) {
    const distance = editDistance(name.toLowerCase(), known.toLowerCase())
    if (!best || distance < best.distance) best = { distance, name: known }
  }
  return best && best.distance <= 2 ? best.name : undefined
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

  const call = errorAtNode(filename, macro.block, macro.call, '')

  return {
    call: { line: call.line, column: call.column },
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

  const argument = block.content.slice(argumentStart, argumentEnd)
  const macroStart = blockOffset + requiredOffset(macro.statement.start, filename, block)
  const macroEnd = blockOffset + requiredOffset(macro.statement.end, filename, block)
  // The source with user `defineOptions()` calls removed and the definePdf() statement replaced.
  const withMacroAs = (value: string): string => [...replacements, { start: macroStart, end: macroEnd, value }]
    .sort((left, right) => right.start - left.start)
    .reduce(
      (result, replacement) =>
        result.slice(0, replacement.start)
        + replacement.value
        + result.slice(replacement.end),
      source,
    )
  const compiles = (candidate: string): boolean => {
    try {
      compileScript(parsePdfSfc(candidate, filename), {
        fs: compilerFileSystem,
        id: 'nuxt-pdf-metadata-hoist',
        sourceMap: false,
      })
      return true
    }
    catch {
      return false
    }
  }

  // Vue hoists `defineOptions()` out of setup() and rejects an argument that reads setup
  // bindings. That error has no code, so compare structurally instead of matching its English
  // text: the metadata reads a local binding when the hoisted form fails to compile but the same
  // expression kept inside setup() compiles.
  if (!compiles(withMacroAs(`defineOptions(${argument})`)) && compiles(withMacroAs(`;(${argument})`))) {
    throw errorAtNode(
      filename,
      block,
      macro.call,
      'definePdf() metadata cannot reference locally declared <script setup> bindings because it is evaluated at module scope. Inline the value or import it from a side-effect-free module.',
    )
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
  sourcePositions?: (baseOffset: number) => NodeTransform,
): CompiledCode {
  if (descriptor.scriptSetup) {
    try {
      const result = compileScript(descriptor, {
        fs: compilerFileSystem,
        genDefaultAs: COMPONENT_VARIABLE,
        id: 'nuxt-pdf',
        inlineTemplate: true,
        isProd: isProduction,
        sourceMap: true,
        templateOptions: {
          // The inline template compiles the file's own AST: file offsets.
          compilerOptions: sourcePositions ? { nodeTransforms: [sourcePositions(0)] } : undefined,
          filename,
          isProd: isProduction,
          ssr: false,
          transformAssetUrls: false,
        },
      })
      return {
        code: result.content,
        map: result.map
          ? JSON.parse(JSON.stringify(result.map)) as PdfSourceMap
          : null,
      }
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
        fs: compilerFileSystem,
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
    compilerOptions: {
      bindingMetadata: bindings,
      // The template content is compiled on its own: offsets start at the block.
      nodeTransforms: sourcePositions ? [sourcePositions(descriptor.template!.loc.start.offset)] : undefined,
    },
    filename,
    id: 'nuxt-pdf',
    isProd: isProduction,
    source: descriptor.template!.content,
    ssr: false,
    transformAssetUrls: false,
  })

  if (template.errors.length > 0) {
    // Compiled from the block content alone: positions start at the block.
    throw normalizeCompilerError(template.errors[0], filename, descriptor.template!)
  }

  return {
    code: [
      scriptCode,
      template.code,
      `${COMPONENT_VARIABLE}.render = render`,
    ].join('\n'),
    // The separately compiled script and template do not share one generated
    // coordinate space. Returning no map is safer than publishing a false one.
    map: null,
  }
}

async function injectAuthoringImports(
  componentCode: string,
  filename: string,
  einvoiceImport: string | undefined,
): Promise<CompiledCode> {
  // Vue APIs (`computed`, `ref`) are auto-imported, as in a Nuxt app, and
  // the e-invoice functions when the build names their module.
  const key = einvoiceImport ?? ''
  let context = authoringImportContexts.get(key)
  if (context === undefined) {
    context = createUnimport({
      presets: ['vue'],
      imports: einvoiceImport === undefined ? [] : EINVOICE_AUTO_IMPORTS.map(name => ({ name, from: einvoiceImport })),
    })
    authoringImportContexts.set(key, context)
  }
  const result = await context.injectImports(componentCode, filename)
  return {
    code: result.s.toString(),
    map: JSON.parse(result.s.generateMap({
      hires: true,
      includeContent: true,
      source: filename,
    }).toString()) as PdfSourceMap,
  }
}

function scriptLoader(descriptor: SFCDescriptor): 'js' | 'jsx' | 'ts' | 'tsx' {
  const languages = [descriptor.script?.lang, descriptor.scriptSetup?.lang]

  if (languages.includes('tsx')) return 'tsx'
  if (languages.includes('ts')) return 'ts'
  if (languages.includes('jsx')) return 'jsx'
  return 'js'
}

function componentName(filename: string): string {
  const basename = displayPath(filename).split('/').at(-1) ?? 'PdfComponent.vue'
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
  const { column, line } = inBlock(errorLocation(error) ?? { column: 1, line: 1 }, block)
  return new PdfSfcCompileError(filename, line, column, compilerMessage(error, filename))
}

/**
 * The one place a Vue, Babel or compiler-sfc error becomes a position in the
 * authored file. `block` is set for errors of a block compiled on its own
 * (the template outside `<script setup>`), whose lines start at the block.
 */
function normalizeCompilerError(error: unknown, filename: string, block?: SFCBlock): Error {
  if (error instanceof PdfSfcCompileError) return error

  const location = errorLocation(error) ?? { column: 1, line: 1 }
  const { column, line } = block ? inBlock(location, block) : location
  return new PdfSfcCompileError(filename, line, column, compilerMessage(error, filename))
}

/** A 1-based position inside a block's content as a position in the file. */
function inBlock(location: { column: number, line: number }, block: SFCBlock): { column: number, line: number } {
  return {
    line: block.loc.start.line + location.line - 1,
    column: location.line === 1 ? block.loc.start.column + location.column - 1 : location.column,
  }
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

/**
 * The 1-based position of a compiler error. Vue errors carry `loc.start` with a
 * 1-based column; Babel errors carry `loc` with a 0-based column.
 */
function errorLocation(error: unknown): { column: number, line: number } | undefined {
  if (!isRecord(error) || !isRecord(error.loc)) return undefined

  const location = isRecord(error.loc.start) ? error.loc.start : error.loc
  const vue = location !== error.loc

  return typeof location.line === 'number' && typeof location.column === 'number'
    ? { column: vue ? location.column : location.column + 1, line: location.line }
    : undefined
}

/**
 * The compiler's message without what the error position already says: the
 * code frame and file name Vue appends for an inline template, the file name
 * Vue appends to an empty file's message, and Babel's own `(line:column)`.
 */
function compilerMessage(error: unknown, filename: string): string {
  const [first = ''] = errorMessage(error).split('\n\n', 1)
  const withoutFile = first.endsWith(` ${filename}`) ? first.slice(0, -filename.length - 1) : first
  return withoutFile.replace(/ \(\d+:\d+\)$/, '')
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
