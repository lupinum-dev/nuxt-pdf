import { PDF_PRIMITIVES } from '../primitives'
import type { PdfElementNode } from '../renderer'
import { parsePdfSourcePosition } from '../shared/errors'
import type { PdfRichTextWarning } from '../shared/template'

/**
 * The rich text warnings of a mounted document: the entries each `PdfRichText`
 * view holds, merged by code and name over the render, in the order the
 * render met them. The snippet of the content and the source come only with a
 * source position, which development builds write, so production diagnostics
 * stay content-free.
 */
export const collectRichTextWarnings = (document: PdfElementNode): PdfRichTextWarning[] => {
  const merged = new Map<string, PdfRichTextWarning>()
  const pending: PdfElementNode[] = [document]
  while (pending.length > 0) {
    const node = pending.pop()!
    const source = node.source === undefined ? undefined : parsePdfSourcePosition(node.source)
    for (const { code, name, message, snippet, count } of node.richTextWarnings ?? []) {
      const key = `${code} ${name}`
      const known = merged.get(key)
      merged.set(key, known !== undefined
        ? { ...known, count: known.count + count }
        : { code, name, message, count, ...(source === undefined ? {} : { snippet, source }) })
    }
    // Reversed onto the stack, so the walk visits the children in order.
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      const child = node.children[index]!
      if (child.type !== PDF_PRIMITIVES.TextInstance) pending.push(child)
    }
  }
  return [...merged.values()]
}
