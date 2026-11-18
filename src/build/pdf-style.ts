import { readFileSync, realpathSync, statSync, type Stats } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { babelParse, type SFCStyleBlock } from '@vue/compiler-sfc'
import postcss, { CssSyntaxError, type AtRule, type ChildNode, type Declaration } from 'postcss'
import { PDF_STYLE_VALUES, type PdfStyleValueRule } from '../runtime/authoring'
import { PDF_PRIMITIVE_TABLE } from '../runtime/primitives'
import {
  NUMBER,
  expectedPdfStyleValue as expectedText,
  hasAlpha,
  parsePdfStyleValue,
  pdfStyleSignProblem,
  splitValue,
} from '../runtime/shared/style-values'

/**
 * The `<style>` block of a PDF SFC, compiled at build time. Each rule keeps
 * its selectors, a plain `PdfStyle` object and, when it uses `v-bind()`, the
 * keys whose value comes from a bound expression (key → index into
 * `PdfCompiledStyles.bindings`). The order is the source order, which decides
 * between rules of equal specificity as in CSS.
 *
 * A selector is a string: compounds separated by a space (descendant steps),
 * classes of one compound joined by `.`. `"title"`, `"row.total"`,
 * `"total cell"`. Class names hold neither.
 */
export type PdfClassRule = readonly [
  selectors: readonly string[],
  style: Readonly<Record<string, number | string>>,
  bound?: Readonly<Record<string, number>>,
]

export type PdfCompiledStyles = {
  /** The `v-bind()` expressions of the file, in first-use order. */
  bindings: readonly string[]
  rules: readonly PdfClassRule[]
}

export type PdfStyleOptions = {
  /** Path aliases (Nuxt's `~`, `@`, `~~` …) for `@import`. */
  alias?: Readonly<Record<string, string>>
  /** The SFC file, absolute. Relative `@import` paths start here. */
  filename: string
  /** Called with every imported `.css` file, for the bundler's watcher. */
  onDependency?: (file: string) => void
  /** `@import` cannot leave this directory. */
  rootDir: string
  /** The `<script>` of the file is TypeScript, so `v-bind()` may use its syntax. */
  typescript?: boolean
}

/** `file` is set for a failure inside an imported `.css` file. */
export type PdfStyleFailure = (line: number, column: number, message: string, file?: string) => Error

type StyleValue = number | string
type Position = { column: number, line: number }
type FailAt = (position: Position | undefined, message: string) => never
type Variables = ReadonlyMap<string, string>
/** One parsed stylesheet: a `<style>` block or an imported file. */
type Sheet = { failAt: FailAt, imported: boolean, root: postcss.Root, typescript: boolean }

// CSS identifiers: ASCII letters, digits, `-`, `_` and any non-ASCII letter.
const CLASS_NAME = /^-?[_a-z\u0080-\u{10FFFF}][\w\u0080-\u{10FFFF}-]*$/iu
const VARIABLE_NAME = /^--[\w-]+$/
const IMPORTANT = '!important is not supported in PDF styles; a style object already wins over classes.'
const SUPPORTED_UNITS = 'pt, px, in, mm, cm, rem, vh, vw and %'
/** Browser units the engine does not read; the length units it reads are in `PDF_UNIT_LENGTH`. */
const UNSUPPORTED_UNIT = new RegExp(`(?<![\\w.-])${NUMBER}(em|ex|ch|vmin|vmax)(?![\\w-])`, 'i')
const MAX_RESOLVED_LENGTH = 10_000
/** A bound value inside a value string while it is expanded: NUL, index, NUL. */
const BOUND_MARK = '\u0000'
const BOUND_VALUE = /^\0(\d+)\0$/
const boundValue = (index: number): string => `${BOUND_MARK}${index}${BOUND_MARK}`
const BOUND_WHOLE = 'v-bind() must be a whole value. Put the unit into the bound value, such as \'12pt\'.'
const BOUND_IMPORTED = 'v-bind() is not allowed in an imported file: it has no script. Declare the variable in :root of the importing file: --name: v-bind(value).'
const SELECTOR_HINT = 'Use class selectors: .a, .a.b or .a .b.'
const COMPOUND_SELECTOR = /^(?:\.-?[_a-z\u0080-\u{10FFFF}][\w\u0080-\u{10FFFF}-]*)+$/iu

const SIDES = ['Top', 'Right', 'Bottom', 'Left'] as const
const CORNERS = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'] as const

const PROPERTY_HINTS: Record<string, string> = {
  'background': ' Use background-color.',
  'font': ' Use font-size, font-family and font-weight.',
  'text-decoration-line': ' Use text-decoration.',
}

const PRIMITIVES_WITHOUT_STYLE = new Set(
  Object.entries(PDF_PRIMITIVE_TABLE)
    .filter(([, primitive]) => !Object.hasOwn(primitive.props, 'style'))
    .map(([name]) => name),
)

/** The runtime helper that resolves classes; a global property of the PDF app. */
export const PDF_CLASS_HELPER = '$nuxtPdfClass'

const isStyleKey = (key: string): key is keyof typeof PDF_STYLE_VALUES =>
  Object.hasOwn(PDF_STYLE_VALUES, key)

