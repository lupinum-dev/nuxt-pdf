---
'@lupinum/nuxt-pdf': minor
---

Change `pdf.limits` to seven options, fail module setup on an unknown key, and check the range of every time limit

The options of `pdf.limits` are `timeoutMs`, `maxPages`, `maxNodes`, `maxTotalImageBytes`, `maxTotalImagePixels`, `maxRemoteRequests` and the new `maxTotalAttachmentBytes`; `markdownTimeoutMs` is the time limit of Markdown parsing. Each removed key fails module setup with a message that says what to set instead. Remote requests run at most four at a time.

An unknown key in the `pdf` options fails module setup with a `TypeError` that names the key and the known keys `fonts`, `limits` and `remote`. An unknown key named like an object member, such as `toString`, fails like any other.

`pdf.limits.timeoutMs`, `pdf.limits.markdownTimeoutMs`, `pdf.remote.timeoutMs` and the `timeoutMs` of `parseRichTextMarkdown` must be whole numbers from 1 to 2,147,483,647 ms, the longest wait a Node timer allows. A larger render limit used to fail every render after 1 ms; a larger `pdf.remote.timeoutMs` used to work, because the render time bounds each request. The other `pdf.limits` fields keep their range (1 to `Number.MAX_SAFE_INTEGER`). Every limit error names the option and the allowed range, and the time limit error always names `pdf.limits.timeoutMs`.

Migration: `pdf.limits` has no per-image caps any more. Remove `maxImageBytes` and `maxImagePixels`; `maxTotalImageBytes` (default 32 MiB) and `maxTotalImagePixels` (default 100,000,000) keep their meaning, the budget for all images of one render, so keep them or set them to the budget of a whole document. Remove `maxTreeDepth`, `maxTextCharacters`, `maxImages`, `maxRemoteConcurrency` and `maxOutputBytes`.

Migration: correct or remove the unknown key in `pdf` that the error names.

Migration: set each time limit to 2,147,483,647 or less. The render time limit bounds remote requests anyway, so `pdf.remote.timeoutMs` never needs to be larger than `pdf.limits.timeoutMs`.
