// pdf.js's worker, built as a playground worker so it lands in /_nuxt/playground/
// with the worker policy (nuxt.config.ts) instead of needing a page-wide change.
// The module starts listening to the page by itself when loaded in a worker.
import "pdfjs-dist/build/pdf.worker.mjs";
