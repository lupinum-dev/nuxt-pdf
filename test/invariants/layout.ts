// The layout profile (rebuild step 7): documents that hold one layout the
// page builder has no rule for yet (scope.ts), in a column of headings,
// texts, blocks and tables below a spacer, like the keepWithNext profile.
// Each feature has variants; `checkLayout` holds what every pagination must
// keep whatever the feature means: each word printed once (a fixed word once
// per page), flow words in reading order, every word inside its page, and no
// two words on top of each other unless the feature puts one there.
import fc from 'fast-check'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineComponent, h, type VNode } from 'vue'
import { PDF_COMPONENTS } from '../../src/runtime/components'
import type { PdfFontDataUrl } from '../../src/runtime/fonts'
import { renderPreparedPdfTemplate } from '../../src/test/render-template'
import { readPdf, type Word } from './document'

const { PdfDocument, PdfPage, PdfPageNumber, PdfTable, PdfTableCell, PdfTableHeader, PdfTableRow, PdfText, PdfView } = PDF_COMPONENTS

const PAGE = { padding: 40 }
const FONT_SIZE = 10

export const FEATURES = [
  'footer', // a fixed node on the page after the flow: absolute, in-flow text, in-flow view
  'absolute', // an absolute node: on the page, in a view that splits, from the bottom
  'alignSelf', // a row whose short child sets alignSelf beside a text that splits
  'grow', // flexGrow outside a row: on the page, in a view
  'justify', // justifyContent: on the page (center, space-between), on a view
  'flexWrap', // flexWrap 'wrap': on the page, on a view
  'maxHeight', // a view with maxHeight around a text
  'height', // a view with a height around a text that splits
  'percentMinHeight', // a view with a percentage minHeight
  'wrapFalsePage', // a page with wrap={false} after a page that splits
  'splitPageNumber', // a long text with a page number, which splits
  'textHeight', // a text with a height near the page end
  'rtlNumber', // a page number in a right-to-left line with a Latin word
] as const
export type Feature = typeof FEATURES[number]

type Item
  = | { kind: 'heading' }
    | { kind: 'text', lines: number }
    | { kind: 'block', height: number }
    | { kind: 'table', rows: number }

export interface LayoutSpec {
  feature: Feature
  variant: number
  spacer: number
  items: Item[]
  /** Where the feature's node goes among the items. */
  at: number
  /** The feature's own size: lines, points or a percentage. */
  size: number
}

export interface RawLayout {
  feature: number
  variant: number
  spacer: number
  items: Array<{ kind: number, size: number }>
  at: number
  size: number
}

export const rawLayout = (features: readonly Feature[] = FEATURES): fc.Arbitrary<RawLayout> => fc.record({
  feature: fc.constantFrom(...features.map(feature => FEATURES.indexOf(feature))),
  variant: fc.nat({ max: 2 }),
  spacer: fc.integer({ min: 0, max: 700 }),
  items: fc.array(fc.record({ kind: fc.nat({ max: 3 }), size: fc.nat({ max: 1000 }) }), { minLength: 1, maxLength: 10 }),
  at: fc.nat({ max: 20 }),
  size: fc.nat({ max: 1000 }),
})

export const normalizeLayout = (raw: RawLayout): LayoutSpec => ({
  feature: FEATURES[raw.feature]!,
  variant: raw.variant,
  spacer: raw.spacer,
  items: raw.items.map(({ kind, size }): Item => kind === 0
    ? { kind: 'heading' }
    : kind === 1
      ? { kind: 'text', lines: 1 + size % 30 }
      : kind === 2 ? { kind: 'block', height: 12 + size % 189 } : { kind: 'table', rows: 1 + size % 20 }),
  at: raw.at % (raw.items.length + 1),
  size: raw.size,
})

const tokensOf = (item: Item, index: number): string[] => {
  switch (item.kind) {
    case 'heading': return [`H${index}`]
    case 'block': return [`B${index}`]
    case 'text': return Array.from({ length: item.lines }, (_, line) => `T${index}x${line}`)
    case 'table': return Array.from({ length: item.rows }, (_, row) => `R${index}x${row}`)
  }
}

const itemNode = (item: Item, index: number): VNode => {
  switch (item.kind) {
    case 'heading': return h(PdfText, { style: { fontSize: 14 } }, () => `H${index}`)
    case 'block': return h(PdfView, { wrap: false, style: { height: item.height } }, () => [h(PdfText, null, () => `B${index}`)])
    case 'text': return h(PdfText, null, () => tokensOf(item, index).join('\n'))
    case 'table': return h(PdfTable, { columns: [1] }, () => [
      h(PdfTableHeader, null, () => [h(PdfTableCell, null, () => `Head${index}`)]),
      ...tokensOf(item, index).map((token, row) => h(PdfTableRow, { key: row }, () => [h(PdfTableCell, null, () => token)])),
    ])
  }
}

