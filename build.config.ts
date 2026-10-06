import { defineBuildConfig } from 'unbuild'

// `pnpm build` writes dist/agent/ (the packaged docs) after the module build, so the module
// builder cannot see the `./agent-docs` export yet. Drop exactly that warning; every other
// warning still fails the build.
const agentDocsOnly = /^Potential missing package\.json files: dist\/agent\/AGENTS\.md$/

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
  hooks: {
    'build:done'(ctx) {
      for (const warning of ctx.warnings) {
        // eslint-disable-next-line no-control-regex -- strip terminal colors from the message
        if (agentDocsOnly.test(warning.replace(/\u001B\[[0-9;]*m/g, ''))) ctx.warnings.delete(warning)
      }
    },
  },
})
