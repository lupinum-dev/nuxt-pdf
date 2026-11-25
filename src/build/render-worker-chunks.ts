// Nitro bundling of the render worker: its own chunk and its real URL.

import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { logger } from '@nuxt/kit'
import type { Nuxt } from '@nuxt/schema'
import { forwardSlashes } from '../runtime/shared/paths'

export function installRenderWorkerChunks(nuxt: Nuxt, runtimeSourceDir: string): void {
  // The render worker starts from the module that holds `worker-entry`
  // (internals/decisions.md, "Render worker"). Two Nitro behaviors need help:
  //
  // - Rollup would merge the engine into a route chunk, so the worker would
  //   also load Vue and the Nitro server. Group the Vue-free worker graph in
  //   one chunk.
  // - Nitro replaces `import.meta.url` with a global that names the server
  //   entry. Give `worker-entry` its real URL back: its own chunk, the file on
  //   disk in development, or none when a production preset inlines dynamic
  //   imports (there is no separate chunk to start; PDFs render in-process).
  const runtimeDir = realpathSync(runtimeSourceDir)
  const workerGraph = [
    'server/engine/',
    'server/render-limits.',
    'authoring.',
    'shared/errors.',
    'fonts.',
    // The Markdown parse (rich-text/markdown-parse.ts) and the mapping it uses.
    'rich-text/',
    'shared/describe-value.',
  ].map(path => forwardSlashes(`${runtimeDir}/${path}`))
  const workerEntry = forwardSlashes(`${runtimeDir}/server/engine/worker-entry.`)
  nuxt.hook('nitro:init', (nitro) => {
    nitro.hooks.hook('rollup:before', (_nitro, config) => {
      const output = Array.isArray(config.output) ? config.output[0] : config.output
      if (!output) return
      const inlined = output.inlineDynamicImports === true
      if (inlined && !nuxt.options.dev) {
        logger.warn(
          'nuxt-pdf: this Nitro preset bundles the server into one file, so PDFs render in-process. '
          + 'The render deadline is then checked between engine stages and once per page, and cannot stop one long layout step.',
        )
      }
      if (!inlined) {
        const previous = output.manualChunks
        type ManualChunk = Extract<typeof previous, (...args: never[]) => unknown>
        output.manualChunks = (id: string, meta: Parameters<ManualChunk>[1]) => {
          const path = forwardSlashes(id)
          if (workerGraph.some(prefix => path.startsWith(prefix))) {
            return 'nuxt-pdf-render-worker'
          }
          return typeof previous === 'function' ? previous(id, meta) : undefined
        }
      }
      // Nitro's replace plugin rewrites `import.meta` in `transform` and
      // again in `renderChunk`, so the separate chunk gets its URL back at
      // `renderChunk` (this plugin runs after Nitro's). An inlined build has
      // no separate chunk: the module gets a fixed value at `transform`.
      const plugins = Array.isArray(config.plugins) ? config.plugins : []
      config.plugins = [...plugins, {
        name: 'nuxt-pdf:render-worker-url',
        transform(code: string, id: string) {
          if (!inlined || !forwardSlashes(id).startsWith(workerEntry)) return null
          const url = nuxt.options.dev ? JSON.stringify(pathToFileURL(id).href) : 'undefined'
          return { code: code.replaceAll('globalThis._importMeta_.url', url), map: null }
        },
        renderChunk(code: string, chunk: { name: string }) {
          if (inlined || chunk.name !== 'nuxt-pdf-render-worker') return null
          return { code: code.replaceAll('globalThis._importMeta_.url', 'import.meta.url'), map: null }
        },
      }]
    })
  })
}
