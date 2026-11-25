import { join } from 'node:path'
import { version as moduleVersion } from '../package.json'
import {
  addImports,
  addServerTemplate,
  addTemplate,
  addTypeTemplate,
  createIsIgnored,
  createResolver,
  defineNuxtModule,
  getLayerDirectories,
  logger,
  resolveModule,
} from '@nuxt/kit'
import { installPdfDevServer } from './build/dev-server'
import {
  discoverPdfComponentFiles,
  type PdfTemplateLayer,
} from './build/discover-templates'
import { checkPdfModuleKeys, preparePdfRegistryInputs } from './build/registry-inputs'
import { installRenderWorkerChunks } from './build/render-worker-chunks'
import type { PdfSfcKind } from './build/sfc/compile'
import { generateAuthoringTypes } from './build/generate-authoring-types'
import {
  generatePdfRegistryTypes,
  generatePdfRuntimeRegistry,
} from './build/generate-registry'
import { createPdfSfcPlugin } from './build/pdf-sfc-plugin'
import type { RemoteAssetOptions } from './runtime/server/assets/remote'
import type { PdfLimitsOptions } from './runtime/server/render-limits'
import type { PdfFontDeclaration } from './runtime/fonts'

export type {
  PdfFontDeclaration,
  PdfFontStyle,
  PdfFontWeight,
  PdfFontWeightName,
} from './runtime/fonts'

export type { PdfLimitsOptions } from './runtime/server/render-limits'

export type { PdfSourcePosition } from './runtime/shared/errors'

export type { PdfImageWarning, PdfLayoutWarning, PdfRichTextWarning, PdfRichTextWarningCode } from './runtime/shared/template'

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
  PdfTableColumnOptions,
  PdfTableColumnWidth,
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
  PdfContentsProps,
  PdfContentsStyles,
  PdfDefsProps,
  PdfDocumentProps,
  PdfFixedPages,
  PdfFootnoteProps,
  PdfFootnoteStyles,
  PdfEllipseProps,
  PdfFacturXProfile,
  PdfFacturXProps,
  PdfFacturXRelationship,
  PdfGProps,
  PdfImageProps,
  PdfImageSource,
  PdfLeaderProps,
  PdfLeaderStyle,
  PdfLeaderStyleEntry,
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
  PdfRadioProps,
  PdfPrintingPermission,
  PdfProtection,
  PdfRadialGradientProps,
  PdfRectProps,
  PdfRunning,
  PdfRunningAt,
  PdfRunningTextProps,
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
export type {
  PdfRichBlock,
  PdfRichBreak,
  PdfRichCode,
  PdfRichComponent,
  PdfRichFootnote,
  PdfRichHeading,
  PdfRichImage,
  PdfRichInline,
  PdfRichJsonValue,
  PdfRichLink,
  PdfRichList,
  PdfRichParagraph,
  PdfRichQuote,
  PdfRichRule,
  PdfRichTable,
  PdfRichTableCell,
  PdfRichTextIssue,
  PdfRichTextRun,
} from './runtime/rich-text'
export type { PdfRichTextProps, PdfRichTextStyleKey, PdfRichTextStyles } from './runtime/components/rich-text'

export interface ModuleOptions {
  fonts?: readonly PdfFontDeclaration[]
  remote?: RemoteAssetOptions
  /**
   * Canonical render, tree, image, remote-request, and output budgets. Every
   * field is an optional whole number from 1 (time limits up to
   * 2,147,483,647 ms); omitted fields use the documented built-in defaults.
   */
  limits?: PdfLimitsOptions
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
    checkPdfModuleKeys(options)
    const resolver = createResolver(import.meta.url)
    const runtimeImport = resolver.resolve('./runtime/server/index')
    const sharedImport = resolver.resolve('./runtime/shared/index')
    const componentsImport = resolver.resolve('./runtime/components/index')
    const definePdfImport = resolver.resolve('./runtime/define-pdf')
    const functionsImport = resolver.resolve('./runtime/functions')
    const previewHandler = resolver.resolve('./runtime/server/preview')
    const layers: PdfTemplateLayer[] = getLayerDirectories(nuxt).map(
      (directories, index) => ({
        rootDir: directories.root,
        name: index === 0 ? 'project' : `layer-${index}`,
      }),
    )
    const isIgnored = createIsIgnored(nuxt)
    // Development replaces the contents of both in place when a template or
    // component file is added or removed (`rediscoverPdfFiles` in build/dev-server.ts).
    const { templates, assets, fonts, limits, remote } = await preparePdfRegistryInputs(layers, options, {
      development: nuxt.options.dev,
      isIgnored,
    })
    const componentFiles = await discoverPdfComponentFiles(layers, isIgnored)
    const pdfSfcFiles = new Map<string, PdfSfcKind>()
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
    // events only and rebuild without a restart (D14).
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
          // Nuxt 4.6 types path entries as `(string | undefined)[]`.
          paths?: Record<string, (string | undefined)[] | undefined>
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
        functionsImport,
      ),
      write: true,
    }, { nitro: true, node: true, nuxt: true })

    // comark is an optional peer that the Markdown parse imports on first use.
    // Without it, Rollup warns on every build that it cannot resolve the
    // import. Naming it external keeps the import as it is (the parse then
    // fails with its install hint) and the build quiet. With comark installed,
    // Nitro bundles or traces it as usual.
    const comarkMissing = (() => {
      try {
        resolveModule('comark', { url: new URL(import.meta.url) })
        return false
      }
      catch {
        return true
      }
    })()

    nuxt.hook('nitro:config', (nitroConfig) => {
      const rollupConfig = nitroConfig.rollupConfig ||= {}
      if (comarkMissing) {
        const optionalPeers = ['comark', 'comark/plugins/footnotes']
        const external = rollupConfig.external
        rollupConfig.external = typeof external === 'function'
          ? (source, importer, isResolved) => optionalPeers.includes(source) || external(source, importer, isResolved)
          : [...optionalPeers, ...external === undefined ? [] : Array.isArray(external) ? external : [external]]
      }
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
          functionsImport,
          // Development keeps Nitro up: a file that fails to compile renders
          // as an error in /_pdf. A production build fails on it.
          onCompileError: nuxt.options.dev
            ? error => logger.error(error.message)
            : undefined,
        }),
        ...existingPlugins,
      ]
    })

    installRenderWorkerChunks(nuxt, resolver.resolve('./runtime'))

    if (nuxt.options.dev) {
      installPdfDevServer(nuxt, {
        layers,
        isIgnored,
        templates,
        componentFiles,
        onFilesChanged: indexPdfSfcFiles,
        registryTypesFilename: registryTypeTemplate.filename,
        previewHandler,
        runtimeImport,
        stubsPlugin: resolver.resolve('./runtime/plugins/pdf-stubs'),
      })
    }
  },
})
