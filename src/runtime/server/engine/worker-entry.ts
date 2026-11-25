import { Buffer } from 'node:buffer'
import type { MessagePort } from 'node:worker_threads'
import { parentPort, workerData } from 'node:worker_threads'
import { PDF_PRIMITIVES } from '../../primitives'
import type { PdfNode } from '../../renderer'
import { parseMarkdownText } from '../../rich-text/markdown-parse'
import { NuxtPdfError } from '../../shared/errors'
import { createRenderLimits, type RenderLimits } from '../render-limits'
import { createPdfFontStore } from './fonts'
import { renderPlainDocument } from './plain-tree'
import { countPages } from './laid-out'
import {
  transferableBuffer,
  type PlainRenderOutput,
  type WorkerRenderFailure,
  type WorkerRenderRequest,
  type WorkerRequest,
  type WorkerResponse,
} from './worker-protocol'

// The render worker: font store, engine adapter, layout, and serialization;
// also the Markdown parse with comark (rich-text/markdown-parse.ts), so that
// hostile Markdown runs where the deadline can end it. It imports no Vue code;
// test/worker-render.test.ts checks the import graph.
//
// The main thread imports this module dynamically. A bundler (Nitro's Rollup)
// then emits it as its own chunk, `PDF_WORKER_URL` names that chunk, and the
// pool starts workers from it. On the main thread the module only exports;
// `renderPlainRequest` also runs there when the build has no worker chunk.

/** Marker in `workerData` that turns this module into the render worker. */
export const PDF_WORKER_MARKER = 'nuxtPdfRenderWorker'

/**
 * URL of this module, as the bundler emitted it, or undefined when the build
 * has no worker chunk. Nitro rewrites `import.meta.url` to a global that names
 * the server entry; the module's Rollup hook sets the right value here
 * (src/module.ts, "render worker URL").
 */
export const PDF_WORKER_URL: string | undefined = import.meta.url

// A structured clone turns a Buffer into a plain Uint8Array, and the engine's
// image decoder reads Buffer methods. Wrap the same memory again; no copy.
const restoreImageBuffers = (node: PdfNode): void => {
  if (node.type === PDF_PRIMITIVES.TextInstance) return
  const src = node.props.src
  if (
    node.type === PDF_PRIMITIVES.Image
    && src instanceof Uint8Array
    && !Buffer.isBuffer(src)
  ) {
    node.props.src = Buffer.from(src.buffer, src.byteOffset, src.byteLength)
  }
  for (const child of node.children) restoreImageBuffers(child)
}

/** Lay out and serialize one request. Runs in the worker and in-process. */
export const renderPlainRequest = async (
  request: WorkerRenderRequest,
  limits: RenderLimits = createRenderLimits(request.limits, request.elapsedMs),
): Promise<PlainRenderOutput> => {
  restoreImageBuffers(request.document)
  const result = await renderPlainDocument(request.document, {
    // One store and one font object per font per document. fontkit caches
    // glyphs per font object, and a glyph first loaded as part of a composite
    // (the O inside Ö) is cached without its code point. A later document that
    // shares the object then drops that letter: "Own" printed as "wn". The
    // parsed font data is shared (engine/fonts.ts).
    fontStore: createPdfFontStore(request.fonts),
    limits,
    maxPasses: request.maxPasses,
  })
  return {
    bytes: result.bytes,
    layoutWarnings: result.layoutWarnings,
    pageCount: countPages(result.layout),
    passes: result.passes,
  }
}

/** An error as plain data for the main thread (`errorFromWorker` rebuilds it). */
export const describeError = (error: unknown): WorkerRenderFailure => {
  if (!(error instanceof Error)) {
    return { ok: false, name: 'Error', message: String(error) }
  }
  const cause: unknown = error.cause
  return {
    ok: false,
    code: error instanceof NuxtPdfError ? error.code : undefined,
    source: error instanceof NuxtPdfError ? error.source : undefined,
    issues: error instanceof NuxtPdfError ? error.issues : undefined,
    name: error.name,
    message: error.message,
    stack: error.stack,
    cause: cause instanceof Error
      ? { name: cause.name, message: cause.message, stack: cause.stack }
      : cause === undefined ? undefined : { name: 'Error', message: String(cause) },
  }
}

const isRenderWorker = (data: unknown): boolean =>
  typeof data === 'object' && data !== null
  && (data as Record<string, unknown>)[PDF_WORKER_MARKER] === true

const startWorker = (port: MessagePort): void => {
  port.on('message', async (message: WorkerRequest) => {
    let response: WorkerResponse<unknown>
    let bytes: Uint8Array | undefined
    try {
      if (message.kind === 'markdown') {
        response = { ok: true, output: await parseMarkdownText(message.request.markdown) }
      }
      else {
        const output = await renderPlainRequest(message.request)
        bytes = output.bytes
        response = { ok: true, output }
      }
    }
    catch (error) {
      response = describeError(error)
    }
    // The PDF moves back without a copy when it owns its whole buffer.
    const transfer = transferableBuffer(bytes)
    port.postMessage(response, transfer ? [transfer] : [])
  })
}

if (parentPort && isRenderWorker(workerData)) startWorker(parentPort)
