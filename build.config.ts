import { defineBuildConfig } from 'unbuild'

// `@nuxt/module-builder` supplies the module + runtime entries; unbuild
// concatenates these, so this only adds the public `@lupinum/nuxt-pdf/test`
// entry (bundled from `src/test/`). `pdfjs-dist` and `@napi-rs/canvas`
// are optional peer dependencies loaded lazily at runtime — keep them external
// so they are never bundled into the shipped code.
export default defineBuildConfig({
  entries: [
    { input: 'src/test/index', name: 'test' },
  ],
  externals: [
    '@napi-rs/canvas',
    'pdfjs-dist',
    'pdfjs-dist/legacy/build/pdf.mjs',
  ],
})
