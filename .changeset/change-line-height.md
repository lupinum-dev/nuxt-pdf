---
'@lupinum/nuxt-pdf': minor
---

Change `lineHeight` to work as in CSS: a unitless value is a factor of each text's own font size, and the extra space goes half above and half below the glyphs

Before, a unitless `lineHeight` became points where it was set, from that element's own `fontSize` or 18 pt when it had none, and its children inherited those points. A `lineHeight: 1.4` on a page made 25.2 pt lines for 10 pt body text and too tight lines for a larger heading. Now each text multiplies the factor by its own font size. A `lineHeight: '150%'` on an element without its own `fontSize` gave 27 pt lines whatever size it inherited; it now gives 1.5 times the inherited size, and children inherit those points. A length still sets points where it is written.

Before, all space that a line height adds to the font's glyph height was below the glyphs, so text sat high in its line, and a line height below the font's ascent drew the glyphs below their line (CJK and Arabic text with `lineHeight: 1`). The background of a nested `PdfText` now covers its glyph height, not the whole line. This half of the change moves no line or page break.

Migration: text under an ancestor with a unitless `lineHeight` and no `fontSize` of its own gets tighter lines, and larger text inside gets more space, so pages can break differently. To keep a fixed line height, write it in points (`lineHeight: '14pt'`) or set it on each text.

Migration: text with a `lineHeight` moves down by half the extra space in each line (4.5 pt for 10 pt Helvetica with `lineHeight: 2`), or up when the line height is below the glyph height. Check text in boxes with a set height, and add a top padding where text must sit lower.
