---
'@lupinum/nuxt-pdf': minor
---

Add `PdfAttachment` to embed files in a PDF.

The file content comes from a string or a `Uint8Array`, never from a path or URL. New exported types: `PdfAttachmentProps` and `PdfAttachmentRelationship`.

The new `pdf.limits.maxTotalAttachmentBytes` option caps the total attachment bytes of one render (default 32 MiB). `getPdfAttachments` and the type `ParsedPdfAttachment` from `@lupinum/nuxt-pdf/test` read the attachments of a rendered PDF.
