import { Worker } from 'node:worker_threads'
import { defineComponent, h } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { markdownArticle } from '../playground/shared/article'
import { PDF_COMPONENTS } from '../src/runtime/components'
import { parseRichTextMarkdown } from '../src/runtime/rich-text'
import { parseMarkdownText } from '../src/runtime/rich-text/markdown-parse'
import type { PdfRichBlock } from '../src/runtime/rich-text/types'
import { PDF_WORKER_MARKER } from '../src/runtime/server/engine/worker-entry'
import type { WorkerMarkdownResponse } from '../src/runtime/server/engine/worker-protocol'
import { createPdfTemplate } from '../src/runtime/server/registry'
import {
  PDF_SOURCE_EXEC_ARGV,
  PDF_WORKER_MAX_RENDERS,
  errorFromWorker,
  pdfRenderPlacement,
} from '../src/runtime/server/worker-pool'
import { NuxtPdfError, PDF_ERROR_CODES } from '../src/runtime/shared/errors'
import { PDF_DEFINITION_PROPERTY } from '../src/runtime/shared/template'
import { parsePdf } from '../src/test/pdf'

// Every pool worker this file starts, counted. The subclass only records.
const spawned = vi.hoisted(() => ({ count: 0 }))
vi.mock('node:worker_threads', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:worker_threads')>()
  class CountedWorker extends actual.Worker {
    constructor(...args: ConstructorParameters<typeof actual.Worker>) {
      super(...args)
      spawned.count += 1
    }
  }
  return { ...actual, Worker: CountedWorker }
})

const { PdfDocument, PdfPage, PdfRichText } = PDF_COMPONENTS

/** `unit` repeated to exactly 250,000 characters, the Markdown length limit. */
const fill = (unit: string): string => unit.repeat(Math.ceil(250_000 / unit.length)).slice(0, 250_000)

/** `count` quotes `depth` levels deep, each with a comment opener and lazy lines, about 249,000 characters. */
const deepQuotes = (depth: number, count: number): string => {
  const head = `${'> '.repeat(depth)}${count > 0 ? '<!--' : 'b'}\n`
  const units = Math.max(count, 1)
  const gap = Math.floor(249_000 / units) - head.length
  return `${head}${'a\n'.repeat(Math.floor(gap / 2))}`.repeat(units)
}

/** Hostile Markdown measured on the main thread with comark 0.9.2 (D29). */
const SLOW_INPUTS: Array<[string, string]> = [
  ['a quote 100 levels deep (about 1.3 s)', deepQuotes(100, 0)],
  ['20 comments in quotes 60 levels deep (about 7.7 s)', deepQuotes(60, 20)],
  ['250,000 characters of "<!--" (about 16 s)', fill('<!--')],
]

const LIMIT_MS = 500

// The timing bounds below are far from what a broken deadline gives, so the
// load of the machine cannot reach them: without the deadline the slow inputs
// parse for 7.7 s and 16 s (longer under load), and a parse on the main thread
// blocks the event loop for the whole 2 s limit. There is no lower bound: Node
// starts a timer from its cached loop time, so the deadline can fire a few
// milliseconds before the budget as `performance.now()` counts it. A limit that
// fires too early fails the successful parses under a limit in this file.
const LATE_MS = 5_000

/** A warm, idle pool worker, so a limit measures the parse and not a cold start. */
const warm = () => parseRichTextMarkdown('# warm', { timeoutMs: 10_000 })

afterEach(() => {
  pdfRenderPlacement.inProcess = false
  pdfRenderPlacement.maxRendersPerWorker = PDF_WORKER_MAX_RENDERS
})

