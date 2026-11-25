// The template transform of class, :class and :style on components into the runtime class helper.

import { PDF_PRIMITIVE_TABLE } from '../../runtime/primitives'
import { classNames, parsePdfSelector, PDF_CLASS_HELPER } from '../../runtime/shared/template'
import type { PdfCompiledStyles } from '../style/compile'
import type { PdfStyleFailure } from '../style/sheets'
import { declaredNames, literalClassNames, readNames } from './script-ast'
import { applyEdits, blankText, lineBreaks, textPositions, type TextEdit } from './source-text'
import { ATTRIBUTE_NODE, attributeOf, bindingOf, boundName, COMPONENT_TAG, DIRECTIVE_NODE, expressionText, pascalTag, type TemplateElement, type TemplateRoot, walkElements } from './template-ast'

const PRIMITIVES_WITHOUT_STYLE = new Set(
  Object.entries(PDF_PRIMITIVE_TABLE)
    .filter(([, primitive]) => !Object.hasOwn(primitive.props, 'style'))
    .map(([name]) => name),
)

const MISPLACED_CLASS = {
  slot: 'A class on <slot> is not applied: a slot renders no element. Put the class on the component that fills the slot, or wrap the <slot> in a <PdfView class="…">.',
  template: 'A class on <template> is not applied: <template> renders no element. Put the class on the PDF component inside the <template>.',
} as const

const escapeAttribute = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')

/** Names that a `v-for` alias or a slot prop declares on one element. */
type Scope = { kind: 'v-for alias' | 'slot prop', names: readonly string[] }

const forScope = (node: TemplateElement): Scope | undefined => {
  const directive = node.props.find(prop => prop.type === DIRECTIVE_NODE && prop.name === 'for')
  const parsed = directive?.type === DIRECTIVE_NODE ? directive.forParseResult : undefined
  const parameters = [parsed?.value, parsed?.key, parsed?.index].flatMap(part => expressionText(part) ?? [])
  return parameters.length > 0 ? { kind: 'v-for alias', names: declaredNames(parameters.join(', ')) } : undefined
}

const slotScope = (node: TemplateElement): Scope | undefined => {
  const slot = node.props.find(prop => prop.type === DIRECTIVE_NODE && prop.name === 'slot' && prop.exp)
  const parameters = slot?.type === DIRECTIVE_NODE ? expressionText(slot.exp) : undefined
  return parameters === undefined ? undefined : { kind: 'slot prop', names: declaredNames(parameters) }
}

/** A lexical ancestor with a class: its class expression and the scopes it sees. */
type Ancestor = { depth: number, expression: string, names: ReadonlySet<string> }

/** What an element sees of the elements around it. */
type Lexical = { ancestors: readonly Ancestor[], scopes: readonly Scope[] }

/** One replacement of `source.slice(start, end)` by `text`. */
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
  template: TemplateRoot,
  styles: PdfCompiledStyles,
  fail: PdfStyleFailure,
): { code: string, edits: readonly TextEdit[] } {
  const { bindings, rules } = styles
  // Every name here passed `PDF_CLASS_NAME` when the <style> block compiled.
  const defined = new Set(rules.flatMap(([selectors]) => selectors.flatMap(selector => parsePdfSelector(selector).flat())))
  const descendant = rules.some(([selectors]) => selectors.some(selector => parsePdfSelector(selector).length > 1))
  const boundGetter = bindings.length > 0 ? `() => [${bindings.map(expression => `(${expression})`).join(', ')}]` : undefined
  const boundNames = bindings.map(expression => ({ expression, names: readNames(expression) }))
  const edits: TextEdit[] = []
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

  const visit = (node: TemplateElement, { ancestors, scopes: outerScopes }: Lexical): Lexical => {
    if (node.tag === 'template' || node.tag === 'slot') {
      const misplaced = node.props.find(prop => (prop.type === ATTRIBUTE_NODE && prop.name === 'class') || boundName(prop) === 'class')
      if (misplaced) throw fail(misplaced.loc.start.line, misplaced.loc.start.column, MISPLACED_CLASS[node.tag])
    }
    // A v-for alias is visible on its own element; a slot prop only inside.
    const ownFor = forScope(node)
    const scopes = ownFor ? [...outerScopes, ownFor] : outerScopes
    const classed = node.tagType === COMPONENT_TAG ? rewriteElement(node, ancestors, scopes) : undefined
    const slot = slotScope(node)
    return {
      ancestors: classed && descendant
        ? [...ancestors, { depth: scopes.length, expression: classed, names: readNames(classed) }]
        : ancestors,
      scopes: slot ? [...scopes, slot] : scopes,
    }
  }

  /** Rewrites one component tag; returns its class expression when it has a class. */
  const rewriteElement = (node: TemplateElement, ancestors: readonly Ancestor[], scopes: readonly Scope[]): string | undefined => {
    const staticClass = attributeOf(node, 'class')
    const dynamicClass = bindingOf(node, 'class')
    if (!staticClass && !dynamicClass) return undefined
    const style = bindingOf(node, 'style')
    const first = staticClass ?? dynamicClass!
    const failHere = (message: string) => fail(first.loc.start.line, first.loc.start.column, message)

    if (PRIMITIVES_WITHOUT_STYLE.has(pascalTag(node.tag))) {
      throw failHere(`<${pascalTag(node.tag)}> has no style, so it cannot take a class.`)
    }

    const staticNames = classNames(staticClass?.value?.content ?? '')
    if (staticClass?.value) {
      const content = staticClass.value.content
      let searchFrom = 0
      for (const name of staticNames) {
        const index = content.indexOf(name, searchFrom)
        searchFrom = index + name.length
        if (defined.has(name)) continue
        // An unquoted value starts at its first character; a quoted one after the quote.
        const valueStart = staticClass.value.loc.start.offset
        const quoteLength = source[valueStart] === '"' || source[valueStart] === '\'' ? 1 : 0
        const { column, line } = textPositions(source).position(valueStart + quoteLength + index)
        throw fail(line, column, undefinedClass(name))
      }
    }
    const dynamicText = expressionText(dynamicClass?.exp)
    if (dynamicText !== undefined) {
      const missing = literalClassNames(dynamicText).find(name => !defined.has(name))
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
    const dynamicValue = dynamicText === undefined ? undefined : `(${dynamicText})`
    const classValue = staticValue && dynamicValue
      ? `[${staticValue}, ${dynamicValue}]`
      : staticValue ?? dynamicValue ?? '""'
    const styleText = expressionText(style?.exp)
    const args = [
      classValue,
      styleText === undefined ? 'undefined' : `(${styleText})`,
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
          ? replacement + lineBreaks(original)
          : blankText(original),
      })
    }
    return classValue
  }

  walkElements(template, { ancestors: [], scopes: [] }, visit)
  // Sorted, as the source map reads them (source-text.ts `authoredOffset`).
  edits.sort((left, right) => left.start - right.start)
  return { code: applyEdits(source, edits), edits }
}
