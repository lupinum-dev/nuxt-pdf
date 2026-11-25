// Babel's view of script code: parse each block once, walk it, and read names, bindings and imports.

import { babelParse, type SFCDescriptor, type SFCScriptBlock } from '@vue/compiler-sfc'
import { classNames } from '../../runtime/shared/template'
import { normalizeCompilerError } from './errors'

export type AstLocation = {
  start: { column: number, line: number }
}

export type AstNode = {
  [key: string]: unknown
  end?: number | null
  loc?: AstLocation | null
  start?: number | null
  type: string
}

/** A `definePdf()` or `defineOptions()` call in one script block. */
export type MacroCall = {
  /** The argument, when the call has exactly one. */
  argument?: AstNode
  block: SFCScriptBlock
  call: AstNode
  /** The `ExpressionStatement`, when the call is a top-level statement. */
  statement?: AstNode
}

/** The macro calls of one script block, in source order. */
export type MacroCalls = Readonly<Record<'defineOptions' | 'definePdf', readonly MacroCall[]>>

const NO_MACRO_CALLS: MacroCalls = { defineOptions: [], definePdf: [] }

/**
 * A parsed SFC whose script blocks each parse once, on first use; every check
 * reads that program. The macro calls of a block are found in one walk, on
 * first use.
 */
export type PdfSfc = {
  descriptor: SFCDescriptor
  filename: string
  macroCalls(block: SFCScriptBlock | null): MacroCalls
  program(block: SFCScriptBlock): AstNode
}

/** The import sources of compiled module code: static imports and re-exports. */
export function moduleImportSources(code: string): string[] {
  const program = parseProgram(code, { sourceType: 'module' })
  const sources = moduleStatements(program).map(statement => asAstNode(statement.source)?.value)
  return [...new Set(sources.filter(source => typeof source === 'string'))]
}

/** The top-level statements of a program. */
export function programBody(program: AstNode): AstNode[] {
  return (Array.isArray(program.body) ? program.body : [])
    .map(asAstNode)
    .filter(node => node !== undefined)
}

/** Top-level statements with a module source: imports and re-exports. */
export function moduleStatements(program: AstNode): AstNode[] {
  return programBody(program)
    .filter(node => /^(?:Import|ExportNamed|ExportAll)Declaration$/.test(node.type))
}

export function pdfSfc(descriptor: SFCDescriptor, filename: string): PdfSfc {
  const programs = new Map<SFCScriptBlock, AstNode>()
  const macros = new Map<SFCScriptBlock, MacroCalls>()
  const program = (block: SFCScriptBlock): AstNode => {
    let parsed = programs.get(block)
    if (parsed === undefined) {
      parsed = parseScriptProgram(block, filename)
      programs.set(block, parsed)
    }
    return parsed
  }
  return {
    descriptor,
    filename,
    macroCalls(block) {
      if (!block) return NO_MACRO_CALLS
      let calls = macros.get(block)
      if (calls === undefined) {
        calls = findMacroCalls(program(block), block)
        macros.set(block, calls)
      }
      return calls
    },
    program,
  }
}

