import { Buffer } from 'node:buffer'
import { Readable } from 'node:stream'
import type {
  PdfDisposition,
  PdfRenderResult,
  PdfResponseInit,
} from '../shared/template'

const DEFAULT_FILENAME = 'document.pdf'
const MAX_FILENAME_LENGTH = 180
const UNSAFE_FILENAME_CHARACTERS = /[\p{Cc}"\\/:*?<>|]/gu
const EDGE_DOTS_OR_SPACES = /^[.\s]+|[.\s]+$/g

const ensurePdfExtension = (filename: string) =>
  filename.toLowerCase().endsWith('.pdf') ? filename : `${filename}.pdf`

export const sanitizePdfFilename = (value: string): string => {
  const normalized = value
    .normalize('NFKC')
    .replace(UNSAFE_FILENAME_CHARACTERS, '_')
    .replace(/\s+/g, ' ')
    .replace(EDGE_DOTS_OR_SPACES, '')
    .slice(0, MAX_FILENAME_LENGTH)
    .replace(EDGE_DOTS_OR_SPACES, '')

  return ensurePdfExtension(normalized || DEFAULT_FILENAME)
}

const encodeFilename = (filename: string) => encodeURIComponent(filename)
  .replace(/[!'()*]/g, character =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )

const asciiFilename = (filename: string) => filename
  .normalize('NFKD')
  .replace(/[^\x20-\x7E]/g, '_')
  .replace(/["\\]/g, '_')

export const createContentDisposition = (
  disposition: PdfDisposition,
  filename: string,
): string => {
  const safeFilename = sanitizePdfFilename(filename)

  return `${disposition}; filename="${asciiFilename(safeFilename)}"; filename*=UTF-8''${encodeFilename(safeFilename)}`
}

export const createPdfRenderResult = (
  source: PromiseLike<Uint8Array> | Uint8Array,
  defaultFilename?: string,
): PdfRenderResult => {
  const bytesPromise = Promise.resolve(source).then(bytes =>
    new Uint8Array(bytes),
  )

  return {
    async toUint8Array() {
      return new Uint8Array(await bytesPromise)
    },
    async toBuffer() {
      return Buffer.from(await bytesPromise)
    },
    async toStream() {
      return Readable.from([Buffer.from(await bytesPromise)])
    },
    async response(init: PdfResponseInit = {}) {
      const {
        disposition = 'attachment',
        filename = defaultFilename,
        headers: initialHeaders,
        ...responseInit
      } = init
      const headers = new Headers(initialHeaders)

      headers.set('content-type', 'application/pdf')
      if (filename) {
        headers.set(
          'content-disposition',
          createContentDisposition(disposition, filename),
        )
      }
      else if (disposition === 'inline') {
        headers.set('content-disposition', 'inline')
      }

      return new Response(
        new Uint8Array(await bytesPromise),
        { ...responseInit, headers },
      )
    },
  }
}