const kebabToCamel = (property: string): string =>
  property.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())

/** Parses one value by its rule. A bound value passes as it is: the render-time check validates it. */
const parseValue = (rule: PdfStyleValueRule, value: string): StyleValue | undefined =>
  BOUND_VALUE.test(value) ? value : parsePdfStyleValue(rule, value)

/** CSS box order: one to four values for top, right, bottom, left. */
const boxValues = <Value>(values: readonly Value[]): readonly [Value, Value, Value, Value] => {
  const [top, right = top, bottom = top, left = right] = values
  return [top!, right!, bottom!, left!]
}

/** A rejection with its own message instead of "Invalid value … expected …". */
class ExpansionFailure {
  constructor(readonly message: string) {}
}

type Expansion = Record<string, StyleValue> | string | ExpansionFailure

/**
 * Turns one declaration into `PdfStyle` longhands. A string result is the
 * "expected …" text of an invalid value.
 */
const expandDeclaration = (key: string, value: string): Expansion => {
  const parts = splitValue(value)
  if (parts.some(part => part.includes(BOUND_MARK) && !BOUND_VALUE.test(part))) return new ExpansionFailure(BOUND_WHOLE)
  const each = (rule: PdfStyleValueRule): StyleValue[] | undefined => {
    const values = parts.map(part => parseValue(rule, part))
    return values.every(item => item !== undefined) ? values as StyleValue[] : undefined
  }
  const box = (prefix: string, suffix: string, rule: PdfStyleValueRule, names: readonly string[] = SIDES): Expansion => {
    const values = parts.length >= 1 && parts.length <= 4 ? each(rule) : undefined
    if (!values) return `one to four values, each ${expectedText(rule)}`
    const sides = boxValues(values)
    return Object.fromEntries(names.map((name, index) => [`${prefix}${name}${suffix}`, sides[index]!]))
  }
  const pair = (prefix: string, names: readonly [string, string], rule: PdfStyleValueRule): Expansion => {
    const values = parts.length === 1 ? each(rule) : undefined
    if (!values) return expectedText(rule)
    return { [`${prefix}${names[0]}`]: values[0]!, [`${prefix}${names[1]}`]: values[0]! }
  }

  switch (key) {
    case 'margin':
    case 'padding':
      return box(key, '', PDF_STYLE_VALUES[`${key}Top`])
    case 'marginHorizontal':
    case 'paddingHorizontal':
      return pair(key.replace('Horizontal', ''), ['Right', 'Left'], PDF_STYLE_VALUES[key])
    case 'marginVertical':
    case 'paddingVertical':
      return pair(key.replace('Vertical', ''), ['Top', 'Bottom'], PDF_STYLE_VALUES[key])
    case 'borderWidth':
    case 'borderColor':
    case 'borderStyle':
      return box('border', key.slice('border'.length), PDF_STYLE_VALUES[`borderTop${key.slice('border'.length) as 'Width' | 'Color' | 'Style'}`])
    case 'borderRadius':
      return box('border', 'Radius', PDF_STYLE_VALUES.borderTopLeftRadius, CORNERS)
    case 'border':
    case 'borderTop':
    case 'borderRight':
    case 'borderBottom':
    case 'borderLeft':
      return expandBorder(key, parts)
    case 'flex':
      return expandFlex(parts)
  }

  if (!isStyleKey(key)) throw new Error(`Unhandled PDF style key ${key}`)
  if (value.includes(BOUND_MARK)) {
    return parts.length === 1 ? { [key]: parts[0]! } : new ExpansionFailure(BOUND_WHOLE)
  }
  const rule = PDF_STYLE_VALUES[key]
  const single = typeof rule === 'string' && rule !== 'fontFamily' && rule !== 'transform' && parts.length !== 1
  const parsed = single ? undefined : parseValue(rule, value.trim())
  return parsed === undefined ? expectedText(rule) : { [key]: parsed }
}

const BORDER_EXPECTED = 'a width, a color and optionally a style, in any order, such as 1pt solid #CCCCCC'

/**
 * `border` and `border-<side>`. Without a style the engine paints `solid`
 * (its default in `renderBorders`); the style is written out so that the
 * shorthand also resets the style of an earlier rule, as in CSS. A bound
 * part takes the one slot that the static parts leave open.
 */
