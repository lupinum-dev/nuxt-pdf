// The var() and v-bind() references in style values, and the :root variables they read.

import type { ChildNode, Declaration } from 'postcss'
import type { FilePosition } from '../sfc/errors'
import { asAstNode, expressionStatements } from '../sfc/script-ast'
import type { FailAt, Sheet } from './sheets'

export type Variables = ReadonlyMap<string, string>

const VARIABLE_NAME = /^--[\w-]+$/

export const IMPORTANT = '!important is not supported in PDF styles; a style object already wins over classes.'

const MAX_RESOLVED_LENGTH = 10_000

const BOUND_IMPORTED = 'v-bind() is not allowed in an imported file: it has no script. Declare the variable in :root of the importing file: --name: v-bind(value).'

export const isRootRule = (node: ChildNode): boolean =>
  node.type === 'rule' && node.selectors.length === 1 && node.selectors[0]!.trim() === ':root'

/**
 * The position of `declaration.value[index]`, relative to the sheet. The
 * value may start on a later line than its property.
 */
export const valuePosition = (declaration: Declaration, index = 0): FilePosition | undefined => {
  const start = declaration.source?.start
  if (!start) return undefined
  const before = declaration.prop + (declaration.raws.between ?? ':') + declaration.value.slice(0, index)
  const lineBreaks = before.split('\n').length - 1
  return lineBreaks === 0
    ? { line: start.line, column: start.column + before.length }
    : { line: start.line + lineBreaks, column: before.length - before.lastIndexOf('\n') }
}

type BindingReference = { end: number, expression: string, start: number }

/**
 * Whether `expression` is exactly one expression. The parentheses must span
 * the whole input: `a), (b` would otherwise parse as two and shift every
 * later binding of the getter by one.
 */
const isExpression = (expression: string, typescript: boolean): boolean => {
  const body = expressionStatements(expression, { parenthesized: true, typescript })
  const statement = body?.length === 1 ? body[0] : undefined
  const parenthesized = statement?.type === 'ExpressionStatement' ? asAstNode(statement.expression) : undefined
  return parenthesized?.type === 'ParenthesizedExpression'
    && parenthesized.start === 0
    && parenthesized.end === expression.length + 2
}

/**
 * Finds every `v-bind(expression)` in a value, with Vue's syntax: the
 * expression bare or in quotes. Text inside quotes of the value stays
 * literal, as for `var()`.
 */
