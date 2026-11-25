// A fixed node prints the running value set last on its page (`at="end"`),
// known only after the page is filled. Here the value set last has fewer
// characters but wider ones than the other, so it wraps where the longest
// value in characters does not.
import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import { PDF_COMPONENTS } from '../src/runtime/components'
import { mountPdfComponent } from '../src/runtime/renderer'
import { MAX_PAGINATIONS, pagedWithReserve } from '../src/runtime/server/engine/layout/paginate/builder'
import { renderPlainDocument } from '../src/runtime/server/engine/plain-tree'
import { PDF_ERROR_CODES } from '../src/runtime/shared/errors'
import { parsePdf } from '../src/test/pdf'

const { PdfDocument, PdfPage, PdfRunningText, PdfText, PdfView } = PDF_COMPONENTS

const values = () => [
  h(PdfText, { fixed: true, style: { width: 60 } }, () => [h(PdfRunningText, { name: 'code', at: 'end' })]),
  h(PdfText, { running: { name: 'code', text: 'iiiiiiiiiiii' } }, () => 'First'),
  h(PdfText, { running: { name: 'code', text: 'W W W W W W' } }, () => 'Second'),
]
const page = (children: () => ReturnType<typeof h>[]) => defineComponent(() => () => h(PdfDocument, { creationDate: new Date(0) }, () =>
  h(PdfPage, { size: 'A6', style: { padding: 20, fontSize: 10 } }, children)))

describe('a running value at the page end', () => {
  const runsOf = async (document: ReturnType<typeof page>) => {
    const mounted = await mountPdfComponent(document)
    try {
      const pdf = await parsePdf((await renderPlainDocument(mounted.document)).bytes)
      return pdf.pages.map(page => page.textRuns.map(run => [run.text, Math.round((page.height - run.y) * 10) / 10]))
    }
    finally {
      mounted.unmount()
    }
  }

  // The head keeps the room of the highest value its name can print while the
  // page is filled. Catches the room of the longest value in characters: the
  // head wrapped once it printed the wider value, and the flow moved down
  // (development failed with "the layout of page 1 differs", production fell
  // back to the earlier pagination).
  it('keeps the room of the highest value its name can print in a head of the page', async () => {
    expect(await runsOf(page(values))).toEqual([[['W W W W W', 29], ['W', 40], ['First', 51], ['Second', 62]]])
  })

  // The same for a carry row, a fixed node of a view that shows on every page
  // but the last: the page gets its room when its flow is sized. Catches the
  // longest value in characters there: page 1 failed with "the layout of
  // page 1 differs".
  it('keeps the room of the highest value its name can print in a carry row', async () => {
    const lines = Array.from({ length: 32 }, (_, line) => h(PdfText, null, () => `Line ${line + 1}`))
    const [, first, second] = values()
    const carried = h(PdfText, { fixed: true, pages: 'not-last', style: { width: 60 } }, () => [h(PdfRunningText, { name: 'code', at: 'end' })])
    const pages = await runsOf(page(() => [h(PdfView, null, () => [first, second, ...lines, carried])]))
    expect(pages.map(runs => runs.slice(-3))).toEqual([
      [['Line 30', 370], ['W W W W W', 381], ['W', 392]],
      [['Line 31', 29], ['Line 32', 40]],
    ])
  })
})

// The digits page numbers and counts take while pages are made (decision 2):
// the estimate is corrected to the total's digits, and a total whose digits
// keep changing ends in a typed error instead of a loop. `paginate` returns
// the pages, or the total's digits when they differ from the reserve.
describe('page token reserve', () => {
  // A fake pagination: the totals it makes in turn, each with the reserve it was made in.
  const paged = (estimate: number, totals: number[], max?: number) => {
    const seen: number[] = []
    const pages = pagedWithReserve(estimate, (reserve) => {
      seen.push(reserve)
      const total = totals[seen.length - 1]!
      return { pages: { total, reserve }, digits: String(total).length }
    }, max)
    return { seen, pages }
  }

  // A number never takes more digits than it was given room for: a document
  // whose digits swing between two reserves keeps the wider reserve's pages.
  it.each([
    { name: 'settles at the estimate', estimate: 1, totals: [7], reserves: [1], kept: { total: 7, reserve: 1 } },
    { name: 'corrects an estimate too low', estimate: 1, totals: [12, 12], reserves: [1, 2], kept: { total: 12, reserve: 2 } },
    { name: 'corrects an estimate too high', estimate: 3, totals: [40, 40], reserves: [3, 2], kept: { total: 40, reserve: 2 } },
    { name: 'corrects twice when the wider numbers add a digit', estimate: 1, totals: [99, 100, 100], reserves: [1, 2, 3], kept: { total: 100, reserve: 3 } },
    { name: 'keeps the wider pages when the narrower ones outgrow their reserve', estimate: 3, totals: [99, 100], reserves: [3, 2], kept: { total: 99, reserve: 3 } },
    { name: 'keeps the wider pages when fewer digits were too narrow before', estimate: 2, totals: [100, 99], reserves: [2, 3], kept: { total: 99, reserve: 3 } },
    { name: 'tries fewer digits once after a correction', estimate: 1, totals: [100, 99, 100], reserves: [1, 3, 2], kept: { total: 99, reserve: 3 } },
  ])('$name', ({ estimate, totals, reserves, kept }) => {
    const { seen, pages } = paged(estimate, totals)

    expect(seen).toEqual(reserves)
    expect(pages).toEqual(kept)
    expect(String(pages!.total).length).toBeLessThanOrEqual(pages!.reserve)
  })

  // No real document reaches it: a total that gains a digit with every wider reserve.
  it('fails with PDF_LIMIT_EXCEEDED when the digits keep growing', () => {
    const seen: number[] = []
    const run = () => pagedWithReserve(1, (reserve) => {
      seen.push(reserve)
      return { pages: reserve, digits: reserve + 1 }
    })

    expect(run).toThrow(expect.objectContaining({ code: PDF_ERROR_CODES.LimitExceeded, message: expect.stringContaining(`after ${MAX_PAGINATIONS} paginations`) }))
    expect(seen).toEqual([1, 2, 3, 4])
  })
})