const expandBorder = (key: string, parts: readonly string[]): Expansion => {
  const property = key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)
  const boundFailure = new ExpansionFailure(`v-bind() in "${property}" needs the other parts written out, such as "1pt solid v-bind(color)". Or use the longhands ${property}-width, ${property}-style and ${property}-color.`)
  if (parts.length === 1 && BOUND_VALUE.test(parts[0]!)) return boundFailure
  if (parts.length < 2 || parts.length > 3) return BORDER_EXPECTED
  const slots: { color?: StyleValue, style?: StyleValue, width?: StyleValue } = {}
  const bound: string[] = []
  for (const part of parts) {
    if (BOUND_VALUE.test(part)) {
      bound.push(part)
      continue
    }
    const asStyle = parseValue(PDF_STYLE_VALUES.borderStyle, part)
    const asWidth = parseValue('length', part)
    const asColor = parseValue('color', part)
    if (asStyle !== undefined && slots.style === undefined) slots.style = asStyle
    else if (asWidth !== undefined && slots.width === undefined) slots.width = asWidth
    else if (asColor !== undefined && slots.color === undefined) slots.color = asColor
    else return BORDER_EXPECTED
  }
  if (bound.length > 0) {
    const open = (['width', 'color'] as const).filter(slot => slots[slot] === undefined)
    const target = bound.length === 1 && open.length <= 1 ? open[0] ?? (slots.style === undefined ? 'style' : undefined) : undefined
    if (target === undefined) return boundFailure
    slots[target] = bound[0]!
  }
  const { width, style = 'solid', color } = slots
  if (width === undefined || color === undefined) return BORDER_EXPECTED
  const sides = key === 'border' ? SIDES : [key.slice('border'.length)]
  return Object.fromEntries(sides.flatMap(side => [
    [`border${side}Width`, width],
    [`border${side}Style`, style],
    [`border${side}Color`, color],
  ]))
}

const FLEX_EXPECTED = 'a number, auto, none, or grow shrink basis (such as 1 0 auto)'

const expandFlex = (parts: readonly string[]): Expansion => {
  const flex = (flexGrow: StyleValue, flexShrink: StyleValue, flexBasis: StyleValue) =>
    ({ flexGrow, flexShrink, flexBasis })
  if (parts.length === 1) {
    if (BOUND_VALUE.test(parts[0]!)) {
      return new ExpansionFailure('v-bind() in "flex" needs three parts (grow shrink basis), such as "v-bind(grow) 1 0". Or use flex-grow, flex-shrink and flex-basis.')
    }
    if (parts[0] === 'auto') return flex(1, 1, 'auto')
    if (parts[0] === 'none') return flex(0, 0, 'auto')
    const grow = parseValue('number', parts[0]!)
    // The engine reads `flex: n` as grow n, shrink 1, basis 0.
    return grow === undefined ? FLEX_EXPECTED : flex(grow, 1, 0)
  }
  if (parts.length !== 3) return FLEX_EXPECTED
  const grow = parseValue('number', parts[0]!)
  const shrink = parseValue('number', parts[1]!)
  const basis = parseValue('lengthOrPercentageOrAuto', parts[2]!)
  return grow === undefined || shrink === undefined || basis === undefined
    ? FLEX_EXPECTED
    : flex(grow, shrink, basis)
}

const SHORTHAND_KEYS = new Set(['border', 'borderTop', 'borderRight', 'borderBottom', 'borderLeft'])

const isRootRule = (node: ChildNode): boolean =>
  node.type === 'rule' && node.selectors.length === 1 && node.selectors[0]!.trim() === ':root'

/**
 * The position of `declaration.value[index]`, relative to the sheet. The
 * value may start on a later line than its property.
 */
const valuePosition = (declaration: Declaration, index = 0): Position | undefined => {
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
  try {
    const wrapped = `(${expression})`
    const { body } = babelParse(wrapped, { createParenthesizedExpressions: true, plugins: typescript ? ['typescript'] : [] }).program
    const statement = body.length === 1 ? body[0]! : undefined
    return statement?.type === 'ExpressionStatement'
      && statement.expression.type === 'ParenthesizedExpression'
      && statement.expression.start === 0
      && statement.expression.end === wrapped.length
  }
  catch {
    return false
  }
}

/**
 * Finds every `v-bind(expression)` in a value, with Vue's syntax: the
 * expression bare or in quotes. Text inside quotes of the value stays
 * literal, as for `var()`.
 */
