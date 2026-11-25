// Development only: rebuild the registry when PDF files come or go, refresh
// the preview, and serve /_pdf.

import { isAbsolute, resolve as resolvePath } from 'node:path'
import { addPlugin, addServerHandler, addServerTemplate, logger, updateTemplates } from '@nuxt/kit'
import type { Nuxt } from '@nuxt/schema'
import { joinURL } from 'ufo'
import {
  classifyPdfWatchEvent,
  discoverPdfComponentFiles,
  discoverPdfTemplates,
  isPdfImageFile,
  type PdfTemplate,
  type PdfTemplateLayer,
} from './discover-templates'
import { generatePdfPreviewConfig } from './generate-registry'
import { projectPath } from './paths'

export interface PdfDevServerOptions {
  layers: readonly PdfTemplateLayer[]
  isIgnored: (path: string) => boolean
  /** The lists the registry reads. A rediscovery replaces their contents in place. */
  templates: PdfTemplate[]
  componentFiles: string[]
  /** Called after a rediscovery replaced the lists. */
  onFilesChanged: () => void
  /** The generated registry types, written again after a rediscovery. */
  registryTypesFilename: string
  previewHandler: string
  runtimeImport: string
  stubsPlugin: string
}

export function installPdfDevServer(nuxt: Nuxt, options: PdfDevServerOptions): void {
  const { layers, isIgnored, templates, componentFiles, runtimeImport } = options
  let clientViteServer: {
    ws: { send(payload: { data: object, event: string, type: 'custom' }): void }
  } | undefined

  nuxt.hook('vite:serverCreated', (viteServer, environment) => {
    if (environment.isClient) clientViteServer = viteServer
  })
  const refreshPreview = () => clientViteServer?.ws.send({
    type: 'custom',
    event: 'nuxt-pdf:update',
    data: {},
  })
  let reloadNitro: (() => Promise<void>) | undefined
  nuxt.hook('nitro:init', (nitro) => {
    // Refresh after the compiled registry is replaced, not at file-change time.
    nitro.hooks.hook('dev:reload', refreshPreview)
    reloadNitro = () => nitro.hooks.callHook('rollup:reload')
  })

  // A template or component file was added or removed. `#pdf` is a Nitro
  // virtual module that is generated again on every build, so new lists
  // and a Rollup rebuild (`rollup:reload`, what Nitro's own watcher calls
  // when a route file is added) replace a Nuxt restart. Events run one at
  // a time, so a rename (unlink + add) ends with the final file set.
  let rediscovery = Promise.resolve()
  const rediscoverPdfFiles = () => {
    rediscovery = rediscovery.then(async () => {
      try {
        const [nextTemplates, nextComponents] = await Promise.all([
          discoverPdfTemplates(layers, isIgnored),
          discoverPdfComponentFiles(layers, isIgnored),
        ])
        templates.splice(0, templates.length, ...nextTemplates)
        componentFiles.splice(0, componentFiles.length, ...nextComponents)
        options.onFilesChanged()
        await updateTemplates({ filter: template => template.filename === options.registryTypesFilename })
        await reloadNitro?.()
      }
      catch (error) {
        // A key collision, say. The previous registry stays until it is fixed.
        logger.error(`nuxt-pdf: could not update the PDF registry: ${error instanceof Error ? error.message : String(error)}`)
      }
    })
    return rediscovery
  }
  nuxt.hook('builder:watch', async (event, path) => {
    const absolutePath = isAbsolute(path)
      ? path
      : resolvePath(nuxt.options.srcDir, path)
    const action = classifyPdfWatchEvent(
      event,
      absolutePath,
      layers,
      isIgnored,
    )
    if (action === 'rediscover') {
      await rediscoverPdfFiles()
      return
    }
    if (action === 'restart') {
      // A restart wipes bundler state, so say why it is happening.
      logger.info(
        `nuxt-pdf: ${projectPath(nuxt.options.rootDir, absolutePath)} changed; restarting to rebuild the PDF registry…`,
      )
      await nuxt.callHook('restart')
      return
    }
    // Disk images need no compilation; template and helper edits wait for Nitro.
    if (action === 'refresh' && isPdfImageFile(absolutePath)) refreshPreview()
  })

  addServerTemplate({
    filename: '#pdf-preview-config',
    getContents: () => generatePdfPreviewConfig(templates, {
      baseURL: nuxt.options.app.baseURL,
      buildAssetsDir: nuxt.options.app.buildAssetsDir,
      rootDir: nuxt.options.rootDir,
      runtimeImport,
    }),
  })
  addServerHandler({ route: '/_pdf', handler: options.previewHandler })
  addServerHandler({ route: '/_pdf/**', handler: options.previewHandler })

  // Surface the existing /_pdf preview in Nuxt DevTools, mirroring the
  // iframe-tab pattern used by @nuxthub/core and vueuse.
  nuxt.hook('devtools:customTabs', (tabs) => {
    tabs.push({
      name: 'nuxt-pdf',
      title: 'PDF',
      icon: 'i-lucide-file-text',
      view: { type: 'iframe', src: joinURL(nuxt.options.app.baseURL || '/', '_pdf') },
    })
  })

  // Global Pdf* types make misuse outside pdfs/ typecheck; these stubs
  // turn the silent runtime failure into an immediate, actionable error.
  addPlugin(options.stubsPlugin)
}
