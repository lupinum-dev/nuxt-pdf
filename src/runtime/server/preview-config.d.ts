// The development-only virtual module that preview.ts reads. Nuxt generates it
// (src/module.ts, `generatePdfPreviewConfig` in build/generate-registry.ts).
// It holds `pdfPreview`, so `#pdf` needs no preview export and no declaration
// here: a declaration of `#pdf` would win over an application's generated
// registry types, which TypeScript also reads for this file through the typed
// Nitro routes.
declare module '#pdf-preview-config' {
  export const pdfPreview: Readonly<Record<string, import('./registry').PdfPreviewEntry<object>>>
  export const hmrClientPath: string
  export const openInEditorPath: string
  export const rootDir: string
}
