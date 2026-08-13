import { createRequire } from 'node:module'
import type { Canvas, SKRSContext2D } from '@napi-rs/canvas'
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PdfRenderResult } from '../runtime/shared/template'

/** Raw PDF (or PNG) bytes accepted by the low-level readers. */
export type PdfData = ArrayBuffer | Uint8Array

/** Anything the public `parsePdf`/`rasterizePdf` accept: bytes or a render result. */
export type PdfInput = PdfData | PdfRenderResult

export interface PdfAnnotationReference {
  generation: number
  number: number
}

export type PdfAnnotationDestination
  = | string
    | Array<string | number | null | PdfAnnotationReference>

export interface PdfAnnotation {
  annotationType?: number
  destination?: PdfAnnotationDestination
  rect?: number[]
  subtype: string
  unsafeUrl?: string
  url?: string
}

/** A link annotation flattened to the fields users assert against. */
export interface ParsedPdfLink {
  /** 1-based page the link sits on. */
  page: number
  /** Named internal destination (e.g. a `#id` target), when the link is internal. */
  destination?: string
  /** External URL, when the link points outside the document. */
  url?: string
}

/** A normalized PDF.js text run for tolerant layout and typography assertions. */
export interface ParsedPdfTextRun {
  direction: string
  fontName: string
  fontSize: number
  height: number
  text: string
  width: number
  x: number
  y: number
}

export interface ParsedPdfPage {
  annotations: PdfAnnotation[]
  height: number
  number: number
  rawText: string
  text: string
  textItems: string[]
  textRuns: ParsedPdfTextRun[]
  width: number
}

export interface PdfOutlineItem {
  title: string
  /** Initial viewer state for entries with children. Absent on leaf entries. */
  expanded?: boolean
  children: PdfOutlineItem[]
}

export interface ParsedPdf {
  pageCount: number
  pages: ParsedPdfPage[]
  /** Every link annotation in the document, flattened across pages. */
  links: ParsedPdfLink[]
  /** The bookmark tree (outline), including initial expansion state. */
  outline: PdfOutlineItem[]
}

export interface RasterizePdfOptions {
  background?: string
  scale?: number
}

export interface PdfPageImage {
  height: number
  number: number
  pixels: Uint8ClampedArray
  png: Uint8Array
  width: number
}

export interface ComparePageImagesOptions {
  /** Maximum difference allowed for any RGBA channel in a matching pixel. */
  channelThreshold?: number
  /** Maximum ratio of changed pixels allowed for the page to match. */
  maxChangedPixelRatio?: number
}

export interface PageImageComparison {
  changedPixelRatio: number
  changedPixels: number
  dimensionsMatch: boolean
  matches: boolean
  maxChannelDifference: number
  pageNumbersMatch: boolean
  totalPixels: number
}

const PDF_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2D]
const DEFAULT_CHANNEL_THRESHOLD = 25
const DEFAULT_MAX_CHANGED_PIXEL_RATIO = 0.005

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs')
type CanvasModule = typeof import('@napi-rs/canvas')

const require_ = createRequire(import.meta.url)

let pdfJsPromise: Promise<PdfJs> | undefined
let canvasModule: CanvasModule | undefined

const missingPeerMessage = (name: string): string =>
  `@lupinum/nuxt-pdf/test needs the optional peer dependency "${name}", which is not installed. `
  + `Install it in the project under test, e.g. \`pnpm add -D ${name}\`.`

const isModuleNotFound = (error: unknown): boolean =>
  typeof error === 'object' && error !== null
  && 'code' in error
  && (error.code === 'ERR_MODULE_NOT_FOUND' || error.code === 'MODULE_NOT_FOUND')

/** Load `@napi-rs/canvas` lazily so the entry works without the optional peer. */
function loadCanvas(): CanvasModule {
  if (canvasModule) return canvasModule

  try {
    canvasModule = require_('@napi-rs/canvas') as CanvasModule
  }
  catch (error) {
    if (isModuleNotFound(error)) {
      throw new Error(missingPeerMessage('@napi-rs/canvas'), { cause: error })
    }
    throw error
  }

  return canvasModule
}

class NapiCanvasFactory {
  create(width: number, height: number) {
    const canvas = loadCanvas().createCanvas(width, height)

    return {
      canvas,
      context: canvas.getContext('2d'),
    }
  }

