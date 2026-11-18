declare module '@react-pdf/pdfkit' {
  import type { Buffer } from 'node:buffer'
  import type { Readable } from 'node:stream'

  /** Options of `PDFDocument#file`, the subset this module passes. */
  export interface PDFFileOptions {
    name: string
    type?: string
    description?: string
    relationship?: 'Alternative' | 'Data' | 'Source' | 'Supplement' | 'Unspecified'
    creationDate?: Date
    modifiedDate?: Date
    hidden?: boolean
  }

  /** An indirect object; `end()` writes it, with `chunk` as its stream. */
  export interface PDFReference {
    data: Record<string, unknown>
    /** Writes the object, with `chunk` as its stream (deflated when the document compresses). */
    end(chunk?: Buffer | string): void
    /**
     * Engine internal (CONTRACTS.md, "Reproducible output"): writes the object.
     * An own property, bound in the constructor; the deflate stream's `end`
     * event and an uncompressed `end()` both call it through the instance.
     */
    finalize: () => void
    /** Engine internal: the zlib stream, created by the first compressed write. */
    deflate: object | null
  }

  /** png-js's decoder, for a PNG image (engine internal, CONTRACTS.md "Reproducible output"). */
  export interface PNGDecoder {
    /** Inflates the pixel data asynchronously and passes the pixels to `done`. */
    decodePixels(done: (pixels: Uint8Array) => void): void
  }

  /** An opened image; `image` is the png-js decoder of a PNG, absent for a JPEG. */
  export interface PDFImage {
    image?: PNGDecoder | null
  }

  /** One operator line of a page's content stream. */
  export type PDFContentChunk = string | Uint8Array

  /** The current page (engine internal for tagging, CONTRACTS.md "Tagged PDF"). */
  export interface PDFPage {
    /** The page dictionary; `data` is written when the page ends. */
    dictionary: PDFReference
    /** Append one line to the page's content stream. */
    write(chunk: PDFContentChunk): void
    /** The annotations of the page; `annotate` pushes each one, already ended. */
    annotations: PDFReference[]
  }

  /** The XMP collector `end()` writes as the catalog's `Metadata` stream. */
  export interface PDFMetadataCollector {
    append(xml: string, newline?: boolean): void
    end(): void
    getXML(): string
    getLength(): number
  }

  /**
   * Engine internal (CONTRACTS.md, "Encryption"): the security handler.
   * `PDFReference#finalize` passes every string and stream of object `id`
   * through `getEncryptFn(id, gen)`, the trailer writes `dictionary` as
   * `/Encrypt`, and `end()` calls `end()`.
   */
  export interface PDFSecurityHandler {
    dictionary: PDFReference
    getEncryptFn(id: number, gen: number): (data: Buffer) => Buffer
    end(): void
  }

  /** A form field dictionary as `_fieldDict` returns it (CONTRACTS.md, "Forms"). */
  export type PDFFieldDictionary = Record<string, unknown>

  /** A standard 14 font with its AFM metrics (engine internal, CONTRACTS.md "Forms"). */
  export interface PDFStandardFont {
    /** The resource name, such as `F3`. */
    id: string
    /** Ascender and descender in units of 1/1000 of the size (the descender is negative). */
    ascender: number
    descender: number
    /** The indirect font object. */
    ref(): PDFReference
    /** WinAnsi codes in hex, and each glyph's `advanceWidth` in 1/1000 units (no kerning). */
    encode(text: string): [string[], { advanceWidth: number }[]]
    /** (ascender − descender, plus the line gap when `includeGap`) × size / 1000. */
    lineHeight(size: number, includeGap?: boolean): number
  }

  export default class PDFDocument extends Readable {
    constructor(options?: Record<string, unknown>)
    /** Engine internal, used for PDF/A only (CONTRACTS.md, "PDF/A-3b"). */
    metadata: PDFMetadataCollector
    /** Engine internal: the document catalog (CONTRACTS.md, "PDF/A-3b"). */
    _root: PDFReference
    /** Engine internal: `null` unless a security handler is installed (CONTRACTS.md, "Encryption"). */
    _security: PDFSecurityHandler | null
    /** Select a font for the next text; a standard font by name (`'Helvetica'`). */
    font(name: string): this
    /** Engine internal (CONTRACTS.md, "Forms"): the selected font; a standard font after `font('Helvetica')`. */
    _font: PDFStandardFont
    /** Engine internal: a CSS colour as operands (0–1), or `null` for an unknown one. */
    _normalizeColor(color: string): number[] | null
    /** Engine internal (CONTRACTS.md, "Forms"): creates the AcroForm with the current font as its default appearance. */
    initForm(): this
    /**
     * Engine internal (CONTRACTS.md, "Forms"): a field and its widget at the
     * box under the current transform; `formText` calls it through `this`.
     */
    formAnnotation(name: string, type: string, x: number, y: number, w: number, h: number, options?: Record<string, unknown>): this
    /**
     * Engine internal (CONTRACTS.md, "Forms"): builds the dictionary of each
     * field; `type` is `'text'`, `'checkbox'`, `'combo'` and so on.
     */
    _fieldDict(name: string, type: string | null, options: Record<string, unknown>): PDFFieldDictionary
    /** Engine internal (CONTRACTS.md, "Forms"): gives a field the current font as its own appearance font. */
    _resolveFont(options: Record<string, unknown>): Record<string, unknown>
    /** A new indirect object with this dictionary. */
    ref(data?: Record<string, unknown>): PDFReference
    /** The page being painted; `null` before the first `addPage`. */
    page: PDFPage | null
    /** Every paint operator goes through here (one line each). */
    addContent(data: PDFContentChunk): this
    save(): this
    restore(): this
    /** `name` is whatever the painter passes: `node.props.id`. */
    addNamedDestination(name: unknown, ...args: unknown[]): void
    addPage(options?: Record<string, unknown>): this
    /** A URI link annotation; `options` become entries of its dictionary. */
    link(x: number, y: number, w: number, h: number, url: string | number, options?: Record<string, unknown>): this
    /** A link annotation to a named destination. */
    goTo(x: number, y: number, w: number, h: number, name: string, options?: Record<string, unknown>): this
    /**
     * Engine internal: opens (does not embed) an image. The painter and
     * `image()` call it through the instance for every new image.
     */
    openImage(src: unknown): PDFImage
    /** Paints an image as one `q … Do … Q`. */
    image(...args: unknown[]): this
    /** Ends the pages, writes the catalog and the trailer. */
    end(): void
    /**
     * Embed a file. Only a `Buffer` is content: a string is read as a server
     * file path (or a data URL), and a plain `Uint8Array` takes that branch too.
     */
    file(src: Buffer, options: PDFFileOptions): unknown
  }
}
