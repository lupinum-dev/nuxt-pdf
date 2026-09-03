import { stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve as resolvePath } from 'node:path'
import { version as moduleVersion } from '../package.json'
import {
  addComponent,
  addImports,
  addServerHandler,
  addServerTemplate,
  addTemplate,
  addTypeTemplate,
  createIsIgnored,
  createResolver,
  defineNuxtModule,
  getLayerDirectories,
  logger,
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
import { PDF_STUB_NAMES } from './runtime/components/stubs'
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
  PdfBaseProps,
  PdfBookmark,
  PdfCircleProps,
  PdfClipPathProps,
  PdfDefsProps,
  PdfDocumentProps,
  PdfEllipseProps,
  PdfGProps,
  PdfImageProps,
  PdfImageSource,
  PdfLinearGradientProps,
  PdfLineProps,
  PdfLinkProps,
  PdfNoteProps,
  PdfPageDimension,
  PdfPageProps,
  PdfPageSize,
  PdfPageSizeName,
  PdfPageUnit,
  PdfPathProps,
  PdfPolygonProps,
  PdfPolylineProps,
  PdfRadialGradientProps,
  PdfRectProps,
  PdfStopProps,
  PdfSvgLength,
  PdfSvgNumber,
  PdfSvgTransform,
  PdfSvgTransformOperation,
  PdfSvgPresentationProps,
  PdfSvgProps,
  PdfTextProps,
  PdfTspanProps,
  PdfViewProps,
} from './runtime/components'

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
    const composablesImport = resolver.resolve('./runtime/composables/index')
    const definePdfImport = resolver.resolve('./runtime/define-pdf')
    const previewHandler = resolver.resolve('./runtime/server/preview')
    const layers: PdfTemplateLayer[] = getLayerDirectories(nuxt).map(
      (directories, index) => ({
        rootDir: directories.root,
        name: index === 0 ? 'project' : `layer-${index}`,
      }),
    )
    const isIgnored = createIsIgnored(nuxt)
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
    const pdfSfcFiles = new Map<string, 'component' | 'template'>(
      componentFiles.map(file => [file, 'component']),
    )

    for (const template of templates) {
      pdfSfcFiles.set(template.filePath, 'template')
    }

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
      name: 'usePdfPageNumbers',
      as: 'usePdfPageNumbers',
      from: composablesImport,
    })
    addImports({
      name: 'definePdf',
      as: 'definePdf',
      from: definePdfImport,
    })

    addTypeTemplate({
      filename: 'types/nuxt-pdf-authoring.d.ts',
      getContents: () => generateAuthoringTypes(
        componentsImport,
        composablesImport,
        definePdfImport,
      ),
      write: true,
    }, { nitro: true, node: true, nuxt: true })

    nuxt.hook('nitro:config', (nitroConfig) => {
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
          composablesImport,
        }),
        ...existingPlugins,
      ]
    })

    if (nuxt.options.dev) {
      let clientViteServer: {
        ws: { send(payload: { data: object, event: string, type: 'custom' }): void }
      } | undefined

      nuxt.hook('vite:serverCreated', (viteServer, environment) => {
        if (environment.isClient) clientViteServer = viteServer
      })
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
        if (action === 'restart') {
          // A restart wipes bundler state, so say why it is happening.
          logger.info(
            `nuxt-pdf: ${relative(nuxt.options.rootDir, absolutePath) || absolutePath} changed; restarting to rebuild the PDF registry…`,
          )
          await nuxt.callHook('restart')
          return
        }
        if (action !== 'refresh') return

        clientViteServer?.ws.send({
          type: 'custom',
          event: 'nuxt-pdf:update',
          data: {},
        })
      })

      addServerTemplate({
        filename: '#pdf-preview-config',
        getContents: () => generatePdfPreviewConfig(
          nuxt.options.app.baseURL,
          nuxt.options.app.buildAssetsDir,
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
      for (const name of PDF_STUB_NAMES) {
        addComponent({
          name,
          export: name,
          filePath: resolver.resolve('./runtime/components/stubs'),
        })
      }
    }
  },
})