  reset(
    canvasAndContext: { canvas: Canvas, context: SKRSContext2D },
    width: number,
    height: number,
  ) {
    canvasAndContext.canvas.width = width
    canvasAndContext.canvas.height = height
  }

  destroy(canvasAndContext: { canvas: Canvas, context: SKRSContext2D }) {
    canvasAndContext.canvas.width = 0
    canvasAndContext.canvas.height = 0
  }
}

/** Install the canvas primitives PDF.js expects when running in Node. */
export function installPdfCanvasGlobals(): void {
  const { DOMMatrix, ImageData, Path2D } = loadCanvas()
  const globals = globalThis as Record<string, unknown>

  globals.DOMMatrix ??= DOMMatrix
  globals.ImageData ??= ImageData
  globals.Path2D ??= Path2D
}

/** Check the strict engine-output contract that a PDF starts with `%PDF-`. */
export function hasPdfHeader(data: PdfData): boolean {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)

  return PDF_HEADER.every((byte, index) => bytes[index] === byte)
}

/** Normalize extracted text for semantic comparisons without hiding ordering. */
export function normalizePdfText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Resolve any accepted input (bytes or a `PdfRenderResult`) to raw PDF bytes. */
export async function toPdfBytes(input: PdfInput): Promise<Uint8Array> {
  if (input instanceof Uint8Array) return input
  if (input instanceof ArrayBuffer) return new Uint8Array(input)

  if (
    typeof input === 'object' && input !== null
    && 'toUint8Array' in input
    && typeof (input as PdfRenderResult).toUint8Array === 'function'
  ) {
    return (input as PdfRenderResult).toUint8Array()
  }

  throw new TypeError(
    'parsePdf expected PDF bytes (Uint8Array/ArrayBuffer) or a PdfRenderResult.',
  )
}

interface RawOutlineItem { title?: unknown, count?: unknown, items?: unknown }

const simplifyOutline = (items: readonly RawOutlineItem[]): PdfOutlineItem[] =>
  items.map((item) => {
    const children = Array.isArray(item.items)
      ? simplifyOutline(item.items as RawOutlineItem[])
      : []

    return {
      title: typeof item.title === 'string' ? item.title : '',
      ...(children.length === 0
        ? {}
        : { expanded: typeof item.count === 'number' && item.count > 0 }),
      children,
    }
  })

const flattenLinks = (pages: readonly ParsedPdfPage[]): ParsedPdfLink[] =>
  pages.flatMap(page =>
    page.annotations
      .filter(annotation => annotation.subtype === 'Link')
      .map((annotation) => {
        const destination = typeof annotation.destination === 'string'
          ? annotation.destination
          : undefined
        return {
          page: page.number,
          ...(destination === undefined ? {} : { destination }),
          ...(annotation.url === undefined ? {} : { url: annotation.url }),
        }
      }),
  )

/** Parse stable, semantic information from every page of a PDF. */
export async function parsePdf(input: PdfInput): Promise<ParsedPdf> {
  return withPdfDocument(await toPdfBytes(input), async (document) => {
    const pages: ParsedPdfPage[] = []

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)

      try {
        const textContent = await page.getTextContent()
        const textItems = textContent.items.flatMap(item => 'str' in item ? [item.str] : [])
        const textRuns = textContent.items.flatMap((item) => {
          if (!('str' in item)) return []

          const [scaleX = 0, scaleY = 0, , , x = 0, y = 0] = item.transform
          return [{
            direction: item.dir,
            fontName: item.fontName,
            fontSize: roundCoordinate(Math.hypot(scaleX, scaleY)),
            height: roundCoordinate(item.height),
            text: item.str,
            width: roundCoordinate(item.width),
            x: roundCoordinate(x),
            y: roundCoordinate(y),
          }]
        })
        const rawText = textContent.items
          .flatMap(item => 'str' in item ? [item.str, item.hasEOL ? '\n' : ''] : [])
          .join('')
        const annotations = (await page.getAnnotations({ intent: 'display' }))
          .map(normalizeAnnotation)
        const viewport = page.getViewport({ scale: 1 })

        pages.push({
          annotations,
          height: roundCoordinate(viewport.height),
          number: pageNumber,
          rawText,
          text: normalizePdfText(rawText),
          textItems,
          textRuns,
          width: roundCoordinate(viewport.width),
        })
      }
      finally {
        page.cleanup()
      }
    }

    const outline = await document.getOutline() as RawOutlineItem[] | null

    return {
      pageCount: document.numPages,
      pages,
      links: flattenLinks(pages),
      outline: outline ? simplifyOutline(outline) : [],
    }
  })
}