/** The feature's own words: in the flow (`flow`), on every page (`fixed`), or placed by offsets (`placed`). */
interface Own { flow: string[], fixed: string[], placed: string[] }

const featureLines = (spec: LayoutSpec): string[] => Array.from({ length: 1 + spec.size % 40 }, (_, line) => `F${line}`)

const ARABIC: PdfFontDataUrl = `data:font/ttf;base64,${readFileSync(resolve(__dirname, '../fixtures/fonts/international/NotoSansArabic-Subset.ttf')).toString('base64')}` as PdfFontDataUrl

/** `at`: where the feature's flow words read among the items, when not at `spec.at`. */
interface Built { pages: VNode[], own: Own, at?: number }

const build = (spec: LayoutSpec): Built => {
  const items = spec.items.map(itemNode)
  const lines = featureLines(spec)
  const text = (style: Record<string, unknown> = {}, props: Record<string, unknown> = {}) => h(PdfText, { ...props, style }, () => lines.join('\n'))
  const own: Own = { flow: lines, fixed: [], placed: [] }
  const insert = (node: VNode) => [...items.slice(0, spec.at), node, ...items.slice(spec.at)]
  const pageStyle: Record<string, unknown> = { padding: PAGE.padding, fontSize: FONT_SIZE }
  const page = (children: VNode[], style: Record<string, unknown> = {}, props: Record<string, unknown> = {}) =>
    h(PdfPage, { size: 'A4', ...props, style: { ...pageStyle, ...style } }, () => [h(PdfView, { style: { height: spec.spacer } }), ...children])
  switch (spec.feature) {
    case 'footer': {
      const footer = spec.variant === 0
        ? h(PdfText, { fixed: true, style: { position: 'absolute', bottom: 12, left: PAGE.padding, right: PAGE.padding } }, () => 'Foot')
        : spec.variant === 1
          ? h(PdfText, { fixed: true }, () => 'Foot')
          : h(PdfView, { fixed: true }, () => [h(PdfText, null, () => 'Foot')])
      return { pages: [page([...items, footer])], own: { flow: [], fixed: ['Foot'], placed: [] } }
    }
    case 'absolute': {
      const offset = 20 + spec.size % 300
      const style = spec.variant === 2 ? { position: 'absolute', bottom: offset, left: 300, width: 120 } : { position: 'absolute', top: offset, left: 300, width: 120 }
      const node = text(style)
      const placed = { flow: [], fixed: [], placed: lines }
      if (spec.variant === 1) {
        const inner = spec.items.slice(spec.at, spec.at + 2).map((item, offsetIndex) => itemNode(item, spec.at + offsetIndex))
        const wrapped = h(PdfView, null, () => [node, ...inner])
        return { pages: [page([...items.slice(0, spec.at), wrapped, ...items.slice(spec.at + 2)])], own: placed }
      }
      return { pages: [page(insert(node))], own: placed }
    }
    case 'alignSelf': {
      const align = (['center', 'flex-end', 'flex-start'] as const)[spec.variant]!
      const row = h(PdfView, { style: { flexDirection: 'row' } }, () => [
        h(PdfView, { style: { width: 200 } }, () => [text()]),
        h(PdfText, { style: { alignSelf: align } }, () => 'Side'),
      ])
      return { pages: [page(insert(row))], own: { flow: [...lines, 'Side'], fixed: [], placed: [] } }
    }
    case 'grow': {
      const grown = h(PdfView, { style: { flexGrow: 1 } }, () => [text()])
      return { pages: [page(insert(spec.variant === 0 ? grown : h(PdfView, null, () => [grown])))], own }
    }
    case 'justify': {
      if (spec.variant === 2) return { pages: [page(insert(h(PdfView, { style: { justifyContent: 'flex-end' } }, () => [text()])))], own }
      return { pages: [page(insert(text()), { justifyContent: spec.variant === 0 ? 'center' : 'space-between' })], own }
    }
    case 'flexWrap': {
      if (spec.variant === 0) return { pages: [page(insert(text()), { flexWrap: 'wrap' })], own }
      return { pages: [page(insert(h(PdfView, { style: { flexWrap: 'wrap' } }, () => [text()])))], own }
    }
    case 'maxHeight':
      return { pages: [page(insert(h(PdfView, { style: { maxHeight: 20 + spec.size % 400 } }, () => [text()])))], own }
    case 'height':
      return { pages: [page(insert(h(PdfView, { style: { height: 20 + spec.size % 600 } }, () => [text()])))], own }
    case 'percentMinHeight':
      return { pages: [page(insert(h(PdfView, { style: { minHeight: `${10 + spec.size % 80}%` } }, () => [text()])))], own }
    case 'wrapFalsePage':
      return { pages: [page(items), page([text()], {}, { wrap: false })], own, at: spec.items.length }
    case 'splitPageNumber': {
      const numbered = h(PdfText, null, () => [lines.slice(0, Math.ceil(lines.length / 2)).join('\n'), ' Page ', h(PdfPageNumber), '\n', lines.slice(Math.ceil(lines.length / 2)).join('\n')])
      const half = Math.ceil(lines.length / 2)
      return { pages: [page(insert(numbered))], own: { flow: [...lines.slice(0, half), 'Page', ...lines.slice(half)], fixed: [], placed: [] } }
    }
    case 'textHeight':
      return { pages: [page(insert(text({ height: 12 + spec.size % 300 })))], own }
    case 'rtlNumber': {
      const rtl = h(PdfText, { style: { fontFamily: 'Noto Arabic', fontSize: 12 } }, () => ['مرحبا ', h(PdfPageNumber), spec.variant === 0 ? ' Fx ' : ' ', 'العربية'])
      return { pages: [page(insert(rtl))], own: { flow: [], fixed: [], placed: [] } }
    }
  }
}

