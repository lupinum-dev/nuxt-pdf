---
'@lupinum/nuxt-pdf': minor
---

Change text to use only the fonts its `fontFamily` names and each font weight to need a registered face, and add the layout warning `PDF_GLYPH_MISSING`

A character that the fonts of its text lack now shows as the `.notdef` glyph of the text's font, copies as U+FFFD and gives `PDF_GLYPH_MISSING` once per character, with its first page, code point and font family. Before, it was painted in Helvetica, and a character outside the BMP was split in two. Under a PDF/A or PDF/UA claim the render fails with `PDF_TREE_INVALID`, because both standards forbid that glyph. An emoji is drawn from the font that has it. A space, a tab, a bidi control character and other characters that draw nothing paint no glyph when the font lacks them, so they no longer fail a PDF/A or Factur-X render and bidi controls no longer show as visible marks such as "."; such a space keeps its width of 0.278 em. A letter with a combining mark that the font lacks shows the font's precomposed letter, such as "Å" for "A" and U+030A, and every line separator, paragraph separator and word joiner that the font lacks is removed.

A font weight without a registered face now fails with `PDF_LAYOUT_ERROR`, as a missing style already did; the message names the node and lists the faces. Before, the closest registered weight painted the text, so `bold` with only a regular face registered printed regular text. A variable font paints each weight inside its `wght` axis at that weight, so one registration serves every weight on the axis; a weight outside the axis fails, and a variable font registered without `fontWeight` paints at 400. A CFF2 variable font (the usual `.otf` variable file) fails at build time with a `TypeError`; register the font's `.ttf` variable file, or one static `.otf` file per weight.

Font fixes:

- Font errors name the cause and the fix. A family that is not registered says to register it in `pdf.fonts` in `nuxt.config.ts`. A family without the asked style names the node, its source position and the faces the family has. When fonts are declared and `pdfs/fonts` does not exist, the module and `buildPdfRegistry` name the directory to create, and `buildPdfRegistry` skips a missing `pdfs/fonts` as the module does for a layer without one.
- A `.ttf` or `.otf` file shorter than its 12-byte header fails with "Invalid PDF font" and the file name, and a font whose character map names glyphs that it does not have fails the build with the file name, the character and the glyph.
- Text in a TrueType WOFF2 font is no longer invisible and no longer fails the render: Nuxt PDF decodes WOFF2 to TTF or OTF before it embeds the font. A WOFF2 file that is truncated, inconsistent or decodes to more than 20 MB fails with `PDF_ASSET_INVALID` at render time and with a `TypeError` that names the file at build time.
- Letters no longer go missing when one server process renders several PDFs with the same embedded font ("Own" printed as "wn"): each render uses its own font store.
- The ellipsis of a truncated text no longer copies as another character, such as a hyphen, when the font has no ellipsis.

Migration: if a text relied on Helvetica for characters its registered font lacks, register a font that contains them and use it in `fontFamily`, or set those characters in a nested text with their own font.

Migration: register a face for each weight your templates ask for, including 700 for rich text `strong` and headings, or change `fontWeight` to a registered weight.