/** Read the PDF outline hierarchy and initial expansion state. */
export async function getPdfOutline(input: PdfInput): Promise<PdfOutlineItem[]> {
  return withPdfDocument(await toPdfBytes(input), async (document) => {
    const outline = await document.getOutline() as RawOutlineItem[] | null
    return outline ? simplifyOutline(outline) : []
  })
}

/** Rasterize every PDF page independently for deterministic page-level diffs. */
export async function rasterizePdf(
  input: PdfInput,
  options: RasterizePdfOptions = {},
): Promise<PdfPageImage[]> {
  const scale = options.scale ?? 1

  if (!Number.isFinite(scale) || scale <= 0) {
    throw new RangeError('PDF raster scale must be a finite number greater than zero')
  }

  const { createCanvas } = loadCanvas()

  return withPdfDocument(await toPdfBytes(input), async (document) => {
    const images: PdfPageImage[] = []

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)

      try {
        const viewport = page.getViewport({ scale })
        const width = Math.ceil(viewport.width)
        const height = Math.ceil(viewport.height)
        const canvas = createCanvas(width, height)
        const context = canvas.getContext('2d')

        await page.render({
          background: options.background ?? '#ffffff',
          canvas: null,
          canvasContext: context as unknown as CanvasRenderingContext2D,
          viewport,
        }).promise

        images.push({
          height,
          number: pageNumber,
          pixels: new Uint8ClampedArray(context.getImageData(0, 0, width, height).data),
          png: new Uint8Array(canvas.encodeSync('png')),
          width,
        })
      }
      finally {
        page.cleanup()
      }
    }

    return images
  })
}

/** Decode a committed PNG into the same page-image shape as `rasterizePdf`. */
export async function decodePngPage(
  data: PdfData,
  number: number,
): Promise<PdfPageImage> {
  if (!Number.isInteger(number) || number < 1) {
    throw new RangeError('PNG page number must be a positive integer')
  }

  const { createCanvas, loadImage } = loadCanvas()
  const png = copyPdfData(data)
  const image = await loadImage(png)
  const canvas = createCanvas(image.width, image.height)
  const context = canvas.getContext('2d')
  context.drawImage(image, 0, 0)

  return {
    height: image.height,
    number,
    pixels: new Uint8ClampedArray(
      context.getImageData(0, 0, image.width, image.height).data,
    ),
    png,
    width: image.width,
  }
}

/** Encode a validated RGBA page image as PNG bytes. */
export function encodePngPage(image: PdfPageImage): Uint8Array {
  assertPageImage(image, 'encoded')
  const { createCanvas } = loadCanvas()
  const canvas = createCanvas(image.width, image.height)
  const context = canvas.getContext('2d')
  const data = context.createImageData(image.width, image.height)
  data.data.set(image.pixels)
  context.putImageData(data, 0, 0)
  return new Uint8Array(canvas.encodeSync('png'))
}

/** Compare two rasterized pages using explicit per-channel and page thresholds. */
export function comparePageImages(
  actual: PdfPageImage,
  expected: PdfPageImage,
  options: ComparePageImagesOptions = {},
): PageImageComparison {
  const channelThreshold = options.channelThreshold ?? DEFAULT_CHANNEL_THRESHOLD
  const maxChangedPixelRatio = options.maxChangedPixelRatio
    ?? DEFAULT_MAX_CHANGED_PIXEL_RATIO

  assertThreshold(channelThreshold, 255, 'channelThreshold')
  assertThreshold(maxChangedPixelRatio, 1, 'maxChangedPixelRatio')
  assertPageImage(actual, 'actual')
  assertPageImage(expected, 'expected')

  const pageNumbersMatch = actual.number === expected.number
  const dimensionsMatch = actual.width === expected.width
    && actual.height === expected.height

  if (!dimensionsMatch) {
    const totalPixels = Math.max(actual.width * actual.height, expected.width * expected.height)

    return {
      changedPixelRatio: totalPixels === 0 ? 0 : 1,
      changedPixels: totalPixels,
      dimensionsMatch: false,
      matches: false,
      maxChannelDifference: 255,
      pageNumbersMatch,
      totalPixels,
    }
  }

  const totalPixels = actual.width * actual.height
  let changedPixels = 0
  let maxChannelDifference = 0

  for (let offset = 0; offset < actual.pixels.length; offset += 4) {
    let pixelChanged = false

    for (let channel = 0; channel < 4; channel += 1) {
      const difference = Math.abs(
        actual.pixels[offset + channel]! - expected.pixels[offset + channel]!,
      )
      maxChannelDifference = Math.max(maxChannelDifference, difference)
      pixelChanged ||= difference > channelThreshold
    }

    if (pixelChanged) changedPixels += 1
  }

  const changedPixelRatio = totalPixels === 0 ? 0 : changedPixels / totalPixels

  return {
    changedPixelRatio,
    changedPixels,
    dimensionsMatch,
    matches: pageNumbersMatch && changedPixelRatio <= maxChangedPixelRatio,
    maxChannelDifference,
    pageNumbersMatch,
    totalPixels,
  }
}

