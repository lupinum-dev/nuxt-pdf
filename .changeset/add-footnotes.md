---
'@lupinum/nuxt-pdf': minor
---

Add footnotes with `PdfFootnote` and in rich text

A `PdfFootnote` inside a `PdfText` marks its place with a number, and its content is the note. `PdfDocument` takes `footnotes: 'document' | 'page'` for the numbering and `footnoteStyles: { mark, note, area, rule }` for the styles of every footnote (`rule: false` for no line over the notes). The number in front of each note links back to its mark. On a page with column containers, the note area spans the content width below all columns, with the notes of every column in reading order; a column container that ends on the page is balanced above the notes, and when its notes leave too little room, it continues on the next page and is balanced there.

Rich text maps Markdown footnotes (`[^1]` and `[^1]: The note.`), the footnote markup of Markdown renderers in HTML, and the new model inline `PdfRichFootnote`. `PdfRichInline` now includes `PdfRichFootnote`, so code that switches over every inline type needs a branch for it. A Markdown reference without a definition, a note with more than one paragraph or with no text, and a definition line inside a fenced code block fail with `PDF_RICH_TEXT_INVALID`.

In a PDF/UA-1 or PDF/A-3a document the mark is a `Reference` with its `Link`, and the note is a `Note` with an `ID` right after it, which holds a `Lbl` with the link back and the note text; a footnote in a decorative node or inside a figure fails there with `PDF_TREE_INVALID`. An `id` that starts with `__nuxtPdfFootnote-`, which the notes and their marks use, fails with `PDF_TREE_INVALID`.
