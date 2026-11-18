import { normalizeClass, type ComponentPublicInstance } from 'vue'
import { NuxtPdfError, PDF_ERROR_CODES } from '../shared/errors'
import { describePdfValue } from '../shared/describe-value'
import { pdfStyleValueProblem } from '../shared/style-values'
import { PDF_BINDINGS_PROPERTY, PDF_CLASSES_PROPERTY } from '../shared/template'

/** One rule as the SFC compiler stores it (see `PdfClassRule` in the build). */
type StoredRule = readonly [selectors: readonly string[], style: object, bound?: Readonly<Record<string, number>>]

/** A selector as compounds, outermost first; each compound is a list of classes. */
type Selector = { compounds: ReadonlyArray<readonly string[]>, specificity: number }
type Rule = { bound?: Readonly<Record<string, number>>, selectors: readonly Selector[], style: object }
type Rules = { classes: ReadonlySet<string>, list: readonly Rule[] }

const isStoredRule = (value: unknown): value is StoredRule =>
  Array.isArray(value)
  && Array.isArray(value[0])
  && value[0].every(selector => typeof selector === 'string')
  && typeof value[1] === 'object'
  && value[1] !== null
  && (value[2] === undefined || (typeof value[2] === 'object' && value[2] !== null))

const parseSelector = (text: string): Selector => {
  const compounds = text.split(' ').map(compound => compound.split('.'))
  return { compounds, specificity: compounds.reduce((total, compound) => total + compound.length, 0) }
}

// The stored list is static per component, so it is parsed once.
const parsed = new WeakMap<object, Rules>()

const rulesOf = (stored: unknown): Rules => {
  if (!Array.isArray(stored)) return { classes: new Set(), list: [] }
  const cached = parsed.get(stored)
  if (cached) return cached
  const list = stored.filter(isStoredRule).map(([selectors, style, bound]): Rule => ({
    bound,
    selectors: selectors.map(parseSelector),
    style,
  }))
  const classes = new Set(list.flatMap(rule => rule.selectors.flatMap(selector => selector.compounds.flat())))
  const rules = { classes, list }
  parsed.set(stored, rules)
  return rules
}

const classSet = (value: unknown): Set<string> =>
  new Set(normalizeClass(value).split(/\s+/).filter(Boolean))

/**
 * Whether a selector matches an element with `names` whose lexical ancestors
 * with a class are `ancestors` (outermost first). Descendant steps match
 * greedily from the innermost ancestor outwards, which is exact for a chain
 * of descendant combinators.
 */
const matches = (
  { compounds }: Selector,
  names: ReadonlySet<string>,
  ancestors: () => ReadonlyArray<ReadonlySet<string>>,
): boolean => {
  if (!compounds.at(-1)!.every(name => names.has(name))) return false
  let step = compounds.length - 2
  if (step < 0) return true
  const chain = ancestors()
  for (let index = chain.length - 1; index >= 0 && step >= 0; index -= 1) {
    if (compounds[step]!.every(name => chain[index]!.has(name))) step -= 1
  }
  return step < 0
}

const kebab = (key: string): string => key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)

const boundValueError = (component: ComponentPublicInstance, position: number, key: string, value: unknown, expected: string): NuxtPdfError => {
  const expressions: unknown = Reflect.get(component.$options, PDF_BINDINGS_PROPERTY)
  const expression = Array.isArray(expressions) && typeof expressions[position] === 'string' ? expressions[position] : `#${position + 1}`
  return new NuxtPdfError(
    PDF_ERROR_CODES.TreeInvalid,
    `v-bind(${expression}) for "${kebab(key)}" gave ${describePdfValue(value)}: expected ${expected}.`,
  )
}

/**
 * The class helper behind a compiled `class` / `:class`. The SFC compiler
 * rewrites them into `:style="$nuxtPdfClass(classes, style, ancestors, bound)"`;
 * `this` is the component that wrote the template, so classes stay local to
 * that file. `ancestors` are the class values of the lexical ancestors with a
 * class (for descendant selectors), `bound` returns the file's `v-bind()`
 * values. Matching rules apply by specificity (classes in the selector),
 * then in `<style>` order, as in CSS; `style` wins. A bound value is checked
 * here (`pdfStyleValueProblem`: the `<style>` rules or a form the engine
 * reads), so the message can name the `v-bind()` expression.
 */
export function resolvePdfClasses(
  this: ComponentPublicInstance,
  value: unknown,
  style?: unknown,
  ancestors?: readonly unknown[],
  bound?: () => readonly unknown[],
): unknown[] {
  const rules = rulesOf(Reflect.get(this.$options, PDF_CLASSES_PROPERTY))
  const names = classSet(value)

  for (const name of names) {
    if (rules.classes.has(name)) continue
    const component = this.$options.__name ?? this.$options.name ?? 'an anonymous component'
    throw new NuxtPdfError(
      PDF_ERROR_CODES.TreeInvalid,
      `Unknown PDF class "${name}" in <${component}>. Define .${name} in the <style> block of that file.`,
    )
  }

  let ancestorSets: Array<Set<string>> | undefined
  const ancestorChain = () => (ancestorSets ??= (ancestors ?? []).map(classSet))
  const matched: Array<{ index: number, specificity: number }> = []
  rules.list.forEach((rule, index) => {
    let specificity = 0
    for (const selector of rule.selectors) {
      if (selector.specificity > specificity && matches(selector, names, ancestorChain)) specificity = selector.specificity
    }
    if (specificity > 0) matched.push({ index, specificity })
  })
  matched.sort((left, right) => left.specificity - right.specificity || left.index - right.index)

  let values: readonly unknown[] | undefined
  const styles: unknown[] = matched.map(({ index }) => {
    const rule = rules.list[index]!
    if (!rule.bound) return rule.style
    values ??= bound?.() ?? []
    const resolved: Record<string, unknown> = { ...rule.style }
    for (const [key, position] of Object.entries(rule.bound)) {
      const item = values[position]
      // A missing value leaves the key out, as Vue drops an undefined v-bind().
      if (item === undefined || item === null) continue
      const problem = pdfStyleValueProblem(key, item)
      if (problem !== undefined) throw boundValueError(this, position, key, item, problem)
      resolved[key] = item
    }
    return resolved
  })
  if (style !== undefined) styles.push(style)
  return styles
}
