import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build, type Plugin } from 'esbuild'
import { loadNuxtConfig } from '@nuxt/kit'
import type { Component } from 'vue'
import {
  discoverPdfImageFiles,
  templateKeyFromRelativePath,
} from '../build/discover-templates'
import { bundlePdfFonts } from '../build/fonts'
import { createPdfSfcEsbuildPlugin, type PdfSfcCompileOptions } from '../build/pdf-sfc-plugin'
import { isBareSpecifier } from '../build/paths'
import type { ModuleOptions } from '../module'
import { normalizeRemoteAssetPolicy } from '../runtime/server/assets/remote'
import {
  pdfImageFormatFromKey,
} from '../runtime/server/assets/resolve-asset'
import { normalizePdfLimits } from '../runtime/server/render-limits'
import {
  assertRenderOptionKeys,
  renderPreparedPdfTemplate,
  type RenderedPdfTemplate,
  type RenderPdfTemplateOptions,
} from './render-template'

/** User-shaped SFC render configuration, matching the Nuxt module options. */
export type RenderPdfSfcOptions = RenderPdfTemplateOptions
  & Pick<ModuleOptions, 'fonts'>

const RENDER_PDF_SFC_OPTION_KEYS = ['fonts', 'limits', 'password', 'remote'] as const

const findPdfRoot = (filename: string): string => {
  let directory = dirname(filename)

  while (dirname(directory) !== directory) {
    if (basename(directory) === 'pdfs') return directory
    directory = dirname(directory)
  }

  throw new Error(`PDF SFC ${JSON.stringify(filename)} must be inside a pdfs directory.`)
}

// Keep every bare import external, including aliases such as `#imports` that esbuild would
// otherwise try to resolve.
const externalBareImports: Plugin = {
  name: 'nuxt-pdf:test-external',
  setup(build) {
    // Not a filter regex: a Windows path (`C:\app\pdfs\x.vue`, the entry
    // point too) does not start with `.` or `/` either, so it looked bare.
    build.onResolve({ filter: /.*/ }, ({ path, kind }) =>
      kind !== 'entry-point' && isBareSpecifier(path) ? { external: true, path } : undefined)
  },
}

/** Compile a real PDF SFC graph with the same compiler used by the Nuxt module. */
export async function loadPdfSfc(filename: string): Promise<Component> {
  return loadCompiledPdfSfc(filename, {})
}

/** Package-internal: `loadPdfSfc` with explicit compiler options (development source positions). */
export async function loadCompiledPdfSfc(
  filename: string,
  compileOptions: PdfSfcCompileOptions,
): Promise<Component> {
  const entry = resolve(filename)
  const result = await build({
    absWorkingDir: dirname(entry),
    bundle: true,
    entryPoints: [entry],
    format: 'esm',
    packages: 'external',
    platform: 'node',
    plugins: [
      externalBareImports,
      createPdfSfcEsbuildPlugin({
        kind: path => path === entry ? 'template' : 'component',
        // `computeEInvoice` is auto-imported from the installed package, as in the standalone build.
        compileOptions: { einvoiceImport: '@lupinum/nuxt-pdf/server', ...compileOptions },
        sourceMap: true,
      }),
    ],
    sourcemap: 'inline',
    target: 'node22',
    write: false,
  })
  const output = result.outputFiles?.[0]
  if (!output) throw new Error(`PDF SFC ${JSON.stringify(entry)} produced no JavaScript output.`)

  const appRoot = dirname(findPdfRoot(entry))
  const cacheDirectory = join(appRoot, 'node_modules', '.cache')
  const compiledFile = join(cacheDirectory, `nuxt-pdf-sfc-${randomUUID()}.mjs`)
  await mkdir(cacheDirectory, { recursive: true })
  await writeFile(compiledFile, output.contents)

  try {
    const loaded = await import(pathToFileURL(compiledFile).href) as { default?: unknown }
    if (!loaded.default || (typeof loaded.default !== 'object' && typeof loaded.default !== 'function')) {
      throw new Error(`PDF SFC ${JSON.stringify(entry)} has no component default export.`)
    }
    return loaded.default as Component
  }
  finally {
    await rm(compiledFile, { force: true })
  }
}

/** Compile and render a real `pdfs/*.vue` template with production resource handling. */
export async function renderPdfSfc<Props extends object>(
  filename: string,
  props: Props,
  options: RenderPdfSfcOptions = {},
): Promise<RenderedPdfTemplate> {
  assertRenderOptionKeys('renderPdfSfc', options, RENDER_PDF_SFC_OPTION_KEYS)

  const entry = resolve(filename)
  const pdfRoot = findPdfRoot(entry)
  const rootDir = dirname(pdfRoot)
  const relativePath = relative(pdfRoot, entry).replaceAll('\\', '/')
  const key = templateKeyFromRelativePath(relativePath)
  if (key === null) {
    throw new Error(`PDF SFC ${JSON.stringify(entry)} must be a template directly inside pdfs/ or one of its feature directories.`)
  }
  const normalizedLimits = normalizePdfLimits(options.limits)
  // Explicit fonts keep standalone tests independent of Nuxt configuration.
  // Otherwise reuse the application's declaration, without loading modules or dotenv.
  const config = options.fonts === undefined
    ? await loadNuxtConfig({ cwd: rootDir, dotenv: false, globalRc: false })
    : undefined
  const pdfConfig = config && 'pdf' in config ? config.pdf : undefined
  if (pdfConfig !== undefined && (typeof pdfConfig !== 'object' || pdfConfig === null || Array.isArray(pdfConfig))) {
    throw new TypeError('pdf configuration must be an object.')
  }
  const configuredFonts = pdfConfig && 'fonts' in pdfConfig ? pdfConfig.fonts : undefined
  const declaredFonts = options.fonts ?? (configuredFonts === undefined ? [] : configuredFonts)
  if (!Array.isArray(declaredFonts)) {
    throw new TypeError('pdf.fonts must be an array of local font declarations.')
  }
  const fontRoots = (config?._layers.map(layer => layer.config.rootDir || layer.cwd) ?? [rootDir])
    .map(directory => join(directory, 'pdfs', 'fonts'))
    .filter(directory => existsSync(directory))
  const [component, imageFiles, fonts] = await Promise.all([
    loadPdfSfc(entry),
    discoverPdfImageFiles([{ name: 'test', rootDir }]),
    bundlePdfFonts(declaredFonts, { fontRoots }),
  ])
  // Test renders resolve from disk exactly like development Nuxt renders.
  const assets = Object.fromEntries(imageFiles.map(image => [
    image.key,
    Object.freeze({ format: pdfImageFormatFromKey(image.key), root: image.rootDir }),
  ]))

  return renderPreparedPdfTemplate(component, props, {
    assets,
    file: `pdfs/${relativePath}`,
    fonts,
    key,
    limits: normalizedLimits,
    remote: normalizeRemoteAssetPolicy(options.remote),
    ...(options.password === undefined ? {} : { password: options.password }),
  })
}
