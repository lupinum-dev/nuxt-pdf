import { stat } from 'node:fs/promises'
import { join } from 'node:path'
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
import { bundlePdfFonts, DEFAULT_MAX_PDF_FONT_BYTES } from './build/fonts'
import {
  generatePdfRegistryTypes,
  generatePdfRuntimeRegistry,
} from './build/generate-registry'
import { createPdfSfcPlugin } from './build/pdf-sfc-plugin'
import {
  normalizeRemoteAssetPolicy,
  type RemoteAssetOptions,
} from './runtime/server/assets/remote'
import {
  DEFAULT_MAX_PDF_IMAGE_BYTES,
  loadPdfImageAsset,
} from './runtime/server/assets/resolve-asset'
import {
  normalizePdfLimits,
  type PdfLimitsOptions,
} from './runtime/server/engine/limits'
import type { PdfFontDeclaration } from './runtime/server/fonts'

export type {
  PdfLength,
  PdfLengthOrPercentage,
  PdfPercentage,
  PdfStyle,
  PdfStyleEntry,
  PdfStyleValue,
} from './runtime/renderer/types'

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
   * Render limits enforced on every PDF render. Both fields are optional
   * positive integers; omitted fields fall back to the built-in defaults
   * (`timeoutMs` 30000, `maxPages` 2000).
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
  sharedImport: string,
  componentsImport: string,
): string => `type NuxtPdfDefinition<Props extends object> = import(${quote(sharedImport)}).PdfDefinition<Props>

declare global {
  const definePdf: <Props extends object = Record<string, unknown>>(
    definition: NuxtPdfDefinition<Props>,
  ) => void
}

declare module 'vue' {
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
    const previewHandler = resolver.resolve('./runtime/server/preview')
    const layers: PdfTemplateLayer[] = getLayerDirectories(nuxt).map(
      (directories, index) => ({
        rootDir: directories.root,
        name: index === 0 ? 'project' : `layer-${index}`,
      }),
    )
    const templates = await discoverPdfTemplates(layers)
    const componentFiles = await discoverPdfComponentFiles(layers)
    const imageFiles = await discoverPdfImageFiles(layers)
    const assets = await Promise.all(imageFiles.map(image =>
      loadPdfImageAsset(image.key, { roots: [image.rootDir] }),
    ))
    const fontRoots = await existingDirectories(
      layers.map(layer => join(layer.rootDir, 'pdfs', 'fonts')),
    )
    const remote = normalizeRemoteAssetPolicy(options.remote, {
      maxImageBytes: DEFAULT_MAX_PDF_IMAGE_BYTES,
      maxFontBytes: DEFAULT_MAX_PDF_FONT_BYTES,
    })
    const limits = normalizePdfLimits(options.limits)
    const fonts = await bundlePdfFonts(options.fonts ?? [], { fontRoots, remote })
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

    addTypeTemplate({
      filename: 'types/nuxt-pdf-authoring.d.ts',
      getContents: () => generateAuthoringTypes(
        sharedImport,
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
      addServerHandler({ route: '/_pdf', handler: previewHandler })
      addServerHandler({ route: '/_pdf/**', handler: previewHandler })
    }
  },
})
