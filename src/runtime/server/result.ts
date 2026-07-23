import { Buffer } from 'node:buffer'
import type {
  PdfDisposition,
  PdfRenderDiagnostics,
  PdfRenderResult,
  PdfResponseInit,
  ResolvedPdfMetadata,
} from '../shared/template'

const DEFAULT_BASENAME = 'document'
const DEFAULT_FILENAME = `${DEFAULT_BASENAME}.pdf`
const PDF_EXTENSION = '.pdf'
const MAX_FILENAME_CODE_POINTS = 180
const MAX_ENCODED_FILENAME_LENGTH = 600
const MAX_ASCII_FILENAME_LENGTH = 180
const UNSAFE_FILENAME_CHARACTERS = /[\p{Cc}"\\/:*?<>|\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu
const EDGE_DOTS_OR_SPACES = /^[.\s]+|[.\s]+$/g

const encodeFilename = (filename: string): string => encodeURIComponent(filename)
  .replace(/[!'()*]/g, character =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )

const truncateFilenameBase = (base: string): string => {
  const maxBaseCodePoints = MAX_FILENAME_CODE_POINTS - PDF_EXTENSION.length
  let encodedLength = encodeFilename(PDF_EXTENSION).length
  let points = 0
  let result = ''

  for (const character of base) {
    const characterLength = encodeFilename(character).length
    if (
      points >= maxBaseCodePoints
      || encodedLength + characterLength > MAX_ENCODED_FILENAME_LENGTH
    ) break

    result += character
    encodedLength += characterLength
    points += 1
  }

  return result.replace(EDGE_DOTS_OR_SPACES, '') || DEFAULT_BASENAME
}

export const sanitizePdfFilename = (value: string): string => {
  const normalized = value
    .toWellFormed()
    .normalize('NFKC')
    .replace(UNSAFE_FILENAME_CHARACTERS, '_')
    .replace(/\s+/g, ' ')
    .replace(EDGE_DOTS_OR_SPACES, '')
  const base = normalized.toLowerCase().endsWith(PDF_EXTENSION)
    ? normalized.slice(0, -PDF_EXTENSION.length)
    : normalized

  return `${truncateFilenameBase(base)}${PDF_EXTENSION}`
}

const asciiFilename = (filename: string): string => {
  const base = filename
    .slice(0, -PDF_EXTENSION.length)
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\]/g, '_')
    .replace(EDGE_DOTS_OR_SPACES, '')
    .slice(0, MAX_ASCII_FILENAME_LENGTH - PDF_EXTENSION.length)
    .replace(EDGE_DOTS_OR_SPACES, '')

  return `${base || DEFAULT_BASENAME}${PDF_EXTENSION}`
}

export const createContentDisposition = (
  disposition: PdfDisposition,
  filename: string,
): string => {
  const safeFilename = sanitizePdfFilename(filename)

  return `${disposition}; filename="${asciiFilename(safeFilename)}"; filename*=UTF-8''${encodeFilename(safeFilename)}`
}

type CompletedRenderDiagnostics = Omit<PdfRenderDiagnostics, 'byteLength'>

export const createPdfRenderResult = (
  source: Uint8Array,
  metadata: ResolvedPdfMetadata,
  diagnostics: CompletedRenderDiagnostics,
): PdfRenderResult => {
  // The engine has completed before a result exists. Keep one private copy and
  // return a fresh view for every conversion so callers cannot mutate it.
  const bytes = new Uint8Array(source)
  const completedDiagnostics: PdfRenderDiagnostics = Object.freeze({
    byteLength: bytes.byteLength,
    durationMs: diagnostics.durationMs,
    pageCount: diagnostics.pageCount,
    passes: diagnostics.passes,
    registeredFontFaces: Object.freeze(diagnostics.registeredFontFaces.map(face =>
      Object.freeze({ ...face }))),
  })
  const completedMetadata: Readonly<ResolvedPdfMetadata> = Object.freeze({
    filename: metadata.filename,
    language: metadata.language,
    title: metadata.title,
  })

  return Object.freeze({
    metadata: completedMetadata,
    diagnostics: completedDiagnostics,
    async toUint8Array() {
      return new Uint8Array(bytes)
    },
    async toBuffer() {
      return Buffer.from(bytes)
    },
    async response(init: PdfResponseInit = {}) {
      const {
        disposition = 'attachment',
        filename = completedMetadata.filename ?? DEFAULT_FILENAME,
        headers: initialHeaders,
        ...responseInit
      } = init
      const headers = new Headers(initialHeaders)

      headers.set('content-type', 'application/pdf')
      headers.set('content-length', String(bytes.byteLength))
      headers.set(
        'content-disposition',
        createContentDisposition(disposition, filename),
      )

      return new Response(new Uint8Array(bytes), { ...responseInit, headers })
    },
  })
}
