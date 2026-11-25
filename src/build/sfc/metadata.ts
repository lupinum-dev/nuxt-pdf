// The definePdf() metadata of a template: find, check, hoist and write it.

import { compileScript, type SFCScriptBlock } from '@vue/compiler-sfc'
import { isPdfDefinitionKey, PDF_DEFINITION_KEYS } from '../../runtime/shared/template'
import type { PdfSfcKind } from './compile'
import { errorAtBlock, errorAtNode, nodePosition, PdfSfcCompileError } from './errors'
import { asAstNode, type AstNode, type MacroCall, metadataKey, type PdfSfc, walkAst } from './script-ast'
import { applyEdits, blankEdit, type TextEdit } from './source-text'
import { compilerFileSystem, parsePdfSfc } from './vue-compiler'

type ExtractedMetadata = {
  /** Where the `definePdf` call starts in the authored file (templates only). */
  call?: { column: number, line: number }
  expression: string
  source: string
}

export function extractMetadata(
  source: string,
  sfc: PdfSfc,
  kind: PdfSfcKind,
  isProduction: boolean,
): ExtractedMetadata {
  const { descriptor, filename } = sfc
  const calls = [
    ...sfc.macroCalls(descriptor.script).definePdf,
    ...sfc.macroCalls(descriptor.scriptSetup).definePdf,
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
  assertMetadataHoistable(source, sfc, macro)

  const blockOffset = macro.block.loc.start.offset
  const argumentStart = requiredOffset(macro.argument.start, filename, macro.block)
  const argumentEnd = requiredOffset(macro.argument.end, filename, macro.block)
  const statementStart = requiredOffset(macro.statement.start, filename, macro.block)
  const statementEnd = requiredOffset(macro.statement.end, filename, macro.block)
  const absoluteStatementStart = blockOffset + statementStart
  const absoluteStatementEnd = blockOffset + statementEnd

  return {
    call: nodePosition(macro.block, macro.call),
    expression: isProduction
      ? productionMetadataExpression(
          metadataProperties,
          macro.block,
          filename,
        )
      : macro.block.content.slice(argumentStart, argumentEnd),
    source: applyEdits(source, [blankEdit(source, absoluteStatementStart, absoluteStatementEnd)]),
  }
}

function assertMetadataHoistable(
  source: string,
  sfc: PdfSfc,
  macro: MacroCall,
): void {
  const { descriptor, filename } = sfc
  const block = descriptor.scriptSetup
  if (!block || !macro.argument || !macro.statement) return

  const optionsCalls = sfc.macroCalls(block).defineOptions
  // Vue's check behind the trial compiles below reads identifiers only. With
  // none in the metadata, both trial forms compile alike, so the check cannot fail.
  if (!readsName(macro.argument)) return

  const blockOffset = block.loc.start.offset
  const argumentStart = requiredOffset(macro.argument.start, filename, block)
  const argumentEnd = requiredOffset(macro.argument.end, filename, block)
  const replacements: TextEdit[] = []

  for (const call of optionsCalls) {
    if (!call.statement) continue
    replacements.push({
      start: blockOffset + requiredOffset(call.statement.start, filename, block),
      end: blockOffset + requiredOffset(call.statement.end, filename, block),
      text: '',
    })
  }

  const argument = block.content.slice(argumentStart, argumentEnd)
  const macroStart = blockOffset + requiredOffset(macro.statement.start, filename, block)
  const macroEnd = blockOffset + requiredOffset(macro.statement.end, filename, block)
  // The source with user `defineOptions()` calls removed and the definePdf() statement replaced.
  const withMacroAs = (text: string): string =>
    applyEdits(source, [...replacements, { start: macroStart, end: macroEnd, text }])
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

/**
 * Whether an expression contains an identifier that is not a plain object
 * key: a name it may read. A shorthand property reads its value, which Babel
 * gives a node of its own.
 */
function readsName(expression: AstNode): boolean {
  let reads = false
  walkAst(expression, (node, ancestors) => {
    if (node.type !== 'Identifier') return
    const parent = ancestors.at(-1)
    const isKey = (parent?.type === 'ObjectProperty' || parent?.type === 'ObjectMethod')
      && parent.key === node
      && parent.computed !== true
    if (!isKey) reads = true
  })
  return reads
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

    if (!key || !isPdfDefinitionKey(key)) {
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

    if (!PDF_DEFINITION_KEYS[key].function && isFunctionProperty(property)) {
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
    .filter(([key]) => isPdfDefinitionKey(key) && PDF_DEFINITION_KEYS[key].production)
    .map(([, property]) => {
      const start = requiredOffset(property.start, filename, block)
      const end = requiredOffset(property.end, filename, block)
      return block.content.slice(start, end)
    })

  return `{${retained.join(',')}}`
}

function isFunctionProperty(property: AstNode): boolean {
  if (property.type === 'ObjectMethod') return true

  const value = asAstNode(property.value)
  return value?.type === 'ArrowFunctionExpression'
    || value?.type === 'FunctionExpression'
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
