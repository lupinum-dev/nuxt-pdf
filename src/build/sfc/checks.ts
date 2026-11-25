// Authoring checks of a PDF SFC: blocks, top-level await, removed API and props, unknown components, teleport, v-show.

import type { SFCDescriptor } from '@vue/compiler-sfc'
import { PDF_COMPONENT_NAMES } from '../../runtime/component-names'
import { isRemovedPdfProp, unsupportedPdfPropMessage } from '../../runtime/shared/removed-props'
import { errorAtBlock, errorAtNode, errorAtTemplateNode, PdfSfcCompileError } from './errors'
import { asAstNode, type AstNode, metadataKey, type PdfSfc, programBody, scriptBindings, walkAst } from './script-ast'
import { camelize } from 'vue'
import { ATTRIBUTE_NODE, boundName, COMPONENT_TAG, DIRECTIVE_NODE, pascalTag, PDF_COMPONENT_TAGS, walkElements } from './template-ast'
import { componentName } from './vue-compiler'

const UNSUPPORTED_STYLE_ATTRIBUTES = ['scoped', 'module', 'lang', 'src'] as const

export function assertSupportedBlocks(descriptor: SFCDescriptor, filename: string): void {
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

export function assertTemplate(descriptor: SFCDescriptor, filename: string): void {
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

export function assertSynchronousSetup({ descriptor, filename, program }: PdfSfc): void {
  const block = descriptor.scriptSetup
  if (!block) return

  walkAst(program(block), (node, ancestors) => {
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

/**
 * Vue compiles `defineOptions()` away only as a top-level statement. Anywhere
 * else the call stays in the code and fails at render, without a position.
 */
export function assertDefineOptionsStatements(sfc: PdfSfc): void {
  const block = sfc.descriptor.scriptSetup
  const misplaced = sfc.macroCalls(block).defineOptions.find(call => !call.statement)
  if (block && misplaced) {
    throw errorAtNode(sfc.filename, block, misplaced.call, 'defineOptions() must be a standalone top-level statement in <script setup>.')
  }
}

// Temporary hints for API removed on the way to 1.0 (internals/migrations.md).
const REMOVED_API: Readonly<Record<string, string>> = {
  usePdfPageNumbers: 'usePdfPageNumbers() was removed. Print the page of a destination with <PdfPageRef to="id" /> inside a <PdfText>.',
}

export function assertNoRemovedApi({ descriptor, filename, program }: PdfSfc): void {
  for (const block of [descriptor.script, descriptor.scriptSetup]) {
    if (!block) continue
    walkAst(program(block), (node) => {
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
export function assertNoRemovedProps(descriptor: SFCDescriptor, filename: string): void {
  const ast = descriptor.template?.ast
  if (!ast) return

  const found: { line: number, column: number, message: string }[] = []
  walkElements(ast, undefined, (node) => {
    const tag = pascalTag(node.tag)
    if (!PDF_COMPONENT_TAGS.has(tag)) return

    for (const prop of node.props) {
      const key = prop.type === ATTRIBUTE_NODE ? prop.name : boundName(prop)
      if (!key || !isRemovedPdfProp(key)) continue
      found.push({
        line: prop.loc.start.line,
        column: prop.loc.start.column,
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

export function assertSupportedTemplate(sfc: PdfSfc): void {
  const { descriptor, filename } = sfc
  const ast = descriptor.template?.ast
  if (!ast) return

  const provided = providedComponents(sfc)
  walkElements(ast, undefined, (node) => {
    const name = node.tagType === COMPONENT_TAG ? pascalTag(node.tag) : undefined
    if (name && /^Pdf[A-Z]/.test(name) && !PDF_COMPONENT_TAGS.has(name) && !provided(node.tag)) {
      const nearest = nearestComponentName(name)
      throw errorAtTemplateNode(
        filename,
        node,
        `Unknown component <${node.tag}>.${nearest ? ` Did you mean <${nearest}>?` : ''} PDF templates can use the Pdf components of @lupinum/nuxt-pdf and components they import.`,
      )
    }

    if (node.tag.toLowerCase() === 'teleport') {
      throw errorAtTemplateNode(
        filename,
        node,
        'Teleport is not supported in PDF templates because the PDF renderer has no external host target.',
      )
    }

    const show = node.props.find(prop => prop.type === DIRECTIVE_NODE && prop.name === 'show')
    if (show) {
      throw errorAtTemplateNode(
        filename,
        show,
        'v-show is not supported in PDF templates. Use v-if; PDF styles are not browser CSS.',
      )
    }
  })
}

/** The names Vue tries for a tag, in its order: as written, camelCase, PascalCase. */
const tagNames = (tag: string): string[] => [tag, camelize(tag), pascalTag(tag)]

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
  const exported = programBody(program).find(statement => statement.type === 'ExportDefaultDeclaration')
  if (!exported) return null
  const declaration = asAstNode(exported.declaration)
  if (declaration?.type === 'CallExpression' && Array.isArray(declaration.arguments)) return asAstNode(declaration.arguments[0])
  return declaration
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
function providedComponents({ descriptor, filename, macroCalls, program }: PdfSfc): (tag: string) => boolean {
  const names = new Set<string>()
  let open = false
  if (descriptor.scriptSetup) {
    for (const name of scriptBindings(program(descriptor.scriptSetup))) names.add(name)
    // The options object of the first top-level `defineOptions({…})`.
    const call = macroCalls(descriptor.scriptSetup).defineOptions.find(macro => macro.statement)?.call
    const options = Array.isArray(call?.arguments) ? asAstNode(call.arguments[0]) : undefined
    if (options) {
      const keys = componentOptionKeys(options)
      if (keys) keys.forEach(key => names.add(key))
      else open = true
    }
  }
  if (descriptor.script) {
    const options = defaultExportOptions(program(descriptor.script))
    const keys = options === null ? [] : componentOptionKeys(options)
    if (keys) keys.forEach(key => names.add(key))
    else open = true
  }
  const self = pascalTag(componentName(filename))
  return (tag) => {
    if (open) return true
    const [root = tag] = tag.split('.', 1)
    if (root !== tag) return names.has(root)
    return pascalTag(tag) === self || tagNames(tag).some(name => names.has(name))
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
