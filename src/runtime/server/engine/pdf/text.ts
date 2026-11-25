import { standardFont } from '../standard-fonts'
import type { PageContent } from './content'
import type { PdfFile } from './file'
import { createEmbeddedFonts, embeddable } from './fonts'
import { formatNumber as n, type PdfRef } from './objects'
import type { GlyphRun } from './writer'

// Text in our writer: the standard 14 fonts and the embedded fonts as page
// resources, glyph runs as text objects, and the debug overlay's label.

/**
 * Helvetica's metrics from its AFM (Ascender 718, Descender -207, FontBBox
 * height 1156), as pdfkit read them, its line height with the gap: for field
 * appearances and the debug label.
 */
export const HELVETICA = { ascender: 718, descender: -207, lineHeight: 1.156 }

/** The two standard fonts with their own built-in encoding. */
const SYMBOLIC = new Set(['Symbol', 'ZapfDingbats'])

export interface TextWriter {
  /** A standard font's object and resource name, one per document. */
  standardFontEntry(baseFont: string): { name: string, ref: PdfRef }
  glyphs(run: GlyphRun): void
  label(text: string, x: number, y: number, size: number): void
  /** Writes the embedded fonts' subsets. */
  finish(): void
}

export const createText = (file: PdfFile, content: PageContent): TextWriter => {
  const { current, write } = content
  // One object per font, shared by the pages that use it; standard and
  // embedded fonts share one sequence of resource names.
  const fonts = new Map<string, { name: string, ref: PdfRef }>()
  const embedded = createEmbeddedFonts(file)
  const resourceNames = new Map<PdfRef, string>()

  const standardFontEntry = (baseFont: string): { name: string, ref: PdfRef } => {
    let entry = fonts.get(baseFont)
    if (entry === undefined) {
      const ref = file.set({ Type: 'Font', Subtype: 'Type1', BaseFont: baseFont, ...(SYMBOLIC.has(baseFont) ? {} : { Encoding: 'WinAnsiEncoding' }) })
      entry = { name: `F${resourceNames.size + 1}`, ref }
      resourceNames.set(ref, entry.name)
      fonts.set(baseFont, entry)
    }
    return entry
  }

  /** The font's resource name on the current page and the code of each glyph. */
  const fontResource = (run: GlyphRun): { name: string, codes: string[] } => {
    const { font } = run
    if (font.type !== 'STANDARD') {
      const { ref, encode } = embedded.use(embeddable(font))
      let name = resourceNames.get(ref)
      if (name === undefined) {
        name = `F${resourceNames.size + 1}`
        resourceNames.set(ref, name)
      }
      current().fonts.set(name, ref)
      return { name, codes: run.glyphs.map(encode) }
    }
    const entry = standardFontEntry(font.fullName)
    current().fonts.set(entry.name, entry.ref)
    // A standard font names a glyph by its WinAnsi code.
    return { name: entry.name, codes: run.glyphs.map(glyph => glyph.id.toString(16).padStart(2, '0').slice(-2)) }
  }

  let fontSize = 12
  /**
   * A run in text space: each glyph's code, and a `TJ` adjustment wherever
   * its advance differs from its width; a glyph with an offset gets its own
   * text position. The text operators use PDF space, so the run flips back.
   */
  const glyphs = (run: GlyphRun): void => {
    const { name: resource, codes } = fontResource(run)
    if (run.size !== undefined) fontSize = run.size
    const { height } = current()
    const scale = 1000 / fontSize
    const widthScale = 1000 / (run.font.unitsPerEm || 1000)
    const textScale = fontSize / 1000
    const adjusted = run.positions.map((position, index) => ({
      xAdvance: position.xAdvance * scale,
      // Shaping gives offsets in points, like the advances (shape.ts).
      xOffset: position.xOffset * scale,
      yOffset: position.yOffset * scale,
      advanceWidth: run.glyphs[index]!.advanceWidth * widthScale,
    }))
    write('q')
    write(`1 0 0 -1 0 ${n(height)} cm`)
    write('BT')
    let x = 0
    write(`1 0 0 1 0 ${n(height)} Tm`)
    write(`/${resource} ${n(fontSize)} Tf`)
    const segments: string[] = []
    let last = 0
    const segment = (end: number): void => {
      if (last < end) segments.push(`<${codes.slice(last, end).join('')}> ${n(-(adjusted[end - 1]!.xAdvance - adjusted[end - 1]!.advanceWidth))}`)
      last = end
    }
    const flush = (end: number): void => {
      segment(end)
      if (segments.length === 0) return
      write(`[${segments.join(' ')}] TJ`)
      segments.length = 0
    }
    let offset = false
    let index = 0
    for (; index < adjusted.length; index += 1) {
      const position = adjusted[index]!
      if (position.xOffset || position.yOffset) {
        flush(index)
        write(`1 0 0 1 ${n(x + position.xOffset * textScale)} ${n(height + position.yOffset * textScale)} Tm`)
        flush(index + 1)
        offset = true
      }
      else {
        if (offset) {
          write(`1 0 0 1 ${n(x)} ${n(height)} Tm`)
          offset = false
        }
        if (position.xAdvance - position.advanceWidth !== 0) segment(index + 1)
      }
      x += position.xAdvance * textScale
    }
    flush(index)
    write('ET')
    write('Q')
  }

  /**
   * pdfkit's `text(text, x, y)` on one line, always in Helvetica (pdfkit took
   * its current font): the baseline one ascender below `y`. The label is a
   * size such as `120 x 40`, and Helvetica kerns no pair of digits, space and
   * `x`, so one string needs no adjustment. The size stays for a later run
   * without one.
   */
  const label = (text: string, x: number, y: number, size: number): void => {
    const entry = standardFontEntry('Helvetica')
    current().fonts.set(entry.name, entry.ref)
    fontSize = size
    const [codes] = standardFont('Helvetica').encode(text)
    const { height } = current()
    write('q')
    write(`1 0 0 -1 0 ${n(height)} cm`)
    write('BT')
    write(`1 0 0 1 ${n(x)} ${n(height - y - HELVETICA.ascender / 1000 * size)} Tm`)
    write(`/${entry.name} ${n(size)} Tf`)
    write(`[<${codes.map(code => code.padStart(2, '0')).join('')}> 0] TJ`)
    write('ET')
    write('Q')
  }

  return { standardFontEntry, glyphs, label, finish: () => embedded.finish() }
}
