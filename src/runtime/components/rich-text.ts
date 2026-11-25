import { camelize, defineComponent, Fragment, h, mergeProps, normalizeStyle, type Component, type VNode } from 'vue'
import type { PdfEmLength, PdfPercentage, PdfStyle, PdfStyleValue } from '../authoring'
import { PDF_COMPONENT_PROP, PDF_RICH_IMAGE_PROP, PDF_RICH_TEXT_WARNINGS_PROP, type PdfBrokenImages, type PdfRichImageMark } from '../component-names'
import { PDF_FOOTNOTE_REPEAT_PROP, PDF_TABLE_CAPTION_PROP } from '../primitives'
import { mapComark } from '../rich-text/comark'
import { assertRichText } from '../rich-text/validate'
import { mapRichTextHtml } from '../rich-text/parse'
import { richTableLayout } from '../rich-text/table'
import type { PdfRichBlock, PdfRichFootnote, PdfRichImage, PdfRichInline, PdfRichTable, PdfRichTableCell, PdfRichTextRun } from '../rich-text/types'
import { attributeSnippet, createRichTextWarnings, tagSnippet, type RichTextWarnings } from '../rich-text/warnings'
import { treeInvalid, withPdfSource } from '../shared/errors'
import { describePdfValue } from '../shared/describe-value'
import { PDF_SOURCE_PROP, pdfSourceOf } from '../shared/template'
import type { PdfPrimitiveComponents } from './index'
import type { createTableComponents } from './table'

/** The elements of rich text an author can style, one key each. */
const PDF_RICH_TEXT_STYLE_KEYS = [
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'list', 'listItem', 'marker', 'quote', 'code', 'codeBlock', 'link', 'strong', 'em', 'sup', 'sub', 'rule',
  'image', 'caption', 'imagePlaceholder',
  'table', 'tableHeader', 'tableRow', 'tableCell', 'tableHeaderCell',
] as const

export type PdfRichTextStyleKey = typeof PDF_RICH_TEXT_STYLE_KEYS[number]

/**
 * Styles per element of the rich text, merged over the defaults: `p`, `h1`
 * to `h6`, `list` (a whole list), `listItem` (one item row), `marker` (the
 * number or bullet), `quote`, `code` (inline code), `codeBlock`, `link`,
 * `strong`, `em`, `sup` and `sub` (raised and lowered text; 70 % of the
 * text size by default), `rule`, `image` (an image, or the figure around an image
 * with a caption), `caption`, `imagePlaceholder` (the box that replaces an
 * image whose source was refused), `table`, `tableHeader` (the header row),
 * `tableRow` (a body row), `tableCell` (every cell) and `tableHeaderCell`
 * (header cells, over `tableCell`).
 */
export type PdfRichTextStyles = { readonly [Key in PdfRichTextStyleKey]?: PdfStyle }

export type PdfRichTextProps = {
  /** Editor HTML. Exactly one of `html`, `content` and `comark`. */
  html?: string
  /**
   * A rich text model: mapped from a CMS JSON tree, or from Markdown by
   * `parseRichTextMarkdown`. Exactly one of `html`, `content` and `comark`.
   */
  content?: readonly PdfRichBlock[]
  /**
   * A document comark parsed (the object with `nodes`) or its node list, as
   * Nuxt Content or comark give it. Exactly one of `html`, `content` and `comark`.
   */
  comark?: unknown
  /**
   * Vue components for the components the content names (`::alert` → `alert`),
   * by exact name. A component gets the props it declares (others are
   * dropped) and the rendered content in its slots. A name without an entry
   * keeps its content, without a wrapper.
   */
  components?: Readonly<Record<string, Component>>
  /** Headings become outline entries of the PDF. Default `false`. */
  bookmarks?: boolean
  /** Styles per element, merged over the defaults. */
  styles?: PdfRichTextStyles
  /**
   * What an image does whose source the asset rules refuse (not under
   * `pdfs/assets`, a host off the allowlist, not an image): `'placeholder'`
   * (default) prints its `alt` text in a box and adds an entry to
   * `diagnostics.imageWarnings`; `'error'` fails the render with the asset
   * error. Limits fail the render in both modes.
   */
  brokenImages?: 'placeholder' | 'error'
  id?: string
  /** The style of the whole rich text. Its `fontSize` sets the scale of headings and spacing. */
  style?: PdfStyleValue
}

