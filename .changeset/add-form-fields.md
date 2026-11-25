---
'@lupinum/nuxt-pdf': minor
---

Add fillable form fields: `PdfTextField`, `PdfCheckbox`, `PdfSelect` and `PdfRadio` write AcroForm fields that a reader fills in and saves

Nuxt PDF draws each field itself, so a field looks the same in every reader: the style sets `fontSize`, `color`, `textAlign`, `padding`, the border and the background, and field colors have no alpha. Fields need a `width` and `height` and unique names. `PdfRadio` options with the same `name` form one field and the reader keeps at most one option on; each option has its own `value`, `label` and place in the layout, also on another page. Fields draw in Helvetica with WinAnsi characters. In a PDF/A or PDF/UA-1 document a field draws its value in its registered TrueType font, embedded whole (set `fontFamily` on the page or the field); a field without a registered font, a font with CFF outlines, or a value with a character the font lacks fails with `PDF_TREE_INVALID`. In a tagged document (PDF/UA-1, PDF/A-3a) each field is a `Form` element in reading order and needs a `label` (each radio option its own). Two checked radio options, a value used twice, `readOnly` or `required` on some options only, a radio that shares its name with another field, and a `PdfFacturX` invoice with fields fail with `PDF_TREE_INVALID`.