async function getPdfJs(): Promise<PdfJs> {
  installPdfCanvasGlobals()

  if (!pdfJsPromise) {
    pdfJsPromise = import('pdfjs-dist/legacy/build/pdf.mjs').catch((error: unknown) => {
      pdfJsPromise = undefined
      if (isModuleNotFound(error)) {
        throw new Error(missingPeerMessage('pdfjs-dist'), { cause: error })
      }
      throw error
    })
  }

  return pdfJsPromise
}

async function withPdfDocument<Result>(
  data: PdfData,
  read: (document: PDFDocumentProxy) => Promise<Result>,
): Promise<Result> {
  const pdfJs = await getPdfJs()
  const loadingTask = pdfJs.getDocument({
    CanvasFactory: NapiCanvasFactory,
    data: copyPdfData(data),
    stopAtErrors: true,
    useWorkerFetch: false,
    verbosity: 0,
  })

  try {
    return await read(await loadingTask.promise)
  }
  finally {
    await loadingTask.destroy()
  }
}

function copyPdfData(data: PdfData): Uint8Array {
  return data instanceof Uint8Array
    ? Uint8Array.from(data)
    : new Uint8Array(data.slice(0))
}

function normalizeAnnotation(value: unknown): PdfAnnotation {
  const annotation = isRecord(value) ? value : {}
  const annotationType = typeof annotation.annotationType === 'number'
    ? annotation.annotationType
    : undefined
  const destination = normalizeDestination(annotation.dest)
  const rect = Array.isArray(annotation.rect)
    ? annotation.rect.filter(item => typeof item === 'number').map(roundCoordinate)
    : undefined
  const unsafeUrl = asUrl(annotation.unsafeUrl)
  const url = asUrl(annotation.url)

  return {
    ...(annotationType === undefined ? {} : { annotationType }),
    ...(destination === undefined ? {} : { destination }),
    ...(rect?.length === 4 ? { rect } : {}),
    subtype: typeof annotation.subtype === 'string' ? annotation.subtype : 'Unknown',
    ...(unsafeUrl === undefined ? {} : { unsafeUrl }),
    ...(url === undefined ? {} : { url }),
  }
}

function normalizeDestination(value: unknown): PdfAnnotationDestination | undefined {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return undefined

  const destination: Array<string | number | null | PdfAnnotationReference> = []

  for (const part of value) {
    if (part === null || typeof part === 'string' || typeof part === 'number') {
      destination.push(part)
      continue
    }

    if (isRecord(part) && typeof part.num === 'number' && typeof part.gen === 'number') {
      destination.push({ generation: part.gen, number: part.num })
    }
  }

  return destination
}

function asUrl(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (value instanceof URL) return value.href
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function roundCoordinate(value: number): number {
  return Math.round(value * 1000) / 1000
}

function assertThreshold(value: number, maximum: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > maximum) {
    throw new RangeError(`${name} must be between 0 and ${maximum}`)
  }
}

function assertPageImage(image: PdfPageImage, name: string): void {
  if (!Number.isInteger(image.number) || image.number < 1) {
    throw new RangeError(`${name} page number must be a positive integer`)
  }

  if (!Number.isInteger(image.width) || image.width < 1
    || !Number.isInteger(image.height) || image.height < 1) {
    throw new RangeError(`${name} page dimensions must be positive integers`)
  }

  const expectedLength = image.width * image.height * 4

  if (image.pixels.length !== expectedLength) {
    throw new RangeError(`${name} page pixels must contain ${expectedLength} RGBA channels`)
  }
}