/**
 * The sizes of headings (h1 to h6) and captions as shares of the body font
 * size, which the rich text inherits or sets with its own `fontSize`. The
 * one source of the scale: heading and caption margins are computed from it.
 */
const HEADING_SCALE = [2, 1.6, 1.35, 1.15, 1, 0.9] as const
const CAPTION_SCALE = 0.85

/** A share as a percentage font size; rounded to hundredths of a percent, so `1.35` is `'135%'`. */
const percent = (share: number): PdfPercentage => `${Math.round(share * 10000) / 100}%`
/** A length in em of the node's own font size. */
const em = (share: number): PdfEmLength => `${share}em`
/**
 * Lengths of the body size on a node with the size `scale` × body: in em of
 * that node, so a heading margin of `1 / scale` em is 1 em of the body.
 */
const bodyEm = (share: number, scale: number): PdfEmLength => em(share / scale)

const DEFAULT_BASE_SIZE = 12
const POINTS: Readonly<Record<string, number>> = { pt: 1, px: 1, in: 72, mm: 72 / 25.4, cm: 72 / 2.54 }

/**
 * The size for the placeholder's `minHeight`, which is points, not a style
 * (a height takes no em). It is the `fontSize` of the component's own style
 * (a class arrives as style too), else 12, as before the defaults followed
 * the inherited size.
 * `px` counts at the default 72 dpi.
 */
const baseSize = (style: unknown): number => {
  const merged = normalizeStyle(style)
  const value: unknown = typeof merged === 'object' && merged !== null ? merged.fontSize : undefined
  if (typeof value === 'number' && value > 0) return value
  if (typeof value === 'string') {
    const unit = Object.keys(POINTS).find(name => value.trim().endsWith(name))
    const number = Number.parseFloat(value)
    if (unit !== undefined && number > 0) return number * POINTS[unit]!
  }
  return DEFAULT_BASE_SIZE
}

/** Points rounded to hundredths, so the values read cleanly in a layout dump. */
const pt = (value: number): number => Math.round(value * 100) / 100

/**
 * The default styles, in percent and em of the body font size, so they follow
 * the size the rich text inherits. Heading and caption margins are 1 em and
 * 0.6 em (0.3 em for a caption) of the body, written in em of their own size.
 */
const defaultStyles = (size: number): Required<Record<PdfRichTextStyleKey, PdfStyle>> => {
  const heading = (level: number): PdfStyle => {
    const scale = HEADING_SCALE[level - 1]!
    return { fontSize: percent(scale), fontWeight: 'bold', lineHeight: 1.25, marginTop: bodyEm(1, scale), marginBottom: bodyEm(0.6, scale) }
  }
  return {
    p: { marginBottom: em(0.6) },
    h1: heading(1), h2: heading(2), h3: heading(3), h4: heading(4), h5: heading(5), h6: heading(6),
    list: { marginBottom: em(0.6) },
    listItem: { flexDirection: 'row', marginBottom: em(0.25) },
    marker: { textAlign: 'right', paddingRight: em(0.4), flexGrow: 0, flexShrink: 0 },
    quote: { borderLeftWidth: 2, borderLeftColor: '#c8c8c8', paddingLeft: em(0.8), marginBottom: em(0.6) },
    code: { backgroundColor: '#efefef' },
    codeBlock: { backgroundColor: '#efefef', padding: em(0.5), marginBottom: em(0.6) },
    link: { color: '#1f4fbf', textDecoration: 'underline' },
    strong: { fontWeight: 'bold' },
    em: { fontStyle: 'italic' },
    sup: { fontSize: '70%' },
    sub: { fontSize: '70%' },
    rule: { borderTopWidth: 0.75, borderTopColor: '#c8c8c8', marginTop: em(0.3), marginBottom: em(0.9) },
    image: { marginBottom: em(0.6) },
    caption: { fontSize: percent(CAPTION_SCALE), color: '#555555', marginTop: bodyEm(0.3, CAPTION_SCALE) },
    imagePlaceholder: { borderWidth: 0.75, borderColor: '#c8c8c8', backgroundColor: '#f4f4f4', padding: em(0.5), minHeight: pt(size * 3) },
    table: { marginBottom: em(0.6) },
    tableHeader: { borderBottomWidth: 1, borderBottomColor: '#8c8c8c' },
    tableRow: { borderBottomWidth: 0.5, borderBottomColor: '#d8d8d8' },
    tableCell: { paddingTop: em(0.3), paddingBottom: em(0.3), paddingLeft: em(0.5), paddingRight: em(0.5) },
    tableHeaderCell: { fontWeight: 'bold' },
  }
}

