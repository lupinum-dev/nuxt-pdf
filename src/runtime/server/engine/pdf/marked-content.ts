import { NuxtPdfError, PDF_ERROR_CODES } from '../../../shared/errors'
import type { StructurePlan, StructureSpec } from '../tagged'
import type { PdfFile } from './file'
import { PdfText, type PdfRef, type PdfValue } from './objects'

// The marked content and structure tree of a tagged document, as the writer
// keeps them (D37).
// The painter nests marked sequences (a leaf, an inline link in it, an
// inline image in that); the file has flat ones. So a sequence is opened
// lazily, right before its first operator, and the open one is closed then:
// an inner sequence splits its leaf into parts, and parts of one owner that
// touch are one part. Content outside every sequence is an artifact, one per
// gap between leaves. Each part gets the page's next MCID.

type Kid
  = | { readonly order: number, readonly kind: 'mcr', readonly page: PdfRef, readonly mcid: number }
    | { readonly order: number, readonly kind: 'objr', readonly page: PdfRef, readonly annotation: PdfRef }
    | { readonly order: number, readonly kind: 'element', readonly index: number }

/** A marked sequence: its owner (null for an artifact) within one leaf's span. */
interface Sequence {
  readonly owner: StructureSpec | null
  readonly pagination: boolean
  /** The leaf's span (or the gap) it belongs to; parts never merge across spans. */
  readonly span: object
  readonly order: number
  readonly actualText: string | undefined
}

const sameSequence = (a: Sequence, b: Sequence): boolean =>
  a.owner === b.owner && a.span === b.span && a.pagination === b.pagination

/** A PDF text string in hex: UTF-16BE with its byte order mark. */
const pdfTextHex = (text: string): string => {
  let hex = 'FEFF'
  for (let index = 0; index < text.length; index += 1) hex += text.charCodeAt(index).toString(16).toUpperCase().padStart(4, '0')
  return `<${hex}>`
}

const unexpectedAnnotation = (): never => {
  throw new NuxtPdfError(
    PDF_ERROR_CODES.RenderError,
    'Tagged PDF: the painter wrote an annotation without a structure element; check CONTRACTS.md "Tagged PDF".',
  )
}

const gap = (): Sequence => ({ owner: null, pagination: false, span: {}, order: 0, actualText: undefined })

/** Table cells keep their place even when empty, so every row has its columns. */
const KEPT_EMPTY: ReadonlySet<string> = new Set(['TH', 'TD'])

