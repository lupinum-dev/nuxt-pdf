import { ENCRYPTION_EXTENSIONS, type createEncryption } from '../protection'
import type { FontProgram } from '../form-font'
import type { StructurePlan } from '../tagged'
import { createAnnotations } from './annotations'
import { clamp, createPageContent, pagePoint } from './content'
import { writeAttachments, writeMetadata, writeOutputIntent, type OutputIntent, type WriterAttachment } from './document-parts'
import { createPdfFile } from './file'
import { createForm } from './forms'
import { createGradients } from './gradients'
import { createImages } from './images'
import { createMarkedContent } from './marked-content'
import { PdfBytes, PdfDate, PdfText } from './objects'
import { createOutline } from './outline'
import { createText } from './text'
import type { PdfWriter } from './writer'

// Our PDF writer (D37): the `PdfWriter`
// operators wired to their modules, and the document around the pages.
// `file.ts` and `objects.ts` write the file; `content.ts` the pages, the
// graphics state and the path and paint operators; `text.ts` the fonts and
// glyph runs (`fonts.ts` the embedded ones); `images.ts`; `gradients.ts`;
// `annotations.ts` links, notes and destinations; `forms.ts` the AcroForm;
// `outline.ts`; `document-parts.ts` the metadata, the output intent and the
// attachments; `marked-content.ts` the marked content and the structure tree.

/** What is not paint: set when the writer is made. */
export interface PdfWriterOptions {
  version: string
  compress: boolean
  info: {
    Title?: string
    Author?: string
    Subject?: string
    Keywords?: string
    Creator: string
    Producer: string
    CreationDate: Date
  }
  language?: string
  /** `singlePage`, `oneColumn`, `twoColumnLeft`, …: written with a capital first letter. */
  pageLayout?: string
  /** The XMP packet of the metadata stream (`pdfa.ts`). */
  xmp?: string
  outputIntent?: OutputIntent
  attachments?: readonly WriterAttachment[]
  /** AES-256 with revision 6 (`protection.ts`): every string and stream is encrypted. */
  encryption?: ReturnType<typeof createEncryption>
  /** A tagged document's elements: marked content, tagged annotations, the structure tree. */
  structure?: StructurePlan
  /**
   * A document with form fields: `embedded` lists the field fonts of a
   * document that claims a conformance level, in first-use order; without it
   * fields draw in Helvetica.
   */
  form?: { embedded?: readonly FontProgram[] }
}

/** The 0x20 to 0x7E names first, by code unit; a name written in UTF-16BE sorts after them, as its bytes do. */
const nameOrder = (a: string, b: string): number => {
  const plain = (name: string) => /^[\x20-\x7E]*$/.test(name) ? 0 : 1
  return plain(a) - plain(b) || (a < b ? -1 : a > b ? 1 : 0)
}

export interface OwnPdfWriter extends PdfWriter {
  /** The file, once `end` has run. */
  file(): Uint8Array<ArrayBuffer>
}

export const createPdfWriter = (options: PdfWriterOptions): OwnPdfWriter => {
  const file = createPdfFile({ version: options.version, compress: options.compress, encrypt: options.encryption?.encrypt })
  const marked = options.structure === undefined ? undefined : createMarkedContent(options.structure)
  const pagesRef = file.reserve()
  const content = createPageContent(file, marked, pagesRef)
  const text = createText(file, content)
  const drawImage = createImages(file, content)
  const annotations = createAnnotations(file, content, marked)
  const outline = createOutline(file)
  const form = createForm(file, options.form, content, text, annotations)
  let result: Uint8Array<ArrayBuffer> | undefined

  return {
    addPage: content.addPage,
    ...content.operators,
    fillGradient: createGradients(file, content),
    glyphs: text.glyphs,
    image: (source, x, y, width, height, opacity) => {
      if (opacity !== undefined) content.graphicsState({ ca: clamp(opacity) })
      drawImage(source, x, y, { width, height })
    },
    inlineImage: (source, x, y, width, height) => drawImage(source, x, y, { fit: [width, height] }),
    label: text.label,
    beginMarked: (element, order, actualText) => marked?.beginMarked(element, order, actualText),
    beginArtifact: pagination => marked?.beginArtifact(pagination),
    endMarked: () => marked?.endMarked(),
    ...annotations.operators,
    toPage: (x, y) => pagePoint(content.ctm(), x, y),
    outline: ({ left, top, ...item }) => {
      const [x, y] = pagePoint(content.ctm(), left, top)
      outline.add({ ...item, x, y })
    },
    ...form.operators,
    end: () => {
      content.finishPage()
      text.finish()
      const acroForm = form.finish()
      const metadata = options.xmp === undefined ? undefined : writeMetadata(file, options.xmp)
      const outputIntent = options.outputIntent === undefined ? undefined : writeOutputIntent(file, options.outputIntent)
      const attachments = writeAttachments(file, options.attachments ?? [])
      const structTreeRoot = marked?.writeTree(file)
      const pageRefs = content.pages.map(page => page.ref)
      file.set({ Type: 'Pages', Count: pageRefs.length, Kids: pageRefs }, pagesRef)
      const outlines = outline.finish(content.pages)
      const { destinations } = annotations
      const names = [...destinations.keys()].sort(nameOrder)
      const { info } = options
      const infoRef = file.set({
        Title: info.Title === undefined ? undefined : new PdfText(info.Title),
        Author: info.Author === undefined ? undefined : new PdfText(info.Author),
        Subject: info.Subject === undefined ? undefined : new PdfText(info.Subject),
        Keywords: info.Keywords === undefined ? undefined : new PdfText(info.Keywords),
        Creator: new PdfText(info.Creator),
        Producer: new PdfText(info.Producer),
        CreationDate: new PdfDate(info.CreationDate),
      })
      const root = file.set({
        Type: 'Catalog',
        Pages: pagesRef,
        Lang: options.language === undefined ? undefined : new PdfText(options.language),
        PageLayout: options.pageLayout === undefined ? undefined : `${options.pageLayout.charAt(0).toUpperCase()}${options.pageLayout.slice(1)}`,
        ViewerPreferences: { DisplayDocTitle: true },
        Names: names.length === 0 && attachments.names.size === 0
          ? undefined
          : {
              Dests: names.length === 0 ? undefined : { Names: names.flatMap(name => [new PdfText(name), destinations.get(name)!]) },
              EmbeddedFiles: attachments.names.size === 0
                ? undefined
                : { Names: [...attachments.names.keys()].sort(nameOrder).flatMap(name => [new PdfText(name), attachments.names.get(name)!]) },
            },
        Outlines: outlines,
        PageMode: outlines === undefined ? undefined : 'UseOutlines',
        Extensions: options.encryption === undefined ? undefined : ENCRYPTION_EXTENSIONS,
        Metadata: metadata,
        OutputIntents: outputIntent === undefined ? undefined : [outputIntent],
        AF: attachments.specs.length === 0 ? undefined : attachments.specs,
        StructTreeRoot: structTreeRoot,
        MarkInfo: structTreeRoot === undefined ? undefined : { Marked: true },
        AcroForm: acroForm,
      })
      const encryption = options.encryption === undefined
        ? undefined
        : Object.fromEntries(Object.entries(options.encryption.dictionary).map(([key, value]) => [key, value instanceof Uint8Array ? new PdfBytes(value) : value]))
      result = file.finish(root, infoRef, encryption)
    },
    file: () => {
      if (result === undefined) throw new Error('Nuxt PDF read the file before the document ended.')
      return result
    },
  }
}