/**
 * Bullets by nesting level. `•` is in every standard PDF font (WinAnsi) and in
 * common text fonts; `◦` and `▪` are not in WinAnsi, and the component cannot
 * see the glyphs of a registered font when it renders, so deeper levels use
 * `-`.
 */
const BULLETS = ['•', '-'] as const

/** Width of a marker column, its gap to the text included: about 0.6 em per character (at least two) plus 0.4 em. */
const markerWidth = (label: string): PdfEmLength => em(Math.max(label.length, 2) * 0.6 + 0.4)

const STYLE_KEYS: ReadonlySet<string> = new Set(PDF_RICH_TEXT_STYLE_KEYS)

/** A mapped component and the camelCase names of the props it declares. */
interface MappedComponent { component: Component, props: ReadonlySet<string> }

/** Vue's own vnode props: never passed from content, even when declared. */
const RESERVED_PROPS: ReadonlySet<string> = new Set(['key', 'ref', 'refFor', 'refKey'])

/**
 * The props a component declares, camelCased as Vue does: `props` as a list or
 * an object, on an options object, a compiled `<script setup>` or a function
 * component, plus those of its `extends` and `mixins`.
 */
const declaredProps = (component: unknown, names = new Set<string>(), seen = new Set<unknown>()): Set<string> => {
  if ((typeof component !== 'object' && typeof component !== 'function') || component === null || seen.has(component)) return names
  seen.add(component)
  const props: unknown = 'props' in component ? component.props : undefined
  const list = Array.isArray(props) ? props : typeof props === 'object' && props !== null ? Object.keys(props) : []
  for (const name of list) if (typeof name === 'string') names.add(camelize(name))
  if ('extends' in component) declaredProps(component.extends, names, seen)
  if ('mixins' in component && Array.isArray(component.mixins)) for (const mixin of component.mixins) declaredProps(mixin, names, seen)
  return names
}

/**
 * The props of a component block that its component declares. Content comes
 * from a CMS: an undeclared name would fall through to the component's root
 * primitive and fail the render, and `onClick`, `key` or `ref` would reach Vue
 * itself. The model keeps every prop; only the render filters, and reports
 * each prop it leaves out.
 */
const passedProps = (component: string, props: Readonly<Record<string, unknown>>, declared: ReadonlySet<string>, warnings: RichTextWarnings): Record<string, unknown> =>
  Object.fromEntries(Object.entries(props).flatMap(([written, value]) => {
    const name = camelize(written)
    if (declared.has(name) && !RESERVED_PROPS.has(name)) return [[name, value]]
    warnings.add('PDF_RICH_TEXT_PROP_DROPPED', `${component}.${written}`, attributeSnippet(written, value), () => RESERVED_PROPS.has(name)
      ? `The prop "${written}" of the component ${component} is Vue's own, so content never sets it.`
      : `The component ${component} does not declare the prop "${written}", so it does not get it.`)
    return []
  }))

/**
 * The `components` prop as a Map: a component name comes from the content,
 * and a property read on an object would find `constructor` and the other
 * names of its prototype.
 */
