import { readPdfColor } from '../../../shared/color'
import { pagePoint, pageRect, type PageContent } from './content'
import type { PdfFile } from './file'
import type { MarkedContent } from './marked-content'
import { PdfText, type PdfRef, type PdfValue } from './objects'
import type { PdfWriter, StructureElement } from './writer'

// Annotations in our writer: links, notes and the named destinations links
// lead to; in a tagged document each annotation with an element joins the
// structure tree. Form widgets are annotations
// too (`forms.ts`).

/** What a tagged annotation needs: its element, and for a link the text it carries. */
export interface AnnotationTag {
  element: StructureElement | undefined
  contents?: string
}

export interface Annotations {
  /**
   * An annotation of the current page. In a tagged document an annotation
   * with `tag` gets its parent tree key and becomes an object reference of
   * its element, a link with its element's text as `Contents`.
   */
  annotate(rect: number[], entries: Record<string, PdfValue | undefined>, tag?: AnnotationTag): PdfRef
  /** The named destinations, by name. */
  readonly destinations: ReadonlyMap<string, PdfValue>
  readonly operators: Pick<PdfWriter, 'linkToUri' | 'linkToDestination' | 'destination' | 'note'>
}

export const createAnnotations = (file: PdfFile, content: PageContent, marked: MarkedContent | undefined): Annotations => {
  const destinations = new Map<string, PdfValue>()

  const annotate = (rect: number[], entries: Record<string, PdfValue | undefined>, tag?: AnnotationTag): PdfRef => {
    const key = marked === undefined || tag === undefined ? undefined : marked.annotationKey(tag.element)
    const ref = file.set({
      Type: 'Annot',
      Rect: rect,
      Border: [0, 0, 0],
      ...entries,
      ...(key === undefined ? {} : { StructParent: key, Contents: tag?.contents === undefined ? entries.Contents : new PdfText(tag.contents) }),
    })
    const { annotations, ref: pageRef } = content.current()
    annotations.push(ref)
    if (key !== undefined) marked!.annotated(tag!.element!, pageRef, ref)
    return ref
  }

  /** A link's rectangle under the current matrix. */
  const link = (x: number, y: number, width: number, height: number, tag: { element: StructureElement | undefined, contents: string }, action: PdfValue): void => {
    // F 4: printed.
    annotate(pageRect(content.ctm(), x, y, width, height), { Subtype: 'Link', F: 4, A: action }, tag)
  }

  return {
    annotate,
    destinations,
    operators: {
      linkToUri: (x, y, width, height, uri, element) =>
        link(x, y, width, height, { element, contents: element?.link?.contents ?? uri }, { S: 'URI', URI: new PdfText(uri) }),
      linkToDestination: (x, y, width, height, name, element, printed) =>
        link(x, y, width, height, { element, contents: element?.link?.contents ?? printed ?? `#${name}` }, { S: 'GoTo', D: new PdfText(name) }),
      destination: (name, left, top) => {
        // The left edge stays the reader's (null), as pdfkit wrote it.
        destinations.set(name, [content.current().ref, 'XYZ', null, pagePoint(content.ctm(), left, top)[1], null])
      },
      note: (x, y, contents, color) => {
        // pdfkit's default note colour is a pale yellow.
        const rgb = color === undefined ? [243, 223, 92] : readPdfColor(color)?.rgb
        annotate(pageRect(content.ctm(), x, y, 0, 0), { Subtype: 'Text', Contents: new PdfText(contents), Name: 'Comment', C: rgb?.map(part => part / 255) })
      },
    },
  }
}