export const bindingReferences = (value: string, typescript: boolean, fail: (index: number, message: string) => never): BindingReference[] => {
  const references: BindingReference[] = []
  let quote: string | undefined
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!
    if (quote) {
      if (character === '\\') index += 1
      else if (character === quote) quote = undefined
      continue
    }
    if (character === '"' || character === '\'') {
      quote = character
      continue
    }
    if (!value.startsWith('v-bind(', index)) continue
    let end = index + 'v-bind('.length
    let inner: string | undefined
    for (let depth = 1; end < value.length; end += 1) {
      const next = value[end]!
      if (inner) {
        if (next === '\\') end += 1
        else if (next === inner) inner = undefined
        continue
      }
      if (next === '"' || next === '\'' || next === '`') inner = next
      else if (next === '(') depth += 1
      else if (next === ')' && --depth === 0) break
    }
    const written = value.slice(index, end + 1)
    const content = value.slice(index + 'v-bind('.length, end).trim()
    const expression = (/^(["'])([\s\S]*)\1$/.exec(content)?.[2] ?? content).trim()
    if (end >= value.length || !expression || !isExpression(expression, typescript)) {
      if (end < value.length && expression && !typescript && isExpression(expression, true)) {
        fail(index, `${written} uses TypeScript syntax, but the <script> of this file is JavaScript. Write a JavaScript expression, or add lang="ts" to the <script> block.`)
      }
      fail(index, `v-bind() takes one JavaScript expression, such as v-bind(accent) or v-bind('theme.ink'); found "${written}".`)
    }
    references.push({ end: end + 1, expression, start: index })
    index = end
  }
  return references
}

/** Rejects or checks the `v-bind()` written in one declaration of a sheet. */
export const checkBindings = (declaration: Declaration, sheet: Sheet): void => {
  const fail = (index: number, message: string) => sheet.failAt(valuePosition(declaration, index), message)
  const references = bindingReferences(declaration.value, sheet.typescript, fail)
  if (sheet.imported && references.length > 0) fail(references[0]!.start, BOUND_IMPORTED)
}

type VariableReference = { end: number, name: string, position: FilePosition | undefined, start: number }

/**
 * Finds every `var(--name)` in a declaration value. Text inside quotes stays
 * literal, as in CSS.
 */
export const variableReferences = (declaration: Declaration, failAt: FailAt): VariableReference[] => {
  const value = declaration.value
  const references: VariableReference[] = []
  let quote: string | undefined
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!
    if (quote) {
      if (character === '\\') index += 1
      else if (character === quote) quote = undefined
      continue
    }
    if (character === '"' || character === '\'') {
      quote = character
      continue
    }
    if (!value.startsWith('var(', index)) continue
    let end = index + 'var'.length
    for (let depth = 0; end < value.length; end += 1) {
      if (value[end] === '(') depth += 1
      if (value[end] === ')' && --depth === 0) break
    }
    const position = valuePosition(declaration, index)
    const name = value.slice(index + 'var('.length, end).trim()
    if (end >= value.length || !VARIABLE_NAME.test(name)) failAt(position, 'var() takes one variable name, for example var(--ink).')
    references.push({ end: end + 1, name, position, start: index })
    index = end
  }
  return references
}

/**
 * Replaces the variable references of a declaration by the text that
 * `lookup` returns. Substitution is textual; the caller validates the result.
 */
export const substituteVariables = (
  declaration: Declaration,
  references: readonly VariableReference[],
  failAt: FailAt,
  lookup: (name: string, position: FilePosition | undefined) => string,
): string => {
  const value = declaration.value
  let result = ''
  let from = 0
  for (const reference of references) {
    result += value.slice(from, reference.start) + lookup(reference.name, reference.position)
    from = reference.end
    if (result.length > MAX_RESOLVED_LENGTH) {
      failAt(reference.position, `This value is longer than ${MAX_RESOLVED_LENGTH} characters after var() substitution. Check for variables that repeat other variables.`)
    }
  }
  return result + value.slice(from)
}

/**
 * Collects the `:root` custom properties of all blocks of one file and
 * resolves each to plain text. A later declaration of a name wins, as in CSS.
 * Resolution walks an explicit stack, so a long chain cannot overflow the
 * call stack, and each variable is resolved once.
 */
export const collectVariables = (sheets: readonly Sheet[]): Variables => {
  const declared = new Map<string, { declaration: Declaration, failAt: FailAt, references: VariableReference[] }>()
  for (const sheet of sheets) {
    const { failAt, root } = sheet
    for (const node of root.nodes) {
      if (node.type !== 'rule' || !isRootRule(node)) continue
      for (const child of node.nodes) {
        if (child.type === 'comment') continue
        if (child.type !== 'decl' || !VARIABLE_NAME.test(child.prop)) {
          return failAt(child.source?.start, ':root holds variables only (--name: value).')
        }
        const declaration = child
        if (declaration.important) failAt(declaration.source?.start, IMPORTANT)
        checkBindings(declaration, sheet)
        declared.set(declaration.prop, { declaration, failAt, references: variableReferences(declaration, failAt) })
      }
    }
  }

  const resolved = new Map<string, string>()
  const resolving = new Set<string>()
  // Per variable, the first reference that may still be unresolved.
  const cursors = new Map<string, number>()
  for (const root of declared.keys()) {
    const stack = [root]
    while (stack.length > 0) {
      const name = stack.at(-1)!
      if (resolved.has(name)) {
        stack.pop()
        continue
      }
      const { declaration, failAt, references } = declared.get(name)!
      resolving.add(name)
      let cursor = cursors.get(name) ?? 0
      while (cursor < references.length && resolved.has(references[cursor]!.name)) cursor += 1
      cursors.set(name, cursor)
      const pending = references[cursor]
      if (pending) {
        if (resolving.has(pending.name)) failAt(pending.position, `Variable "${pending.name}" refers to itself.`)
        if (!declared.has(pending.name)) failAt(pending.position, unknownVariable(pending.name))
        stack.push(pending.name)
        continue
      }
      resolved.set(name, substituteVariables(declaration, references, failAt, inner => resolved.get(inner)!).trim())
      resolving.delete(name)
      stack.pop()
    }
  }
  return resolved
}

export const unknownVariable = (name: string): string =>
  `Unknown variable "${name}". Declare it in :root { ${name}: … }.`