const checkedComponents = (value: unknown, attrs: Record<string, unknown>): ReadonlyMap<string, MappedComponent> => {
  const components = new Map<string, MappedComponent>()
  if (value === undefined) return components
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return treeInvalid(`<PdfRichText> "components" must be an object of Vue components by name, found ${describePdfValue(value)}.`, pdfSourceOf(attrs))
  }
  for (const [name, component] of Object.entries(value)) {
    if ((typeof component !== 'object' && typeof component !== 'function') || component === null) {
      treeInvalid(`<PdfRichText> "components.${name.slice(0, 40)}" must be a Vue component, found ${describePdfValue(component)}.`, pdfSourceOf(attrs))
    }
    components.set(name, { component, props: declaredProps(component) })
  }
  return components
}

const isThenable = (value: unknown): boolean =>
  typeof value === 'object' && value !== null && 'then' in value && typeof value.then === 'function'

const checkedStyles = (value: unknown, attrs: Record<string, unknown>): PdfRichTextStyles => {
  if (value === undefined) return {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return treeInvalid(`<PdfRichText> "styles" must be an object with one style per element, found ${describePdfValue(value)}.`, pdfSourceOf(attrs))
  }
  for (const [key, style] of Object.entries(value)) {
    if (!STYLE_KEYS.has(key)) {
      treeInvalid(`<PdfRichText> "styles" has no element ${describePdfValue(key)}. Use ${PDF_RICH_TEXT_STYLE_KEYS.join(', ')}.`, pdfSourceOf(attrs))
    }
    if (style !== undefined && (typeof style !== 'object' || style === null || Array.isArray(style))) {
      treeInvalid(`<PdfRichText> "styles.${key}" must be a style object, found ${describePdfValue(style)}.`, pdfSourceOf(attrs))
    }
  }
  return value
}

/**
 * The text of a code block as the engine prints it with its indentation: the
 * engine drops spaces at the start of a line, so those become no-break
 * spaces (the same width in text fonts), and a tab becomes four spaces.
 */
const codeText = (text: string): string => text
  .split('\n')
  .map((line) => {
    const expanded = line.replaceAll('\t', '    ')
    const indent = expanded.length - expanded.trimStart().length
    return '\u00A0'.repeat(indent) + expanded.slice(indent)
  })
  .join('\n')

/** The plain text of inline content, for an outline entry. */
const plainText = (inlines: readonly PdfRichInline[]): string => inlines
  .map(inline => inline.type === 'text' ? inline.text : inline.type === 'link' ? plainText(inline.children) : inline.type === 'footnote' ? '' : ' ')
  .join('')