const bindingReferences = (value: string, typescript: boolean, fail: (index: number, message: string) => never): BindingReference[] => {
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
const checkBindings = (declaration: Declaration, sheet: Sheet): void => {
  const fail = (index: number, message: string) => sheet.failAt(valuePosition(declaration, index), message)
  const references = bindingReferences(declaration.value, sheet.typescript, fail)
  if (sheet.imported && references.length > 0) fail(references[0]!.start, BOUND_IMPORTED)
}

type VariableReference = { end: number, name: string, position: Position | undefined, start: number }

/**
 * Finds every `var(--name)` in a declaration value. Text inside quotes stays
 * literal, as in CSS.
 */
const variableReferences = (declaration: Declaration, failAt: FailAt): VariableReference[] => {
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
const substituteVariables = (
  declaration: Declaration,
  references: readonly VariableReference[],
  failAt: FailAt,
  lookup: (name: string, position: Position | undefined) => string,
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
const collectVariables = (sheets: readonly Sheet[]): Variables => {
  const declared = new Map<string, { declaration: Declaration, failAt: FailAt, references: VariableReference[] }>()
  for (const sheet of sheets) {
    const { failAt, root } = sheet
    for (const node of root.nodes) {
      if (node.type !== 'rule' || !isRootRule(node)) continue
      for (const child of node.nodes) {
        if (child.type === 'comment') continue
        if (child.type !== 'decl' || !VARIABLE_NAME.test(child.prop)) {
          failAt(child.source?.start, ':root holds variables only (--name: value).')
        }
        const declaration = child as Declaration
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

const unknownVariable = (name: string): string =>
  `Unknown variable "${name}". Declare it in :root { ${name}: … }.`

const parseSheet = (content: string, failAt: FailAt): postcss.Root => {
  try {
    return postcss.parse(content)
  }
  catch (error) {
    if (error instanceof CssSyntaxError) {
      return failAt({ line: error.line ?? 1, column: error.column ?? 1 }, `Invalid CSS: ${error.reason}.`)
    }
    throw error
  }
}

const isImport = (node: ChildNode): boolean => node.type === 'atrule' && node.name.toLowerCase() === 'import'
const IMPORT_URL = 'takes a local path in quotes, such as @import \'./theme.css\'.'
const displayPath = (rootDir: string, file: string): string => relative(rootDir, file).replaceAll('\\', '/') || file

/**
 * Resolves the path of one `@import` to a real file inside the project:
 * relative to the importing file, or through an alias.
 */
const resolveImport = (node: AtRule, from: string, options: PdfStyleOptions, failAt: FailAt): string => {
  const at = node.source?.start
  const params = node.params.trim()
  const quote = params[0]
  const close = quote === '"' || quote === '\'' ? params.indexOf(quote, 1) : -1
  if (close === -1) return failAt(at, `@import ${IMPORT_URL}`)
  const path = params.slice(1, close)
  if (params.slice(close + 1).trim()) failAt(at, '@import takes only a path in PDF styles; media queries, layers and supports() are not supported.')
  if (/^[a-z][\w+.-]*:/i.test(path) || path.startsWith('//')) failAt(at, `@import ${IMPORT_URL} URLs are not loaded.`)
  if (!path.toLowerCase().endsWith('.css')) failAt(at, `@import reads .css files only; found "${path}".`)
  // eslint-disable-next-line no-control-regex -- control characters are what this rejects
  if (/[\u0000-\u001F\u007F]/.test(path)) failAt(at, `@import cannot read ${JSON.stringify(path)}: a path cannot hold control characters.`)

  const alias = Object.keys(options.alias ?? {})
    .filter(key => path === key || path.startsWith(`${key}/`))
    .sort((left, right) => right.length - left.length)[0]
  const resolved = path.startsWith('./') || path.startsWith('../')
    ? resolve(dirname(from), path)
    : alias === undefined
      ? failAt(at, `@import takes a path relative to this file or one that starts with an alias, such as ./theme.css or ~~/pdfs/theme.css; found "${path}".`)
      : resolve(options.alias![alias]!, `.${path.slice(alias.length)}`)
  // Watched before the checks, so creating a missing file rebuilds in `nuxt dev`.
  options.onDependency?.(resolved)
  let stats: Stats | undefined
  try {
    stats = statSync(resolved, { throwIfNoEntry: false })
  }
  catch (error) {
    // For example a name too long for the file system.
    failAt(at, `@import cannot read ${JSON.stringify(path)}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!stats?.isFile()) {
    failAt(at, `@import cannot find "${path}" (resolved to ${displayPath(options.rootDir, resolved)}).`)
  }
  const real = realpathSync(resolved)
  if (real !== resolved) options.onDependency?.(real)
  const inside = relative(realpathSync(options.rootDir), real)
  if (inside.startsWith('..') || isAbsolute(inside)) failAt(at, `@import "${path}" leaves the project directory.`)
  return real
}

/** Keeps the last place of each sheet: a browser applies a repeated sheet at each place, and the last one wins. */
const lastPlaces = (sheets: readonly Sheet[]): Sheet[] => sheets.filter((sheet, index) => sheets.lastIndexOf(sheet) === index)

/**
 * Parses the `<style>` blocks and every file they import, in CSS order: an
 * imported sheet comes before the sheet that imports it, so the importing
 * file wins at equal specificity. A file imported twice in one graph is
 * parsed once and counts at its last place, as in a browser.
 */
const loadSheets = (blocks: readonly SFCStyleBlock[], fail: PdfStyleFailure, options: PdfStyleOptions): Sheet[] => {
  const typescript = options.typescript ?? false
  const watched = new Set<string>()
  const report = options.onDependency
  const watching: PdfStyleOptions = {
    ...options,
    onDependency: report && ((file) => {
      if (watched.has(file)) return
      watched.add(file)
      report(file)
    }),
  }
  /** Each imported file with the sheets it brings in, in CSS order. */
  const expanded = new Map<string, Sheet[]>()

  const expand = (sheet: Sheet, from: string, chain: readonly string[]): Sheet[] => {
    const order: Sheet[] = []
    for (const node of sheet.root.nodes) {
      if (node.type === 'comment') continue
      if (node.type !== 'atrule' || !isImport(node)) break
      const file = resolveImport(node, from, watching, sheet.failAt)
      if (chain.includes(file)) {
        const steps = [...chain.slice(chain.indexOf(file)), file].map(step => displayPath(options.rootDir, step))
        sheet.failAt(node.source?.start, `@import "${node.params.trim().slice(1, -1)}" imports itself through ${steps.join(' → ')}.`)
      }
      let imported = expanded.get(file)
      if (!imported) {
        const failAt: FailAt = (position, message) => {
          throw fail(position?.line ?? 1, position?.column ?? 1, message, file.replaceAll('\\', '/'))
        }
        imported = expand({ failAt, imported: true, root: parseSheet(readFileSync(file, 'utf8'), failAt), typescript }, file, [...chain, file])
        expanded.set(file, imported)
      }
      order.push(...imported)
    }
    order.push(sheet)
    return lastPlaces(order)
  }

  const sheets: Sheet[] = []

  for (const block of blocks) {
    const at = (position: Position | undefined): [number, number] => {
      const line = position?.line ?? 1
      const column = position?.column ?? 1
      return line === 1
        ? [block.loc.start.line, block.loc.start.column + column - 1]
        : [block.loc.start.line + line - 1, column]
    }
    const failAt: FailAt = (position, message) => {
      throw fail(...at(position), message)
    }
    sheets.push(...expand({ failAt, imported: false, root: parseSheet(block.content, failAt), typescript }, options.filename, []))
  }
  return lastPlaces(sheets)
}

/** One selector as a `PdfClassRule` selector string, or the rejection text. */
const parseSelector = (selector: string): string | ExpansionFailure => {
  const text = selector.trim()
  const compounds = text.split(/\s+/)
  if (compounds.every(compound => COMPOUND_SELECTOR.test(compound))) {
    return compounds.map(compound => compound.slice(1)).join(' ')
  }
  const pseudo = /::?[\w-]+/.exec(text)?.[0]
  const typeName = compounds.map(compound => /^[a-z][\w-]*/i.exec(compound)?.[0]).find(Boolean)
  const kind = text.includes('>')
    ? 'Child combinator ">"'
    : /[+~]/.exec(text)
      ? `Sibling combinator "${/[+~]/.exec(text)![0]}"`
      : pseudo
        ? `${pseudo.startsWith('::') ? 'Pseudo-element' : 'Pseudo-class'} "${pseudo}"`
        : text.includes('[')
          ? 'Attribute selector'
          : text.includes('#')
            ? 'Id selector'
            : text.includes('*')
              ? 'Universal selector "*"'
              : text.includes('&')
                ? 'Nesting selector "&"'
                : typeName
                  ? `Type selector "${typeName}"`
                  : 'This selector'
  return new ExpansionFailure(`${kind} is not supported in PDF styles; found "${text}". ${SELECTOR_HINT}`)
}

/**
 * Compiles the plain `<style>` blocks of one PDF SFC and the files they
 * import. Every rejection throws through `fail` with the position in the SFC
 * or in the imported file.
 */
export function compilePdfStyles(
  blocks: readonly SFCStyleBlock[],
  fail: PdfStyleFailure,
  options: PdfStyleOptions,
): PdfCompiledStyles {
  const rules: PdfClassRule[] = []
  const bindings: string[] = []
  const sheets = loadSheets(blocks, fail, options)
  const variables = collectVariables(sheets)
  const bind = (expression: string): number => {
    const index = bindings.indexOf(expression)
    return index === -1 ? bindings.push(expression) - 1 : index
  }

  for (const sheet of sheets) {
    const { failAt, root } = sheet
    let afterRule = false
    for (const node of root.nodes) {
      if (node.type === 'comment') continue
      if (isImport(node)) {
        if (afterRule) failAt(node.source?.start, '@import must come before every rule of the style block.')
        continue
      }
      afterRule = true
      if (isRootRule(node)) continue
      if (node.type === 'atrule') {
        failAt(node.source?.start, `@${node.name} is not supported in PDF styles.${node.name === 'font-face' ? ' Register fonts with pdf.fonts.' : ''}`)
      }
      if (node.type === 'decl') {
        if (node.prop.startsWith('--')) failAt(node.source?.start, 'Declare variables in a :root rule.')
        failAt(node.source?.start, 'Declarations must be inside a class rule in PDF styles.')
      }
      if (node.type !== 'rule') continue

      const selectors = node.selectors.map((selector) => {
        const parsed = parseSelector(selector)
        return typeof parsed === 'string' ? parsed : failAt(node.source?.start, parsed.message)
      })
      const style: Record<string, StyleValue> = {}
      const bound: Record<string, number> = {}
      for (const child of node.nodes) compileChild(child, { bind, bound, sheet, style, variables })
      rules.push(Object.keys(bound).length > 0 ? [selectors, style, bound] : [selectors, style])
    }
  }

  return { bindings, rules }
}

type RuleContext = {
  bind: (expression: string) => number
  bound: Record<string, number>
  sheet: Sheet
  style: Record<string, StyleValue>
  variables: Variables
}

function compileChild(child: ChildNode, { bind, bound, sheet, style, variables }: RuleContext): void {
  const { failAt } = sheet
  if (child.type === 'comment') return
  if (child.type !== 'decl') {
    failAt(child.source?.start, 'Nested rules are not supported in PDF styles.')
  }
  const declaration = child as Declaration
  const property = declaration.prop
  if (property.startsWith('--')) failAt(declaration.source?.start, 'Declare variables in a :root rule.')
  if (declaration.important) failAt(declaration.source?.start, IMPORTANT)
  if (/[A-Z]/.test(property)) {
    const kebab = property.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)
    failAt(declaration.source?.start, `Unsupported PDF style property "${property}". Use kebab-case "${kebab}".`)
  }
  const key = kebabToCamel(property)
  if (!isStyleKey(key) && !SHORTHAND_KEYS.has(key)) {
    const hint = PROPERTY_HINTS[property] ?? (property.startsWith('background-') ? PROPERTY_HINTS.background! : '')
    failAt(declaration.source?.start, `Unsupported PDF style property "${property}".${hint}`)
  }

  checkBindings(declaration, sheet)
  const value = substituteVariables(declaration, variableReferences(declaration, failAt), failAt, (name, position) =>
    variables.get(name) ?? failAt(position, unknownVariable(name)))
  // Every v-bind() written in a sheet is checked above; one that arrives
  // through var() reports at the start of this value.
  const references = bindingReferences(value, sheet.typescript, (_, message) => failAt(valuePosition(declaration), message))
  let marked = ''
  let from = 0
  for (const reference of references) {
    marked += value.slice(from, reference.start) + boundValue(bind(reference.expression))
    from = reference.end
  }
  marked += value.slice(from)

  const unit = UNSUPPORTED_UNIT.exec(marked.replace(/(["'])(?:\\.|(?!\1).)*\1/g, ''))?.[1]
  if (unit) {
    failAt(valuePosition(declaration), `The unit "${unit}" is not supported in PDF styles ("${value}" for "${property}"). Supported units: ${SUPPORTED_UNITS}.`)
  }
  const expansion = expandDeclaration(key, marked)
  if (expansion instanceof ExpansionFailure) failAt(valuePosition(declaration), expansion.message)
  if (typeof expansion === 'string') {
    failAt(valuePosition(declaration), `Invalid value "${value}" for "${property}": expected ${expansion}.`)
  }
  for (const [name, item] of Object.entries(expansion)) {
    const index = typeof item === 'string' ? BOUND_VALUE.exec(item)?.[1] : undefined
    if (index !== undefined) {
      bound[name] = Number(index)
      Reflect.deleteProperty(style, name)
      continue
    }
    if (/^border\w+Color$/.test(name) && typeof item === 'string' && hasAlpha(item)) {
      failAt(valuePosition(declaration), `Invalid value "${value}" for "${property}": the PDF engine paints a border color with alpha in a wrong color. Use an opaque color (#rgb or #rrggbb) and the opacity property of the element.`)
    }
    const sign = pdfStyleSignProblem(name, item)
    if (sign !== undefined) failAt(valuePosition(declaration), `Invalid value "${value}" for "${property}": expected ${sign}.`)
    style[name] = item
    Reflect.deleteProperty(bound, name)
  }
}

type TemplateLocation = {
  end: { offset: number }
  start: { column: number, line: number, offset: number }
}

type TemplateProp = {
  arg?: { content: string, isStatic: boolean }
  exp?: { content: string, loc: TemplateLocation }
  forParseResult?: { index?: { content: string }, key?: { content: string }, value?: { content: string } }
  loc: TemplateLocation
  name: string
  type: number
  value?: { content: string, loc: TemplateLocation }
}

/** The parts of Vue's template AST that the class rewrite reads. */
export type PdfTemplateNode = {
  children?: PdfTemplateNode[]
  loc?: TemplateLocation
  props?: TemplateProp[]
  tag?: string
  tagType?: number
  type: number
}

const ELEMENT_NODE = 1
const COMPONENT_TAG = 1
const ATTRIBUTE_PROP = 6
const DIRECTIVE_PROP = 7

const MISPLACED_CLASS = {
  slot: 'A class on <slot> is not applied: a slot renders no element. Put the class on the component that fills the slot, or wrap the <slot> in a <PdfView class="…">.',
  template: 'A class on <template> is not applied: <template> renders no element. Put the class on the PDF component inside the <template>.',
} as const

const pascalCase = (tag: string): string =>
  kebabToCamel(tag).replace(/^[a-z]/, letter => letter.toUpperCase())

const escapeAttribute = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')

const isBinding = (prop: TemplateProp, name: string): boolean =>
  prop.type === DIRECTIVE_PROP
  && prop.name === 'bind'
  && prop.arg?.isStatic === true
  && prop.arg.content === name

/** Class names written as literals in a `:class` expression. */
const literalClassNames = (expression: string): string[] => {
  let program: unknown
  try {
    program = babelParse(`(${expression})`, { plugins: ['typescript'] }).program
  }
  catch {
    return []
  }
  const names: string[] = []
  const visit = (node: unknown): void => {
    if (typeof node !== 'object' || node === null || !('type' in node)) return
    const record = node as Record<string, unknown>
    switch (record.type) {
      case 'Program':
        for (const statement of record.body as unknown[]) visit(statement)
        return
      case 'ExpressionStatement':
      case 'TSAsExpression':
      case 'ParenthesizedExpression':
        visit(record.expression)
        return
      case 'StringLiteral':
        names.push(...String(record.value).split(/\s+/).filter(Boolean))
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
        for (const property of record.properties as Array<Record<string, unknown>>) {
          if (property.type !== 'ObjectProperty' || property.computed === true) continue
          const key = property.key as Record<string, unknown>
          if (key.type === 'Identifier') names.push(String(key.name))
          if (key.type === 'StringLiteral') names.push(...String(key.value).split(/\s+/).filter(Boolean))
        }
    }
  }
  visit(program)
  return names
}

const positionAt = (source: string, offset: number): [number, number] => {
  const before = source.slice(0, offset)
  const line = before.split('\n').length
  return [line, offset - before.lastIndexOf('\n')]
}

type AstRecord = Record<string, unknown> & { type: string }

const isAstNode = (value: unknown): value is AstRecord =>
  typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string'

const parseExpression = (expression: string): unknown => {
  try {
    return babelParse(`(${expression})`, { plugins: ['typescript'] }).program.body[0]
  }
  catch {
    return undefined
  }
}

/**
 * The free names an expression reads. Property names and object keys are
 * not names; function bodies are skipped (their parameters would shadow).
 */
const readNames = (expression: string): Set<string> => {
  const names = new Set<string>()
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item)
      return
    }
    if (!isAstNode(node)) return
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
  visit(parseExpression(expression))
  return names
}

/** The names a parameter list declares (`item, index`, `{ row, total: sum }`). */
const declaredNames = (parameters: string): string[] => {
  const statement = parseExpression(`(${parameters}) => 0`)
  const arrow = isAstNode(statement) ? statement.expression : undefined
  const names: string[] = []
  const visit = (node: unknown): void => {
    if (!isAstNode(node)) return
    switch (node.type) {
      case 'Identifier':
        names.push(String(node.name))
        return
      case 'ObjectPattern':
        for (const property of node.properties as unknown[]) {
          visit(isAstNode(property) && property.type === 'ObjectProperty' ? property.value : property)
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
  if (isAstNode(arrow)) for (const parameter of arrow.params as unknown[]) visit(parameter)
  return names
}

/** Names that a `v-for` alias or a slot prop declares on one element. */
type Scope = { kind: 'v-for alias' | 'slot prop', names: readonly string[] }

const forScope = (node: PdfTemplateNode): Scope | undefined => {
  const parsed = node.props?.find(prop => prop.type === DIRECTIVE_PROP && prop.name === 'for')?.forParseResult
  const parameters = [parsed?.value, parsed?.key, parsed?.index].flatMap(part => part ? [part.content] : [])
  return parameters.length > 0 ? { kind: 'v-for alias', names: declaredNames(parameters.join(', ')) } : undefined
}

const slotScope = (node: PdfTemplateNode): Scope | undefined => {
  const slot = node.props?.find(prop => prop.type === DIRECTIVE_PROP && prop.name === 'slot' && prop.exp)
  return slot?.exp ? { kind: 'slot prop', names: declaredNames(slot.exp.content) } : undefined
}

/** A lexical ancestor with a class: its class expression and the scopes it sees. */
type Ancestor = { depth: number, expression: string, names: ReadonlySet<string> }

/** One replacement of `source.slice(start, end)` by `text`. */
export type PdfTemplateEdit = { end: number, start: number, text: string }

/**
 * Rewrites `class`, `:class` and `:style` on every component tag into one
 * `:style` that calls the runtime class helper:
 * `$nuxtPdfClass(classes, style?, ancestors?, bound?)`. `ancestors` are the
 * class expressions of the lexical ancestors that carry a class (only when a
 * rule has a descendant step); `bound` is a getter of the file's `v-bind()`
 * values. Static and literal class names are checked against the file's
 * selectors here. Line breaks are kept, so later compiler errors keep their
 * lines.
 */
export function rewriteTemplateClasses(
  source: string,
  template: PdfTemplateNode,
  styles: PdfCompiledStyles,
  fail: PdfStyleFailure,
): { code: string, edits: readonly PdfTemplateEdit[] } {
  const { bindings, rules } = styles
  const defined = new Set(rules.flatMap(([selectors]) => selectors.flatMap(selector => selector.split(/[ .]/))))
  const descendant = rules.some(([selectors]) => selectors.some(selector => selector.includes(' ')))
  const boundGetter = bindings.length > 0 ? `() => [${bindings.map(expression => `(${expression})`).join(', ')}]` : undefined
  const boundNames = bindings.map(expression => ({ expression, names: readNames(expression) }))
  const edits: PdfTemplateEdit[] = []
  const undefinedClass = (name: string) =>
    `Class "${name}" is not defined in the <style> block of this file. Classes are local to the file that uses them.`

  /** The first scope at or after `from` that redeclares one of `names`. */
  const hiding = (scopes: readonly Scope[], from: number, names: ReadonlySet<string>) => {
    for (const scope of scopes.slice(from)) {
      const name = scope.names.find(declared => names.has(declared))
      if (name !== undefined) return { kind: scope.kind, name }
    }
    return undefined
  }

  const visit = (node: PdfTemplateNode, ancestors: readonly Ancestor[], outerScopes: readonly Scope[]): void => {
    if (node.type === ELEMENT_NODE && (node.tag === 'template' || node.tag === 'slot')) {
      const misplaced = node.props?.find(prop => (prop.type === ATTRIBUTE_PROP && prop.name === 'class') || isBinding(prop, 'class'))
      if (misplaced) throw fail(misplaced.loc.start.line, misplaced.loc.start.column, MISPLACED_CLASS[node.tag])
    }
    // A v-for alias is visible on its own element; a slot prop only inside.
    const ownFor = node.type === ELEMENT_NODE ? forScope(node) : undefined
    const scopes = ownFor ? [...outerScopes, ownFor] : outerScopes
    const classed = node.type === ELEMENT_NODE && node.tagType === COMPONENT_TAG && node.props ? rewriteElement(node, ancestors, scopes) : undefined
    const slot = node.type === ELEMENT_NODE ? slotScope(node) : undefined
    const inner = classed && descendant
      ? [...ancestors, { depth: scopes.length, expression: classed, names: readNames(classed) }]
      : ancestors
    for (const child of node.children ?? []) visit(child, inner, slot ? [...scopes, slot] : scopes)
  }

  /** Rewrites one component tag; returns its class expression when it has a class. */
  const rewriteElement = (node: PdfTemplateNode, ancestors: readonly Ancestor[], scopes: readonly Scope[]): string | undefined => {
    const props = node.props!
    const staticClass = props.find(prop => prop.type === ATTRIBUTE_PROP && prop.name === 'class')
    const dynamicClass = props.find(prop => isBinding(prop, 'class'))
    if (!staticClass && !dynamicClass) return undefined
    const style = props.find(prop => isBinding(prop, 'style'))
    const first = staticClass ?? dynamicClass!
    const failHere = (message: string) => fail(first.loc.start.line, first.loc.start.column, message)

    if (node.tag && PRIMITIVES_WITHOUT_STYLE.has(pascalCase(node.tag))) {
      throw failHere(`<${pascalCase(node.tag)}> has no style, so it cannot take a class.`)
    }

    const staticNames = staticClass?.value?.content.split(/\s+/).filter(Boolean) ?? []
    if (staticClass?.value) {
      const content = staticClass.value.content
      let searchFrom = 0
      for (const name of staticNames) {
        const index = content.indexOf(name, searchFrom)
        searchFrom = index + name.length
        if (CLASS_NAME.test(name) && defined.has(name)) continue
        // An unquoted value starts at its first character; a quoted one after the quote.
        const valueStart = staticClass.value.loc.start.offset
        const quoteLength = source[valueStart] === '"' || source[valueStart] === '\'' ? 1 : 0
        throw fail(...positionAt(source, valueStart + quoteLength + index), undefinedClass(name))
      }
    }
    if (dynamicClass?.exp) {
      const missing = literalClassNames(dynamicClass.exp.content).find(name => !defined.has(name))
      if (missing !== undefined) throw failHere(undefinedClass(missing))
    }

    // The getter and the ancestor expressions run here, inside every scope
    // between their own place and this element. A redeclared name would read
    // another value without an error, so the build fails.
    for (const { expression, names } of boundNames) {
      const hidden = hiding(scopes, 0, names)
      if (hidden) throw failHere(`v-bind(${expression}) in the <style> block reads "${hidden.name}", but the ${hidden.kind} "${hidden.name}" hides it on this element. Rename the ${hidden.kind}.`)
    }
    for (const ancestor of ancestors) {
      const hidden = hiding(scopes, ancestor.depth, ancestor.names)
      if (hidden) throw failHere(`The class of an enclosing element reads "${hidden.name}", but the ${hidden.kind} "${hidden.name}" hides it on this element, so a descendant selector would test another value. Rename the ${hidden.kind}.`)
    }

    const staticValue = staticNames.length > 0 ? JSON.stringify(staticNames.join(' ')) : undefined
    const dynamicValue = dynamicClass?.exp ? `(${dynamicClass.exp.content})` : undefined
    const classValue = staticValue && dynamicValue
      ? `[${staticValue}, ${dynamicValue}]`
      : staticValue ?? dynamicValue ?? '""'
    const args = [
      classValue,
      style?.exp ? `(${style.exp.content})` : 'undefined',
      descendant && ancestors.length > 0 ? `[${ancestors.map(ancestor => ancestor.expression).join(', ')}]` : 'undefined',
      boundGetter ?? 'undefined',
    ]
    while (args.at(-1) === 'undefined') args.pop()
    const replacement = `:style="${escapeAttribute(`${PDF_CLASS_HELPER}(${args.join(', ')})`)}"`

    const consumed = [staticClass, dynamicClass, style].filter(prop => prop !== undefined)
    for (const prop of consumed) {
      const original = source.slice(prop.loc.start.offset, prop.loc.end.offset)
      edits.push({
        start: prop.loc.start.offset,
        end: prop.loc.end.offset,
        // The first consumed attribute carries the new binding; line breaks
        // of every consumed attribute stay so later lines do not move.
        text: prop === first
          ? replacement + original.replace(/[^\n]/g, '')
          : original.replace(/[^\n]/g, ' '),
      })
    }
    return classValue
  }

  visit(template, [], [])
  edits.sort((left, right) => left.start - right.start)
  return {
    code: edits.reduceRight((result, edit) => result.slice(0, edit.start) + edit.text + result.slice(edit.end), source),
    edits,
  }
}
