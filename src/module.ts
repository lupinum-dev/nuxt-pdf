import { stat } from 'node:fs/promises'
import { isAbsolute, join, resolve as resolvePath } from 'node:path'
import {
  addImports,
  addServerHandler,
  addServerTemplate,
  addTemplate,
  addTypeTemplate,
  createResolver,
  defineNuxtModule,
  getLayerDirectories,
} from '@nuxt/kit'
import {
  discoverPdfComponentFiles,
  discoverPdfImageFiles,
  discoverPdfTemplates,
  type PdfTemplateLayer,
} from './build/discover-templates'
import { bundlePdfFonts } from './build/fonts'
import {
  generatePdfRegistryTypes,
  generatePdfRuntimeRegistry,
} from './build/generate-registry'
import { createPdfSfcPlugin } from './build/pdf-sfc-plugin'
import {
  normalizeRemoteAssetPolicy,
  type RemoteAssetOptions,
} from './runtime/server/assets/remote'
import { loadPdfImageAsset } from './runtime/server/assets/resolve-asset'
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

const quote = (value: string): string => JSON.stringify(value)

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

const generateAuthoringTypes = (
  componentsImport: string,
): string => `declare module 'vue' {
  interface GlobalComponents {
    PdfDocument: typeof import(${quote(componentsImport)})['PdfDocument']
    PdfImage: typeof import(${quote(componentsImport)})['PdfImage']
    PdfLink: typeof import(${quote(componentsImport)})['PdfLink']
    PdfNote: typeof import(${quote(componentsImport)})['PdfNote']
    PdfPage: typeof import(${quote(componentsImport)})['PdfPage']
    PdfText: typeof import(${quote(componentsImport)})['PdfText']
    PdfView: typeof import(${quote(componentsImport)})['PdfView']
    PdfSvg: typeof import(${quote(componentsImport)})['PdfSvg']
    PdfG: typeof import(${quote(componentsImport)})['PdfG']
    PdfPath: typeof import(${quote(componentsImport)})['PdfPath']
    PdfRect: typeof import(${quote(componentsImport)})['PdfRect']
    PdfCircle: typeof import(${quote(componentsImport)})['PdfCircle']
    PdfEllipse: typeof import(${quote(componentsImport)})['PdfEllipse']
    PdfLine: typeof import(${quote(componentsImport)})['PdfLine']
    PdfPolyline: typeof import(${quote(componentsImport)})['PdfPolyline']
    PdfPolygon: typeof import(${quote(componentsImport)})['PdfPolygon']
    PdfDefs: typeof import(${quote(componentsImport)})['PdfDefs']
    PdfClipPath: typeof import(${quote(componentsImport)})['PdfClipPath']
    PdfLinearGradient: typeof import(${quote(componentsImport)})['PdfLinearGradient']
    PdfRadialGradient: typeof import(${quote(componentsImport)})['PdfRadialGradient']
    PdfStop: typeof import(${quote(componentsImport)})['PdfStop']
    PdfTspan: typeof import(${quote(componentsImport)})['PdfTspan']
  }
}

export {}
`

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'nuxt-pdf',
    configKey: 'pdf',
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
    const templates = await discoverPdfTemplates(layers)
    const componentFiles = await discoverPdfComponentFiles(layers)
    const limits = normalizePdfLimits(options.limits)
    const resolvedLimits = limits ?? DEFAULT_PDF_RENDER_LIMITS
    const imageFiles = await discoverPdfImageFiles(layers)
    const assets = await Promise.all(imageFiles.map(image =>
      loadPdfImageAsset(image.key, {
        roots: [image.rootDir],
        maxBytes: resolvedLimits.maxImageBytes,
        maxPixels: resolvedLimits.maxImagePixels,
      }),
    ))
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
        assets,
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
      nuxt.hook('builder:watch', (_event, path) => {
        const absolutePath = isAbsolute(path)
          ? path
          : resolvePath(nuxt.options.rootDir, path)
        if (!pdfSfcFiles.has(absolutePath)) return
        clientViteServer?.ws.send({
          type: 'custom',
          event: 'nuxt-pdf:update',
          data: {},
        })
      })

      addServerHandler({ route: '/_pdf', handler: previewHandler })
      addServerHandler({ route: '/_pdf/**', handler: previewHandler })
    }
  },
})
