import { AsyncLocalStorage } from 'node:async_hooks'

// Counted render work, for the work budget (test/work-budget.test.ts,
// internals/performance.md): exact numbers that do not depend on the
// machine, unlike wall time. Each counter is bumped where the work happens.
// The counts belong to one call of `countedWork`: they follow its async
// context, so a render counts only its own work, also beside other renders,
// and no counts outlive the call. Outside such a call nothing is counted.
// The counters sit in fonts, text, layout and the PDF writer, and some in
// caches that outlive a render (shaping, hyphenation); an async context
// reaches them all without a counter parameter in each of those layers.

const zero = () => ({
  /** Full layouts of the document: each layout pass and each measuring layout. */
  layouts: 0,
  /** Pages those layouts produced, summed. */
  pagesLaidOut: 0,
  /**
   * Pages or page parts pagination laid out again (layout/paginate): each
   * part of a split page, and each page whose page tokens it rendered.
   */
  pageRelayouts: 0,
  /**
   * Nodes yoga laid out (layout/dimensions), in every layout and every
   * relayout of pagination.
   */
  nodesLaidOut: 0,
  /**
   * Yoga calculations of a laid-out page again for cells over several rows
   * (layout/dimensions/row-spans.ts): none without such a cell, one when a
   * row grows, one for the cells' heights.
   */
  rowSpanLayouts: 0,
  /**
   * Yoga calculations of a laid-out page again for texts laid out in a box
   * that no measure had, whose lines need another height
   * (layout/dimensions/index.ts, `settleTexts`): none without such a text.
   */
  settleLayouts: 0,
  /**
   * Siblings that keeps walked (layout/paginate/split-keep.ts and builder.ts): the
   * walk stops one page below the node, so a long chain of keeps costs at
   * most a page of steps per node.
   */
  keepSteps: 0,
  /**
   * Columns of a column container that pagination filled
   * (`columnFill` in layout/paginate/builder.ts, by sums): one per column of each fill, whether
   * it places the part, probes whether the part ends, or tries a balance;
   * none without column containers.
   */
  columnFills: 0,
  /**
   * Tries of the balance search (`balanced` in builder.ts): only for a
   * segment that can end on its page. It steps from one column end to the
   * next up to the room.
   */
  columnBalanceTries: 0,
  /**
   * Splits or fills of a page beyond the one a page without footnotes
   * makes: the footnote fit (`fitNotes` in layout/paginate/builder.ts, by
   * sums) counts every try after its first. None on
   * a page whose notes fit at once, and none in a document without footnotes.
   */
  noteFits: 0,
  /**
   * Fills of an area again with one more float in it (`fillArea` in
   * layout/paginate/builder.ts, by sums): one per float that its anchor's
   * area tries to place, on each fill of that area (a balance try or a
   * footnote try fills it again). A queued float costs none, and a document
   * without floats none.
   */
  floatFills: 0,
  /** Words the hyphenation patterns split: each word that is not in the word cache (text/words.ts). */
  wordsHyphenated: 0,
  /** Text runs a font shaped (`layout` of a fontkit or a standard font). */
  runsShaped: 0,
  /** Fonts embedded as a subset. */
  fontsEmbedded: 0,
  /** Images decoded and embedded as an XObject. */
  imagesEmbedded: 0,
})

export type WorkCounts = Readonly<ReturnType<typeof zero>>

const current = new AsyncLocalStorage<ReturnType<typeof zero>>()

export const countWork = (counter: keyof WorkCounts, amount = 1): void => {
  const counts = current.getStore()
  if (counts !== undefined) counts[counter] += amount
}

/** Runs `run` and returns its result with the work it counted. A render pool worker counts in its own thread, so the render must run in this process. */
export const countedWork = async <Result>(run: () => Promise<Result>): Promise<{ result: Result, work: WorkCounts }> => {
  const work = zero()
  const result = await current.run(work, run)
  return { result, work }
}