export const renderLayout = async (spec: LayoutSpec): Promise<Uint8Array> => {
  const { pages } = build(spec)
  const component = defineComponent(() => () => h(PdfDocument, { creationDate: new Date(Date.UTC(2026, 0, 2)) }, () => pages))
  const fonts = spec.feature === 'rtlNumber' ? [{ family: 'Noto Arabic', src: ARABIC }] : []
  return (await renderPreparedPdfTemplate(component, {}, { fonts })).bytes
}

/** A check that failed, by name, and what it saw. */
export interface Failure { check: 'once' | 'order' | 'inside' | 'overlap', message: string }

const top = (word: Word) => -word.y - word.fontSize

export const checkLayout = async (spec: LayoutSpec, bytes: Uint8Array): Promise<Failure[]> => {
  const read = await readPdf(bytes)
  const built = build(spec)
  const { own } = built
  const at = built.at ?? spec.at
  const flow = [...spec.items.flatMap((item, index) => tokensOf(item, index)), ...own.flow]
  const failures: Failure[] = []
  const found = new Map<string, Word[]>()
  for (const word of read.words) found.set(word.text, [...(found.get(word.text) ?? []), word])
  const pageCount = Math.max(...read.words.map(word => word.page))
  for (const token of [...flow, ...own.placed]) {
    const count = found.get(token)?.length ?? 0
    if (count !== 1) failures.push({ check: 'once', message: `${token} printed ${count} times` })
  }
  for (const token of own.fixed) {
    const pages = (found.get(token) ?? []).map(word => word.page)
    if (pages.length !== pageCount || new Set(pages).size !== pageCount) failures.push({ check: 'once', message: `${token} on pages ${pages.join(',')} of ${pageCount}` })
  }
  // Reading order of the flow in tree order: the items, with the feature's flow words at its place.
  const ordered = [
    ...spec.items.slice(0, at).flatMap((item, index) => tokensOf(item, index)),
    ...own.flow,
    ...spec.items.slice(at).flatMap((item, index) => tokensOf(item, at + index)),
  ].filter(token => found.get(token)?.length === 1 && token !== 'Side')
  for (let index = 1; index < ordered.length; index++) {
    const [a, b] = [found.get(ordered[index - 1]!)![0]!, found.get(ordered[index]!)![0]!]
    if (b.page < a.page || (b.page === a.page && top(b) < top(a) - 0.5)) {
      failures.push({ check: 'order', message: `${b.text} (page ${b.page}, baseline ${b.y.toFixed(1)}) before ${a.text} (page ${a.page}, baseline ${a.y.toFixed(1)})` })
      break
    }
  }
  for (const word of read.words) {
    const { width, height } = read.parsed.pages[word.page - 1]!
    if (word.x < -0.5 || word.x + word.width > width + 0.5 || word.y < -0.5 || word.y + word.fontSize > height + 0.5) {
      failures.push({ check: 'inside', message: `${word.text} outside page ${word.page} at x ${word.x.toFixed(1)}, y ${word.y.toFixed(1)}` })
      break
    }
  }
  // The word reader places Latin letters only (document.ts), so a right-to-left line is not judged.
  const placed = new Set(own.placed)
  const boxes = read.words.filter(word => !placed.has(word.text) && !/\p{Script=Arabic}/u.test(word.text) && !(spec.feature === 'rtlNumber' && /^\d+$/.test(word.text)))
  outer: for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i]!, boxes[j]!]
      if (a.page !== b.page) continue
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
      const overlapY = Math.min(a.y + a.fontSize * 0.7, b.y + b.fontSize * 0.7) - Math.max(a.y, b.y)
      if (overlapX > 0.5 && overlapY > 0.5) {
        failures.push({ check: 'overlap', message: `${a.text} and ${b.text} overlap on page ${a.page}` })
        break outer
      }
    }
  }
  return failures
}
