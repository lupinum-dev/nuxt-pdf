import { defineBuildConfig } from 'unbuild'

// `@nuxt/module-builder` supplies the module + runtime entries; unbuild
// concatenates these with the public test, build, and server entries.
// `pdfjs-dist` and `@napi-rs/canvas`
// are optional peer dependencies loaded lazily at runtime — keep them external
// so they are never bundled into the shipped code.
export default defineBuildConfig({
  entries: [
    { input: 'src/test/index', name: 'test' },
    { input: 'src/build/index', name: 'build' },
    { input: 'src/server', name: 'server' },
  ],
  externals: [
    '@napi-rs/canvas',
    'pdfjs-dist',
    'pdfjs-dist/legacy/build/pdf.mjs',
  ],
})