/** Every `definePdf()` and `defineOptions()` call of a block, at any depth. */
function findMacroCalls(program: AstNode, block: SFCScriptBlock): MacroCalls {
  const calls = { defineOptions: [] as MacroCall[], definePdf: [] as MacroCall[] }

  walkAst(program, (node, ancestors) => {
    if (node.type !== 'CallExpression') return

    const callee = asAstNode(node.callee)
    const name = callee?.type === 'Identifier' ? callee.name : undefined
    if (name !== 'definePdf' && name !== 'defineOptions') return

    const parent = ancestors.at(-1)
    const grandparent = ancestors.at(-2)
    const isTopLevelStatement = parent?.type === 'ExpressionStatement'
      && parent.expression === node
      && grandparent?.type === 'Program'
    const args = Array.isArray(node.arguments) ? node.arguments : []

    calls[name].push({
      argument: args.length === 1 ? asAstNode(args[0]) : undefined,
      block,
      call: node,
      statement: isTopLevelStatement ? parent : undefined,
    })
  })

  return calls
}

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
export function scriptBindings(program: AstNode): string[] {
  return programBody(program).flatMap((node): string[] => {
    const declaration = node.type === 'ExportNamedDeclaration' ? asAstNode(node.declaration) : node
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
 * Babel's parse, with the program as the plain node records the checks read
 * by key. Babel's node interfaces have no index signature, so this one
 * boundary converts through `unknown`.
 */
function parseProgram(code: string, options: Parameters<typeof babelParse>[1]): AstNode {
  return babelParse(code, options).program as unknown as AstNode
}

function parseScriptProgram(
  block: SFCScriptBlock,
  filename: string,
): AstNode {
  const plugins: Array<'jsx' | 'typescript'> = []
  if (block.lang === 'ts' || block.lang === 'tsx') plugins.push('typescript')
  if (block.lang === 'jsx' || block.lang === 'tsx') plugins.push('jsx')

  try {
    return parseProgram(block.content, { plugins, sourceType: 'module' })
  }
  catch (error) {
    throw normalizeCompilerError(error, filename, block)
  }
}

export function metadataKey(node: AstNode | undefined): string | undefined {
  if (!node) return undefined
  if (node.type === 'Identifier' && typeof node.name === 'string') return node.name
  if (node.type === 'StringLiteral' && typeof node.value === 'string') return node.value
  return undefined
}

/**
 * Visits every node under `root`, parents first. `ancestors` is the path from
 * `root` to the node; it is one array, valid during the visit only.
 */
export function walkAst(
  root: AstNode,
  visit: (node: AstNode, ancestors: readonly AstNode[]) => void,
): void {
  const ancestors: AstNode[] = []
  const walk = (node: AstNode): void => {
    visit(node, ancestors)
    ancestors.push(node)
    for (const value of Object.values(node)) {
      if (!Array.isArray(value)) {
        const child = asAstNode(value)
        if (child) walk(child)
        continue
      }
      for (const item of value) {
        const child = asAstNode(item)
        if (child) walk(child)
      }
    }
    ancestors.pop()
  }
  walk(root)
}

export function asAstNode(value: unknown): AstNode | undefined {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && typeof value.type === 'string'
    ? value as AstNode
    : undefined
}

/**
 * The statements Babel reads from `(expression)`, or `undefined` when it does
 * not parse. With `parenthesized`, the parentheses are a node of their own, so
 * a caller can check that they span the whole input.
 */
export function expressionStatements(
  expression: string,
  { parenthesized = false, typescript = true }: { parenthesized?: boolean, typescript?: boolean } = {},
): AstNode[] | undefined {
  try {
    return programBody(parseProgram(`(${expression})`, {
      createParenthesizedExpressions: parenthesized,
      plugins: typescript ? ['typescript'] : [],
    }))
  }
  catch {
    return undefined
  }
}

/** Class names written as literals in a `:class` expression. */
export const literalClassNames = (expression: string): string[] => {
  const names: string[] = []
  const visit = (value: unknown): void => {
    const record = asAstNode(value)
    if (!record) return
    switch (record.type) {
      case 'ExpressionStatement':
      case 'TSAsExpression':
      case 'ParenthesizedExpression':
        visit(record.expression)
        return
      case 'StringLiteral':
        names.push(...classNames(String(record.value)))
        return
      case 'ArrayExpression':
        for (const element of record.elements as unknown[]) visit(element)
        return
      case 'ConditionalExpression':
        visit(record.consequent)
        visit(record.alternate)
        return
      case 'LogicalExpression':
        visit(record.right)
        return
      case 'ObjectExpression':
        for (const item of record.properties as unknown[]) {
          const property = asAstNode(item)
          if (property?.type !== 'ObjectProperty' || property.computed === true) continue
          const key = asAstNode(property.key)
          if (key?.type === 'Identifier') names.push(String(key.name))
          if (key?.type === 'StringLiteral') names.push(...classNames(String(key.value)))
        }
    }
  }
  for (const statement of expressionStatements(expression) ?? []) visit(statement)
  return names
}

/**
 * The free names an expression reads. Property names and object keys are
 * not names; function bodies are skipped (their parameters would shadow).
 */
export const readNames = (expression: string): Set<string> => {
  const names = new Set<string>()
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    const node = asAstNode(value)
    if (!node) return
    switch (node.type) {
      case 'Identifier':
        names.add(String(node.name))
        return
      case 'ArrowFunctionExpression':
      case 'FunctionExpression':
        return
      case 'MemberExpression':
      case 'OptionalMemberExpression':
        visit(node.object)
        if (node.computed === true) visit(node.property)
        return
      case 'ObjectProperty':
        if (node.computed === true) visit(node.key)
        visit(node.value)
        return
    }
    for (const [key, value] of Object.entries(node)) {
      if (key !== 'loc' && key !== 'extra' && typeof value === 'object') visit(value)
    }
  }
  visit(expressionStatements(expression)?.[0])
  return names
}

/** The names a parameter list declares (`item, index`, `{ row, total: sum }`). */
export const declaredNames = (parameters: string): string[] => {
  const statement = expressionStatements(`(${parameters}) => 0`)?.[0]
  const arrow = asAstNode(statement?.expression)
  const names: string[] = []
  const visit = (value: unknown): void => {
    const node = asAstNode(value)
    if (!node) return
    switch (node.type) {
      case 'Identifier':
        names.push(String(node.name))
        return
      case 'ObjectPattern':
        for (const property of node.properties as unknown[]) {
          const entry = asAstNode(property)
          visit(entry?.type === 'ObjectProperty' ? entry.value : entry)
        }
        return
      case 'ArrayPattern':
        for (const element of node.elements as unknown[]) visit(element)
        return
      case 'RestElement':
        visit(node.argument)
        return
      case 'AssignmentPattern':
        visit(node.left)
    }
  }
  if (arrow) for (const parameter of arrow.params as unknown[]) visit(parameter)
  return names
}
