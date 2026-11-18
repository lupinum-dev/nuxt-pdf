---
'@lupinum/nuxt-pdf': minor
---

Add fillable form fields: `PdfTextField`, `PdfCheckbox` and `PdfSelect` write AcroForm fields that a reader fills in and saves

Nuxt PDF draws each field itself, in Helvetica, so a field looks the same in every reader: the style sets `fontSize`, `color`, `textAlign`, `padding`, the border and the background. Values and options use WinAnsi characters. Fields need a `width` and `height`, unique names, and a document without a PDF/A or tagged level; otherwise the render fails with `PDF_TREE_INVALID`.