export const createMarkedContent = (plan: StructurePlan) => {
  const kids = new Map<number, Kid[]>()
  const placed = new Set<number>()
  // Parent tree key → the element of each MCID of a page, or the element of an annotation.
  const parentTree = new Map<number, number[] | number>()
  let nextKey = 0

  let stack: Sequence[] = []
  let between = gap()
  let open: Sequence | undefined
  let mcids: number[] = []
  let parts: { owner: StructureSpec, order: number, mcid: number }[] = []

  const kidsOf = (spec: StructureSpec): Kid[] => {
    let list = kids.get(spec.index)
    if (list === undefined) {
      list = []
      kids.set(spec.index, list)
    }
    return list
  }

  // An inline element takes its place among its parent's kids where its first
  // content is painted.
  const place = (spec: StructureSpec, order: number): void => {
    const parent = spec.parent
    if (!spec.inline || placed.has(spec.index) || parent === undefined) return
    place(parent, order)
    kidsOf(parent).push({ order, kind: 'element', index: spec.index })
    placed.add(spec.index)
  }

  const push = (owner: StructureSpec | null, pagination: boolean, order: number | undefined, actualText: string | undefined): void => {
    const outer = stack.at(-1)
    stack.push(outer === undefined
      ? { owner, pagination, span: {}, order: order ?? 0, actualText }
      : { owner, pagination, span: outer.span, order: outer.order, actualText: undefined })
  }

  return {
    beginMarked: (element: StructureSpec, order?: number, actualText?: string): void => push(element, false, order, actualText),
    beginArtifact: (pagination = false): void => push(null, pagination, undefined, undefined),
    endMarked: (): void => {
      stack.pop()
      if (stack.length === 0) between = gap()
    },

    /** The operators to write before the next content operator. */
    before: (): string[] => {
      const wanted = stack.at(-1) ?? between
      if (open !== undefined && sameSequence(open, wanted)) return []
      const lines = open === undefined ? [] : ['EMC']
      open = wanted
      if (wanted.owner === null) {
        lines.push(wanted.pagination ? '/Artifact <</Type /Pagination>> BDC' : '/Artifact BMC')
        return lines
      }
      const mcid = mcids.length
      mcids.push(wanted.owner.index)
      parts.push({ owner: wanted.owner, order: wanted.order, mcid })
      const actualText = wanted.actualText === undefined ? '' : ` /ActualText ${pdfTextHex(wanted.actualText)}`
      lines.push(`/${wanted.owner.role} <</MCID ${mcid}${actualText}>> BDC`)
      return lines
    },

    /** The parent tree key of an annotation of `element`; every annotation of a tagged document has one. */
    annotationKey: (element: StructureSpec | undefined): number => {
      if (element === undefined) return unexpectedAnnotation()
      const key = nextKey++
      parentTree.set(key, element.index)
      return key
    },
    /** Records a written annotation as an object reference of its element. */
    annotated: (element: StructureSpec, page: PdfRef, annotation: PdfRef): void => {
      kidsOf(element).push({ order: element.index, kind: 'objr', page, annotation })
    },

    /** Ends the page: the closing operators, and its parent tree key when it has marked content. */
    endPage: (page: PdfRef): { lines: string[], structParents: number | undefined } => {
      const lines = open === undefined ? [] : ['EMC']
      for (const part of parts) {
        place(part.owner, part.order)
        kidsOf(part.owner).push({ order: part.order, kind: 'mcr', page, mcid: part.mcid })
      }
      let structParents: number | undefined
      if (mcids.length > 0) {
        structParents = nextKey++
        parentTree.set(structParents, mcids)
      }
      stack = []
      between = gap()
      open = undefined
      mcids = []
      parts = []
      return { lines, structParents }
    },

    /**
     * Writes the structure tree as plain dictionaries: `Document` holds the
     * top-level elements in tree order (reading order). An element's kids are
     * its marked content, annotations and inline elements in paint order,
     * merged with its child elements by tree order; a note follows its
     * reference. Elements with nothing painted in them are left out. An
     * element with an `ID` is in the `IDTree` (PDF 32000-1, 14.7.2). Returns
     * the root.
     */
    writeTree: (file: PdfFile): PdfRef => {
      const ordered = [...plan.specs.values()].sort((a, b) => a.index - b.index)
      const kept = new Set<number>()
      const children = new Map<number, StructureSpec[]>()
      for (const spec of [...ordered].reverse()) {
        const painted = (kids.get(spec.index)?.length ?? 0) > 0
        if (painted || KEPT_EMPTY.has(spec.role) || (children.get(spec.index)?.length ?? 0) > 0) {
          kept.add(spec.index)
          const parent = spec.parent?.index ?? -1
          children.set(parent, [spec, ...(children.get(parent) ?? [])])
        }
      }

      const root = file.reserve()
      const document = file.reserve()
      const refs = new Map<number, PdfRef>()
      const elements = new Map<number, Record<string, PdfValue>>()
      for (const spec of ordered) {
        if (!kept.has(spec.index)) continue
        const colSpan = plan.colSpans.get(spec.index)
        const attributes = {
          ...(spec.scope === undefined ? {} : { Scope: spec.scope }),
          ...(spec.rowSpan === undefined ? {} : { RowSpan: spec.rowSpan }),
          ...(colSpan === undefined ? {} : { ColSpan: colSpan }),
        }
        refs.set(spec.index, file.reserve())
        elements.set(spec.index, {
          Type: 'StructElem',
          S: spec.role,
          P: spec.parent === undefined ? document : refs.get(spec.parent.index)!,
          ...(spec.id === undefined ? {} : { ID: new PdfText(spec.id) }),
          ...(spec.alt === undefined ? {} : { Alt: new PdfText(spec.alt) }),
          ...(Object.keys(attributes).length === 0 ? {} : { A: { O: 'Table', ...attributes } }),
        })
      }

      // A note whose reference is kept goes right after it; both have the same parent.
      const notes = new Map<number, number[]>()
      for (const spec of ordered) {
        const reference = spec.follows
        if (reference !== undefined && kept.has(spec.index) && kept.has(reference.index)) {
          notes.set(reference.index, [...(notes.get(reference.index) ?? []), spec.index])
        }
      }
      const following = new Set([...notes.values()].flat())

      const kidsData = (index: number): PdfValue[] => {
        const painted = kids.get(index) ?? []
        const inline = new Set(painted.flatMap(kid => kid.kind === 'element' ? [kid.index] : []))
        const structural: Kid[] = (children.get(index) ?? [])
          .filter(child => !inline.has(child.index))
          .map(child => ({ order: child.index, kind: 'element', index: child.index }))
        // Stable: paint order holds within one order key.
        return [...painted, ...structural]
          .sort((a, b) => a.order - b.order)
          .flatMap((kid): Kid[] => {
            if (kid.kind !== 'element') return [kid]
            if (following.has(kid.index)) return []
            return [kid, ...(notes.get(kid.index) ?? []).map((note): Kid => ({ order: kid.order, kind: 'element', index: note }))]
          })
          .map((kid) => {
            if (kid.kind === 'mcr') return { Type: 'MCR', Pg: kid.page, MCID: kid.mcid }
            if (kid.kind === 'objr') return { Type: 'OBJR', Pg: kid.page, Obj: kid.annotation }
            return refs.get(kid.index)!
          })
      }

      for (const [index, ref] of refs) file.set({ ...elements.get(index)!, K: kidsData(index) }, ref)
      file.set({ Type: 'StructElem', S: 'Document', P: root, K: kidsData(-1) }, document)
      const ids = ordered.flatMap(spec => spec.id !== undefined && kept.has(spec.index) ? [{ id: spec.id, ref: refs.get(spec.index)! }] : [])
        .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      return file.set({
        Type: 'StructTreeRoot',
        K: document,
        ...(ids.length === 0 ? {} : { IDTree: { Names: ids.flatMap(({ id, ref }) => [new PdfText(id), ref]) } }),
        ParentTree: {
          Nums: [...parentTree.entries()]
            .sort(([a], [b]) => a - b)
            .flatMap(([key, value]) => [key, Array.isArray(value) ? value.map(index => refs.get(index)!) : refs.get(value)!]),
        },
        ParentTreeNextKey: parentTree.size,
      }, root)
    },
  }
}

export type MarkedContent = ReturnType<typeof createMarkedContent>
