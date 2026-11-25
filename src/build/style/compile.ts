// The <style> blocks of a PDF SFC as class rules: selectors and declarations.

import type { SFCStyleBlock } from '@vue/compiler-sfc'
import type { ChildNode } from 'postcss'
import { camelCase, kebabCase } from '../../runtime/shared/case'
import { NUMBER, PDF_LENGTH_UNITS, pdfStyleSignProblem, takesPdfEm } from '../../runtime/shared/style-values'
import { PDF_CLASS_NAME, type PdfClassRule } from '../../runtime/shared/template'
import { BOUND_VALUE, boundValue, expandDeclaration, ExpansionFailure, isStyleKey, type StyleValue } from './expand'
import { bindingReferences, checkBindings, collectVariables, IMPORTANT, isRootRule, substituteVariables, unknownVariable, valuePosition, variableReferences, type Variables } from './references'
import { isImport, loadSheets, type PdfStyleFailure, type PdfStyleOptions, type Sheet } from './sheets'

export type PdfCompiledStyles = {
  /** The `v-bind()` expressions of the file, in first-use order. */
  bindings: readonly string[]
  rules: readonly PdfClassRule[]
}

const SUPPORTED_UNITS = `${PDF_LENGTH_UNITS.join(', ')} and %`

/** Browser units the engine does not read; the length units it reads are in `PDF_UNIT_LENGTH`. */
const UNSUPPORTED_UNIT = new RegExp(`(?<![\\w.-])${NUMBER}(em|ex|ch|vmin|vmax)(?![\\w-])`, 'i')
/** The same for the keys that take `em` (PDF_EM_STYLE_KEYS). */
const UNSUPPORTED_UNIT_BESIDE_EM = new RegExp(`(?<![\\w.-])${NUMBER}(ex|ch|vmin|vmax)(?![\\w-])`, 'i')

const SELECTOR_HINT = 'Use class selectors: .a, .a.b or .a .b.'

const COMPOUND_SELECTOR = new RegExp(`^(?:\\.${PDF_CLASS_NAME})+$`, 'iu')

const PROPERTY_HINTS: Record<string, string> = {
  'background': ' Use background-color.',
  'font': ' Use font-size, font-family and font-weight.',
  'text-decoration-line': ' Use text-decoration.',
}

const SHORTHAND_KEYS = new Set(['border', 'borderTop', 'borderRight', 'borderBottom', 'borderLeft', 'columnRule'])

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
  if (child.type !== 'decl') return failAt(child.source?.start, 'Nested rules are not supported in PDF styles.')
  const declaration = child
  const property = declaration.prop
  if (property.startsWith('--')) failAt(declaration.source?.start, 'Declare variables in a :root rule.')
  if (declaration.important) failAt(declaration.source?.start, IMPORTANT)
  if (/[A-Z]/.test(property)) {
    failAt(declaration.source?.start, `Unsupported PDF style property "${property}". Use kebab-case "${kebabCase(property)}".`)
  }
  const key = camelCase(property)
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

  const em = takesPdfEm(key)
  const unit = (em ? UNSUPPORTED_UNIT_BESIDE_EM : UNSUPPORTED_UNIT).exec(marked.replace(/(["'])(?:\\.|(?!\1).)*\1/g, ''))?.[1]
  if (unit) {
    failAt(valuePosition(declaration), `The unit "${unit}" is not supported in PDF styles ("${value}" for "${property}"). Supported units: ${em ? `${PDF_LENGTH_UNITS.join(', ')}, em and %` : SUPPORTED_UNITS}.`)
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
    const sign = pdfStyleSignProblem(name, item)
    if (sign !== undefined) failAt(valuePosition(declaration), `Invalid value "${value}" for "${property}": expected ${sign}.`)
    style[name] = item
    Reflect.deleteProperty(bound, name)
  }
}