/** `PdfRichText` over the primitive and table components it renders. */
export const createRichTextComponents = (primitives: PdfPrimitiveComponents, tables: ReturnType<typeof createTableComponents>) => {
  const { PdfFootnote, PdfImage, PdfLink, PdfText, PdfView } = primitives
  const { PdfTable, PdfTableCell, PdfTableHeader, PdfTableRow } = tables

  const PdfRichText = defineComponent(
    (props: PdfRichTextProps, { attrs }) => () => {
      const inputs = [props.html, props.content, props.comark].filter(value => value !== undefined).length
      if (inputs !== 1) treeInvalid('<PdfRichText> takes exactly one of "html", "content" and "comark".', pdfSourceOf(attrs))
      if (isThenable(props.content) || isThenable(props.comark)) {
        treeInvalid('<PdfRichText> got a Promise. Await parseRichTextMarkdown() where the data is loaded and pass the result to "content".', pdfSourceOf(attrs))
      }
      const mapped = checkedComponents(props.components, attrs)
      const bookmarksValue: unknown = props.bookmarks ?? false
      // Runtime input: the template shorthand `<PdfRichText bookmarks>` passes ''.
      if (typeof bookmarksValue !== 'boolean' && bookmarksValue !== '') treeInvalid('<PdfRichText> requires "bookmarks" to be true or false.', pdfSourceOf(attrs))
      const bookmarks = bookmarksValue !== false
      const brokenImages: unknown = props.brokenImages ?? 'error'
      if (brokenImages !== 'placeholder' && brokenImages !== 'error') {
        treeInvalid(`<PdfRichText> requires "brokenImages" to be "placeholder" or "error", found ${describePdfValue(brokenImages)}.`, pdfSourceOf(attrs))
      }
      const imageMode: PdfBrokenImages = brokenImages === 'error' ? 'error' : 'placeholder'
      const source = pdfSourceOf(attrs)
      const authored = checkedStyles(props.styles, attrs)
      const size = baseSize(attrs.style)
      const defaults = defaultStyles(size)

      // One collector per render: the view below holds its entries, which the
      // slots fill while they render the blocks.
      const warnings = createRichTextWarnings()
      let blocks: PdfRichBlock[]
      try {
        if (props.html !== undefined) blocks = mapRichTextHtml(props.html, warnings)
        else if (props.comark !== undefined) blocks = mapComark(props.comark, 'comark', warnings)
        else {
          const content: unknown = props.content
          assertRichText(content)
          blocks = content
        }
      }
      catch (error) {
        throw withPdfSource(error, source)
      }

      /** Default, then the author's style; `edge` drops the default margins at the edge of a container. */
      const styled = (key: PdfRichTextStyleKey, edge: { first?: boolean, last?: boolean } = {}, extra: PdfStyle = {}): PdfStyle => {
        const base: PdfStyle = { ...defaults[key], ...extra }
        if (edge.first) delete base.marginTop
        if (edge.last) delete base.marginBottom
        return { ...base, ...authored[key] }
      }

      const run = (node: PdfRichTextRun): string | VNode => {
        const decoration: PdfStyle['textDecoration'] = node.underline && node.strike
          ? 'underline line-through'
          : node.underline ? 'underline' : node.strike ? 'line-through' : undefined
        const style: PdfStyle = {
          ...(node.bold ? styled('strong') : {}),
          ...(node.italic ? styled('em') : {}),
          ...(node.code ? styled('code') : {}),
          ...(node.verticalAlign === 'super' ? styled('sup') : node.verticalAlign === 'sub' ? styled('sub') : {}),
          ...(decoration === undefined ? {} : { textDecoration: decoration }),
          ...(node.verticalAlign === undefined ? {} : { verticalAlign: node.verticalAlign }),
        }
        return Object.keys(style).length === 0 ? node.text : h(PdfText, { style }, () => node.text)
      }

      // Notes in render order, which is the order of the content; a repeat
      // names the place of its note, which the engine adapter numbers.
      const noteOrdinals = new Map<string, number>()
      let notes = 0
      const footnote = (node: PdfRichFootnote): VNode => {
        const { children, key } = node
        if (children === undefined) {
          const ordinal = key === undefined ? undefined : noteOrdinals.get(key)
          // The model check and the mapping put a note before each repeat.
          if (ordinal === undefined) return treeInvalid(`<PdfRichText> has a footnote that marks the note ${describePdfValue(key)} again before that note.`, source)
          return h(PdfFootnote, { [PDF_FOOTNOTE_REPEAT_PROP]: ordinal })
        }
        notes += 1
        if (key !== undefined) noteOrdinals.set(key, notes)
        return h(PdfFootnote, null, () => inlines(children))
      }

      const inlines = (nodes: readonly PdfRichInline[]): Array<string | VNode> => nodes.map((node) => {
        if (node.type === 'text') return run(node)
        if (node.type === 'break') return '\n'
        if (node.type === 'footnote') return footnote(node)
        return h(PdfLink, { href: node.href.trim(), style: styled('link') }, () => inlines(node.children))
      })

      /**
       * A component without a mapping gives way to its content: its named
       * slots, then its default slot. Each block keeps its path in the model
       * (`content[2].items[0][1]`), which image errors and warnings name.
       */
      const expanded = (nodes: readonly PdfRichBlock[], path: string): Array<{ node: PdfRichBlock, path: string }> =>
        nodes.flatMap((node, index) => {
          const at = `${path}[${index}]`
          if (node.type !== 'component' || mapped.has(node.name)) return [{ node, path: at }]
          warnings.add('PDF_RICH_TEXT_COMPONENT_DROPPED', node.name, tagSnippet(node.name, node.props), () => `The component ${node.name} has no entry in the "components" prop of PdfRichText: its content prints without it.`)
          return [
            ...Object.entries(node.slots ?? {}).flatMap(([name, content]) => expanded(content, `${at}.slots.${name}`)),
            ...expanded(node.children, `${at}.children`),
          ]
        })

      const blockList = (nodes: readonly PdfRichBlock[], listDepth: number, path: string): VNode[] => {
        const shown = expanded(nodes, path)
        return shown.map((item, index) => block(item.node, { first: index === 0, last: index === shown.length - 1 }, listDepth, item.path))
      }

      const mark = (role: PdfRichImageMark['role'], path: string): PdfRichImageMark => ({ role, path, brokenImages: imageMode })

      /**
       * An image block: a `PdfImage` that goes through the asset rules like
       * any other. Without `width` and `height` it fills the column (the
       * engine sizes an image by the space it gets, not by its pixels); with
       * one it keeps its proportions and never grows past the column. In
       * placeholder mode the placeholder follows the image, and image
       * resolution keeps one of the two (`resolvePdfImageAssets`).
       */
      const image = (node: PdfRichImage, edge: { first: boolean, last: boolean }, path: string): VNode => {
        const caption = node.caption ?? []
        const sized = node.width !== undefined || node.height !== undefined
        // Never wider than the column; the placeholder takes the same width.
        const width: PdfStyle = { ...(node.width === undefined ? {} : { width: node.width }), maxWidth: '100%' }
        const box: PdfStyle = { ...width, ...(node.height === undefined ? {} : { height: node.height }) }
        // A sized image keeps its own width: the column stretches its
        // children, and the engine then fills the width.
        const column: PdfStyle = sized ? { alignItems: 'flex-start' } : {}
        const picture = h(PdfImage, {
          src: node.src,
          // Inside a figure the figure carries the alternative text.
          alt: caption.length === 0 ? node.alt : undefined,
          [PDF_RICH_IMAGE_PROP]: mark('image', path),
          [PDF_SOURCE_PROP]: source,
          style: { objectFit: 'contain', ...box },
        })
        const placeholder = imageMode === 'placeholder'
          ? h(PdfView, {
              [PDF_RICH_IMAGE_PROP]: mark('placeholder', path),
              decorative: node.alt === undefined ? true : undefined,
              style: { ...width, ...styled('imagePlaceholder') },
            }, () => node.alt === undefined ? [] : [h(PdfText, {}, () => node.alt)])
          : undefined
        const shown = placeholder === undefined ? [picture] : [picture, placeholder]
        if (caption.length === 0) return h(PdfView, { style: { ...column, ...styled('image', edge) } }, () => shown)
        return h(PdfView, {
          tag: 'figure',
          alt: node.alt,
          [PDF_RICH_IMAGE_PROP]: mark('figure', path),
          [PDF_SOURCE_PROP]: source,
          style: styled('image', edge),
        }, () => [
          h(PdfView, { style: column }, () => shown),
          h(PdfView, { tag: 'caption' }, () => [h(PdfText, { style: styled('caption') }, () => inlines(caption))]),
        ])
      }

      /**
       * A table block: a `PdfTable` with `'auto'` columns unless the model
       * names widths. The header row repeats on every page; a body row
       * splits at the page end, unless a row span covers it (the rows of a
       * span stay together). The caption prints above, kept with the table.
       */
      const table = (node: PdfRichTable, edge: { first: boolean, last: boolean }): VNode => {
        const { columns: count, spannedRows } = richTableLayout(node.header ?? [], node.rows)
        const columns = node.columns ?? Array.from({ length: count }, () => 'auto' as const)
        const cell = (item: PdfRichTableCell, inHeader: boolean): VNode => h(PdfTableCell, {
          colspan: item.colspan,
          rowspan: item.rowspan,
          align: item.align,
          header: item.header === true ? true : undefined,
          style: inHeader || item.header === true ? { ...styled('tableCell'), ...styled('tableHeaderCell') } : styled('tableCell'),
        }, () => item.children.map((paragraph, index) =>
          h(PdfText, { tag: 'p', style: styled('p', { first: index === 0, last: index === item.children.length - 1 }) }, () => inlines(paragraph.children))))
        const header = node.header === undefined
          ? []
          : [h(PdfTableHeader, { style: styled('tableHeader') }, () => node.header!.map(item => cell(item, true)))]
        const rows = node.rows.map((cells, index) => h(PdfTableRow, {
          ...(spannedRows.has(index) ? {} : { wrap: true }),
          style: styled('tableRow'),
        }, () => cells.map(item => cell(item, false))))
        const tableNode = h(PdfTable, { columns, style: styled('table', edge) }, () => [...header, ...rows])
        if (node.caption === undefined) return tableNode
        const caption = node.caption
        return h(Fragment, null, [
          h(PdfText, {
            tag: 'p',
            keepWithNext: true,
            [PDF_TABLE_CAPTION_PROP]: true,
            style: styled('caption', {}, { marginTop: 0, marginBottom: bodyEm(0.3, CAPTION_SCALE) }),
          }, () => inlines(caption)),
          tableNode,
        ])
      }

      const block = (node: PdfRichBlock, edge: { first: boolean, last: boolean }, listDepth: number, path: string): VNode => {
        switch (node.type) {
          case 'paragraph':
            return h(PdfText, { tag: 'p', style: styled('p', edge) }, () => inlines(node.children))
          case 'heading': {
            const title = plainText(node.children).trim()
            const key = `h${node.level}` as const
            return h(PdfText, {
              tag: key,
              // On the page of the first lines of what follows, at any body size.
              keepWithNext: true,
              bookmark: bookmarks && title !== '' ? title : undefined,
              style: styled(key, edge),
            }, () => inlines(node.children))
          }
          case 'list': {
            const first = node.start ?? 1
            const labels = node.items.map((_, index) => node.ordered ? `${first + index}.` : BULLETS[Math.min(listDepth, BULLETS.length - 1)]!)
            // One width for the whole list: the widest label, so every body starts at the same x.
            const width = markerWidth(labels.reduce((widest, label) => label.length > widest.length ? label : widest, ''))
            return h(PdfView, { tag: 'list', style: styled('list', edge) }, () => node.items.map((item, index) =>
              h(PdfView, { tag: 'list-item', style: styled('listItem', { last: index === node.items.length - 1 }) }, () => [
                h(PdfText, { style: styled('marker', {}, { width }) }, () => labels[index]!),
                h(PdfView, { style: { flexGrow: 1, flexShrink: 1, flexBasis: 0 } }, () => blockList(item, listDepth + 1, `${path}.items[${index}]`)),
              ])))
          }
          case 'quote':
            return h(PdfView, { tag: 'quote', style: styled('quote', edge) }, () => blockList(node.children, listDepth, `${path}.children`))
          case 'code':
            return h(PdfText, { tag: 'p', style: { ...styled('codeBlock', edge), hyphens: 'manual' } }, () => codeText(node.text))
          case 'rule':
            return h(PdfView, { decorative: true, style: styled('rule', edge) })
          case 'image':
            return image(node, edge, path)
          case 'table':
            return table(node, edge)
          case 'component': {
            // `expanded` leaves only components with a mapping.
            const { component, props: declared } = mapped.get(node.name)!
            const slots = Object.fromEntries([
              ['default', () => blockList(node.children, listDepth, `${path}.children`)],
              ...Object.entries(node.slots ?? {}).map(([name, content]) => [name, () => blockList(content, listDepth, `${path}.slots.${name}`)]),
            ])
            return h(component, passedProps(node.name, node.props, declared, warnings), slots)
          }
        }
      }

      return h(PdfView, mergeProps({ [PDF_COMPONENT_PROP]: 'PdfRichText', [PDF_RICH_TEXT_WARNINGS_PROP]: warnings.entries }, attrs), () => blockList(blocks, 0, 'content'))
    },
    { name: 'PdfRichText', props: ['html', 'content', 'comark', 'components', 'bookmarks', 'styles', 'brokenImages'], inheritAttrs: false },
  )

  return { PdfRichText }
}