describe('parseRichTextMarkdown in the render worker', () => {
  // Catches a Markdown request without the hard deadline: the parse succeeds
  // (the first input) or the call waits seconds for comark (the others).
  it.each(SLOW_INPUTS)('ends %s at the time limit', async (_name, markdown) => {
    await warm()
    const started = performance.now()
    const error = await parseRichTextMarkdown(markdown, { timeoutMs: LIMIT_MS }).then(() => undefined, (failure: unknown) => failure)
    const elapsed = performance.now() - started

    expect(error).toBeInstanceOf(NuxtPdfError)
    expect(error).toMatchObject({ code: PDF_ERROR_CODES.LimitExceeded })
    expect((error as NuxtPdfError).message).toMatch(/^parseRichTextMarkdown exceeded its 500ms time budget \(elapsed \d+ms\)\. Raise pdf\.limits\.markdownTimeoutMs/)
    expect(elapsed).toBeLessThan(LATE_MS)
  }, 30_000)

  // Catches a worker that is given back to the pool after its time ran out:
  // it is still inside comark, so the next request would wait for it (or get
  // its late answer).
  it('serves the next request with a fresh worker after a timeout', async () => {
    await warm()
    await expect(parseRichTextMarkdown(fill('<!--'), { timeoutMs: LIMIT_MS })).rejects.toMatchObject({ code: PDF_ERROR_CODES.LimitExceeded })
    const started = performance.now()

    expect(await parseRichTextMarkdown('Next **one**', { timeoutMs: 10_000 }))
      .toEqual([{ type: 'paragraph', children: [{ type: 'text', text: 'Next ' }, { type: 'text', text: 'one', bold: true }] }])
    expect(performance.now() - started).toBeLessThan(LATE_MS)
  }, 30_000)

  // Catches a parse on the main thread: comark's synchronous tokenizer would
  // hold the event loop for the whole parse, so the timer would stall.
  it('keeps the main thread responsive while a slow parse runs', async () => {
    await warm()
    let last = performance.now()
    let longestGap = 0
    const timer = setInterval(() => {
      const now = performance.now()
      longestGap = Math.max(longestGap, now - last)
      last = now
    }, 10)
    const outcome = await parseRichTextMarkdown(deepQuotes(60, 20), { timeoutMs: 2_000 })
      .then(() => 'model', (error: unknown) => error)
    // A blocked loop runs no tick until the parse ends: count that last gap.
    longestGap = Math.max(longestGap, performance.now() - last)
    clearInterval(timer)

    expect(longestGap).toBeLessThan(1_000)
    expect(outcome).toMatchObject({ code: PDF_ERROR_CODES.LimitExceeded })
  }, 30_000)

  // Catches a worker path that maps differently from comark on the main thread.
  it('gives the same model as a parse on the main thread', async () => {
    expect(await parseRichTextMarkdown(markdownArticle.markdown)).toEqual(await parseMarkdownText(markdownArticle.markdown))
  })

  // Catches a build without a worker chunk that parses on the main thread
  // after all, where comark can block the server.
  it('fails with a typed error when the build has no render worker', async () => {
    pdfRenderPlacement.inProcess = true
    await expect(parseRichTextMarkdown('# a')).rejects.toMatchObject({
      code: PDF_ERROR_CODES.RenderError,
      message: expect.stringContaining('parseRichTextMarkdown parses in the PDF render worker, and this build has none'),
    })
  })

  // Catches a time limit above the longest Node timer, which fires after 1 ms.
  it('rejects a time limit outside 1 to 2,147,483,647 ms', async () => {
    await expect(parseRichTextMarkdown('# a', { timeoutMs: 0 })).rejects.toThrow('parseRichTextMarkdown: "timeoutMs" must be a whole number from 1 to 2,147,483,647 ms, found 0.')
    await expect(parseRichTextMarkdown('# a', { timeoutMs: 2 ** 32 })).rejects.toThrow('found 4294967296.')
  })

  // Catches the missing-package error lost on the way back from the worker:
  // the import fails in the worker, and the caller must still read the
  // package name and the install command.
  it('names comark and the install command when the import fails in the worker', async () => {
    const hideComark = `export async function resolve(specifier, context, next) {
  if (specifier === 'comark') throw Object.assign(new Error('Cannot find package comark'), { code: 'ERR_MODULE_NOT_FOUND' })
  return next(specifier, context)
}`
    const worker = new Worker(new URL('../src/runtime/server/engine/worker-entry.ts', import.meta.url), {
      execArgv: [
        ...PDF_SOURCE_EXEC_ARGV,
        '--import',
        `data:text/javascript,${encodeURIComponent(`import { register } from 'node:module'\nregister('data:text/javascript,' + encodeURIComponent(${JSON.stringify(hideComark)}))`)}`,
      ],
      workerData: { [PDF_WORKER_MARKER]: true },
    })
    try {
      const response = await new Promise<WorkerMarkdownResponse>((resolve, reject) => {
        worker.once('message', resolve)
        worker.once('error', reject)
        worker.postMessage({ kind: 'markdown', request: { markdown: '# a' } })
      })
      if (response.ok) throw new Error('expected a failure')
      expect(errorFromWorker(response)).toMatchObject({
        code: PDF_ERROR_CODES.RenderError,
        message: 'parseRichTextMarkdown needs the optional peer dependency "comark", which is not installed. Install it: pnpm add comark',
      })
    }
    finally {
      await worker.terminate()
    }
  }, 20_000)

  // Catches state that a parse or a render leaves in a worker for the next
  // request: comark shares one markdown-exit instance per plugin set, and the
  // engine keeps module caches.
  it('gives the same results in one worker, in mixed order, as each request alone', async () => {
    const first = '# Seeds\n\n## Seeds\n\nText[^1] with a [link](https://example.test/a).\n\n::callout{tone="tip"}\nInside\n::\n\n- [x] done\n\n[^1]: Note.'
    const second = '## Seeds\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n```js\nconst x = 1\n```\n\n> Quote <!-- hidden -->'
    const render = async (content: PdfRichBlock[]): Promise<string[]> => {
      const Template = Object.assign(defineComponent(() => () => h(PdfDocument, { creationDate: new Date(0) }, () =>
        h(PdfPage, null, () => h(PdfRichText, { content })))), { [PDF_DEFINITION_PROPERTY]: {} })
      const result = await createPdfTemplate('mixed', Template).render({})
      return (await parsePdf(await result.toUint8Array())).pages.map(page => page.text)
    }

    // Alone: each request in a worker of its own.
    pdfRenderPlacement.maxRendersPerWorker = 1
    const firstAlone = await parseRichTextMarkdown(first)
    const secondAlone = await parseRichTextMarkdown(second)
    const renderAlone = await render(firstAlone)
    const renderSecondAlone = await render(secondAlone)

    // Mixed, in one worker: the pool has no idle worker now, so it starts one
    // and the sequential requests reuse it.
    pdfRenderPlacement.maxRendersPerWorker = PDF_WORKER_MAX_RENDERS
    const before = spawned.count
    const secondMixed = await parseRichTextMarkdown(second)
    const renderMixed = await render(secondMixed)
    const firstMixed = await parseRichTextMarkdown(first)
    const renderAfter = await render(firstMixed)
    const secondAgain = await parseRichTextMarkdown(second)

    expect(spawned.count - before).toBe(1)
    expect(firstMixed).toEqual(firstAlone)
    expect(secondMixed).toEqual(secondAlone)
    expect(secondAgain).toEqual(secondAlone)
    expect(renderAfter).toEqual(renderAlone)
    expect(renderMixed).toEqual(renderSecondAlone)
  }, 30_000)
})
