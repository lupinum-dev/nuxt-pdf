import { stat } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve as resolvePath } from 'node:path'
import { pathToFileURL } from 'node:url'
import { version as moduleVersion } from '../package.json'
import {
  addImports,
  addPlugin,
  addServerHandler,
  addServerTemplate,
  addTemplate,
  addTypeTemplate,
  createIsIgnored,
  createResolver,
  defineNuxtModule,
  getLayerDirectories,
  logger,
  updateTemplates,
} from '@nuxt/kit'
import { joinURL } from 'ufo'
import {
  discoverPdfComponentFiles,
  discoverPdfImageFiles,
  discoverPdfTemplates,
  classifyPdfWatchEvent,
  type PdfTemplateLayer,
} from './build/discover-templates'
import { bundlePdfFonts } from './build/fonts'
import { preparePdfImageAssets } from './build/image-assets'
import { generateAuthoringTypes } from './build/generate-authoring-types'
import {
  generatePdfPreviewConfig,
  generatePdfRegistryTypes,
  generatePdfRuntimeRegistry,
} from './build/generate-registry'
import { createPdfSfcPlugin } from './build/pdf-sfc-plugin'
import {
  normalizeRemoteAssetPolicy,
  type RemoteAssetOptions,
} from './runtime/server/assets/remote'
import {
  DEFAULT_PDF_RENDER_LIMITS,
  normalizePdfLimits,
  type PdfLimitsOptions,
} from './runtime/server/render-limits'
import type { PdfFontDeclaration } from './runtime/fonts'

export type {
  PdfFontDeclaration,
  PdfFontStyle,
  PdfFontWeight,
  PdfFontWeightName,
} from './runtime/fonts'

export type { PdfLimitsOptions } from './runtime/server/render-limits'

export type { PdfSourcePosition } from './runtime/shared/errors'

export type { PdfLayoutWarning } from './runtime/shared/template'

export type { RemoteAssetOptions } from './runtime/server/assets/remote'

export type {
  PdfLength,
  PdfLengthOrPercentage,
  PdfPercentage,
  PdfStyle,
  PdfStyleEntry,
  PdfStyleValue,
} from './runtime/authoring'

export type {
  PdfTableCellProps,
  PdfTableColumn,
  PdfTableHeaderProps,
  PdfTableProps,
  PdfTableRowProps,
} from './runtime/components/table'

export type {
  PdfAttachmentProps,
  PdfAttachmentRelationship,
  PdfBaseProps,
  PdfBookmark,
  PdfCheckboxProps,
  PdfCircleProps,
  PdfClipPathProps,
  PdfConformance,
  PdfDefsProps,
  PdfDocumentProps,
  PdfFixedPages,
  PdfEllipseProps,
  PdfFacturXProfile,
  PdfFacturXProps,
  PdfFacturXRelationship,
  PdfGProps,
  PdfImageProps,
  PdfImageSource,
  PdfLinearGradientProps,
  PdfLineProps,
  PdfLinkProps,
  PdfNoteProps,
  PdfPageCountProps,
  PdfPageDimension,
  PdfPageNumberProps,
  PdfPageProps,
  PdfPageRefProps,
  PdfPageSize,
  PdfPageSizeName,
  PdfPageUnit,
  PdfPathProps,
  PdfPermissions,
  PdfPolygonProps,
  PdfPolylineProps,
  PdfPrintingPermission,
  PdfProtection,
  PdfRadialGradientProps,
  PdfRectProps,
  PdfSelectProps,
  PdfStopProps,
  PdfSvgLength,
  PdfSvgNumber,
  PdfSvgTransform,
  PdfSvgTransformOperation,
  PdfSvgPresentationProps,
  PdfSvgProps,
  PdfTextFieldProps,
  PdfTextProps,
  PdfTextTag,
  PdfTspanProps,
  PdfViewProps,
  PdfViewTag,
} from './runtime/primitives'
export type {
  DecimalInput,
  EInvoice,
  EInvoiceAddress,
  EInvoiceBuyer,
  EInvoiceContact,
  EInvoiceDelivery,
  EInvoiceDocumentAllowanceCharge,
  EInvoiceDocumentType,
  EInvoiceElectronicAddress,
  EInvoiceIssue,
  EInvoiceLine,
  EInvoiceLineAllowanceCharge,
  EInvoiceLineTotals,
  EInvoicePayment,
  EInvoicePaymentMeans,
  EInvoicePeriod,
  EInvoicePrecedingInvoice,
  EInvoiceProfile,
  EInvoiceSeller,
  EInvoiceTotals,
  EInvoiceUnit,
  EInvoiceUnitName,
  EInvoiceVat,
  EInvoiceVatBreakdown,
  EInvoiceVatCategory,
  RenderEInvoiceXmlOptions,
  ValidateEInvoiceOptions,
} from './runtime/einvoice'
export type { PdfInvoiceIssue } from './runtime/shared/errors'

export interface ModuleOptions {
  fonts?: readonly PdfFontDeclaration[]
  remote?: RemoteAssetOptions
  /**
   * Canonical render, tree, image, remote-request, and output budgets. Every
   * field is an optional positive safe integer; omitted fields use the
   * documented built-in defaults.
   */
  limits?: PdfLimitsOptions
}

const existingDirectories = async (directories: readonly string[]) => {
  const result: string[] = []

  for (const directory of directories) {
    try {
      if ((await stat(directory)).isDirectory()) result.push(directory)
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  return result
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: '@lupinum/nuxt-pdf',
    version: moduleVersion,
    configKey: 'pdf',
    docs: 'https://nuxt-pdf.lupinum.com',
    compatibility: {
      nuxt: '>=4.4.8',
    },
  },
  defaults: {
    fonts: [],
  },
  async setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)
    const runtimeImport = resolver.resolve('./runtime/server/index')
    const sharedImport = resolver.resolve('./runtime/shared/index')
    const componentsImport = resolver.resolve('./runtime/components/index')
    const definePdfImport = resolver.resolve('./runtime/define-pdf')
    const einvoiceImport = resolver.resolve('./runtime/einvoice/index')
    const previewHandler = resolver.resolve('./runtime/server/preview')
    const layers: PdfTemplateLayer[] = getLayerDirectories(nuxt).map(
      (directories, index) => ({
        rootDir: directories.root,
        name: index === 0 ? 'project' : `layer-${index}`,
      }),
    )
    const isIgnored = createIsIgnored(nuxt)
    // Development replaces the contents of both in place when a template or
    // component file is added or removed (see `rediscoverPdfFiles` below).
    const templates = await discoverPdfTemplates(layers, isIgnored)
    const componentFiles = await discoverPdfComponentFiles(layers, isIgnored)
    const limits = normalizePdfLimits(options.limits)
    const resolvedLimits = limits ?? DEFAULT_PDF_RENDER_LIMITS
    const imageFiles = await discoverPdfImageFiles(layers, isIgnored)
    // Development entries point at the source file so edits render without a
    // restart. Production embeds validated base64 bytes so every Nitro output
    // stays self-contained; validation here fails the build on bad assets.
    const assetEntries = await preparePdfImageAssets(imageFiles, resolvedLimits, nuxt.options.dev)
    const fontRoots = await existingDirectories(
      layers.map(layer => join(layer.rootDir, 'pdfs', 'fonts')),
    )
    const remote = normalizeRemoteAssetPolicy(options.remote)
    const fonts = await bundlePdfFonts(options.fonts ?? [], { fontRoots })
    const pdfSfcFiles = new Map<string, 'component' | 'template'>()
    const indexPdfSfcFiles = () => {
      pdfSfcFiles.clear()
      for (const file of componentFiles) pdfSfcFiles.set(file, 'component')
      for (const template of templates) pdfSfcFiles.set(template.filePath, 'template')
    }
    indexPdfSfcFiles()

    // With the `app/` layout, Nuxt's watcher covers `app/` and `server/` only;
    // this entry makes it report files in `pdfs/` too. Nuxt restarts when an event path equals the
    // entry, which is an event for the folder itself: `pdfs/` deleted or
    // created as a whole (`rm -rf`, a git checkout to or from a branch without
    // it). A restart is right there, because `fonts/` and `assets/` go with
    // the folder and both are read once at setup. Editors that save through a
    // rename or a swap file, and checkouts that keep the folder, send file
    // events only and rebuild without a restart (internals/dream-r2/p17b-dev.md).
    for (const layer of layers) {
      nuxt.options.watch.push(join(layer.rootDir, 'pdfs'))
    }

    addServerTemplate({
      filename: '#pdf',
      getContents: () => generatePdfRuntimeRegistry(templates, {
        assets: assetEntries,
        development: nuxt.options.dev,
        fonts,
        remote,
        limits,
        runtimeImport,
      }),
    })

    const registryTypeTemplate = addTemplate({
      filename: 'types/nuxt-pdf-registry.ts',
      getContents: () => generatePdfRegistryTypes(templates, {
        runtimeImport: sharedImport,
      }),
      write: true,
    })

    const addRegistryTypePath = (
      config: {
        compilerOptions?: {
          paths?: Record<string, string[]>
        }
      },
    ) => {
      const compilerOptions = config.compilerOptions ||= {}
      const paths = compilerOptions.paths ||= {}
      paths['#pdf'] = [registryTypeTemplate.dst]
    }

    nuxt.hook('prepare:types', ({ nodeTsConfig, tsConfig }) => {
      addRegistryTypePath(tsConfig)
      addRegistryTypePath(nodeTsConfig)
    })

    const nitroTypescript = nuxt.options.nitro.typescript ||= {}
    const nitroTsConfig = nitroTypescript.tsConfig ||= {}
    addRegistryTypePath(nitroTsConfig)

    addImports({
      name: 'definePdf',
      as: 'definePdf',
      from: definePdfImport,
    })

    addTypeTemplate({
      filename: 'types/nuxt-pdf-authoring.d.ts',
      getContents: () => generateAuthoringTypes(
        componentsImport,
        definePdfImport,
        einvoiceImport,
      ),
      write: true,
    }, { nitro: true, node: true, nuxt: true })

    nuxt.hook('nitro:config', (nitroConfig) => {
      // The layout copy is plain JavaScript (scripts/vendor-layout.mjs). Nitro
      // bundles our TypeScript runtime but would leave a `.js` file outside
      // node_modules as an external import in development, with a path that
      // breaks through the stubbed `dist/runtime` link. Bundle it like the rest.
      const layoutDir = resolver.resolve('./runtime/server/engine/layout')
      const externals = nitroConfig.externals ||= {}
      externals.inline = [...(externals.inline ?? []), layoutDir, realpathSync(layoutDir)]
      const rollupConfig = nitroConfig.rollupConfig ||= {}
      const existingPlugins = rollupConfig.plugins == null
        ? []
        : Array.isArray(rollupConfig.plugins)
          ? rollupConfig.plugins
          : [rollupConfig.plugins]

      rollupConfig.plugins = [
        createPdfSfcPlugin({
          files: pdfSfcFiles,
          isProduction: !nuxt.options.dev,
          dev: nuxt.options.dev,
          rootDir: nuxt.options.rootDir,
          alias: nuxt.options.alias,
          einvoiceImport,
          // Development keeps Nitro up: a file that fails to compile renders
          // as an error in /_pdf. A production build fails on it.
          onCompileError: nuxt.options.dev
            ? error => logger.error(error.message)
            : undefined,
        }),
        ...existingPlugins,
      ]
    })

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
    const runtimeDir = realpathSync(resolver.resolve('./runtime'))
    const toPosix = (path: string) => path.replaceAll('\\', '/')
    const workerGraph = [
      'server/engine/',
      'server/render-limits.',
      'authoring.',
      'shared/errors.',
      'fonts.',
    ].map(path => toPosix(`${runtimeDir}/${path}`))
    const workerEntry = toPosix(`${runtimeDir}/server/engine/worker-entry.`)
    nuxt.hook('nitro:init', (nitro) => {
      nitro.hooks.hook('rollup:before', (_nitro, config) => {
        const output = Array.isArray(config.output) ? config.output[0] : config.output
        if (!output) return
        const inlined = output.inlineDynamicImports === true
        if (inlined && !nuxt.options.dev) {
          logger.warn(
            'nuxt-pdf: this Nitro preset bundles the server into one file, so PDFs render in-process. '
            + 'The render deadline is then checked between engine stages and cannot stop a long layout.',
          )
        }
        if (!inlined) {
          const previous = output.manualChunks
          type ManualChunk = Extract<typeof previous, (...args: never[]) => unknown>
          output.manualChunks = (id: string, meta: Parameters<ManualChunk>[1]) => {
            const path = toPosix(id)
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
            if (!inlined || !toPosix(id).startsWith(workerEntry)) return null
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

    if (nuxt.options.dev) {
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
            indexPdfSfcFiles()
            await updateTemplates({ filter: template => template.filename === registryTypeTemplate.filename })
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
            `nuxt-pdf: ${relative(nuxt.options.rootDir, absolutePath) || absolutePath} changed; restarting to rebuild the PDF registry…`,
          )
          await nuxt.callHook('restart')
          return
        }
        // Disk images need no compilation; template and helper edits wait for Nitro.
        if (action === 'refresh' && /\.(?:png|jpe?g)$/i.test(absolutePath)) refreshPreview()
      })

      addServerTemplate({
        filename: '#pdf-preview-config',
        getContents: () => generatePdfPreviewConfig(
          nuxt.options.app.baseURL,
          nuxt.options.app.buildAssetsDir,
          nuxt.options.rootDir,
        ),
      })
      addServerHandler({ route: '/_pdf', handler: previewHandler })
      addServerHandler({ route: '/_pdf/**', handler: previewHandler })

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
      addPlugin(resolver.resolve('./runtime/plugins/pdf-stubs'))
    }
  },
})
