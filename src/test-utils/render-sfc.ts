import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build, type Plugin } from 'esbuild'
import type { Component } from 'vue'
import { discoverPdfImageFiles } from '../build/discover-templates'
import { bundlePdfFonts } from '../build/fonts'
import { compilePdfSfc } from '../build/pdf-sfc-plugin'
import type { PdfFontDeclaration } from '../runtime/server/fonts'
import { loadPdfImageAsset } from '../runtime/server/assets/resolve-asset'
import { resolvePdfRenderLimits } from '../runtime/server/engine/limits'
import {
  renderPdfTemplate,
  type RenderedPdfTemplate,
  type RenderPdfTemplateOptions,
} from './render-template'

export interface RenderPdfSfcOptions
  extends Omit<RenderPdfTemplateOptions, 'assets' | 'file' | 'fonts'> {
  /** Font faces declared exactly as in `pdf.fonts`; resolved from `pdfs/fonts`. */
  fonts?: readonly PdfFontDeclaration[]
  /** Application root containing `pdfs/`; inferred from the template path. */
  rootDir?: string
}

const findPdfRoot = (filename: string): string => {
  let directory = dirname(filename)

  while (dirname(directory) !== directory) {
    if (basename(directory) === 'pdfs') return directory
    directory = dirname(directory)
  }

  throw new Error(`PDF SFC ${JSON.stringify(filename)} must be inside a pdfs directory.`)
}

const resolveComposablesImport = (): string => {
  const directory = dirname(fileURLToPath(import.meta.url))
  const built = join(directory, 'runtime', 'composables', 'index.js')
  if (existsSync(built)) return built

  const source = resolve(directory, '..', 'runtime', 'composables', 'index.ts')
  if (existsSync(source)) return source

  throw new Error('Unable to locate the Nuxt PDF composables runtime.')
}

const sfcCompilerPlugin = (
  entry: string,
  composablesImport: string,
): Plugin => ({
  name: 'nuxt-pdf:test-sfc',
  setup(build) {
    build.onResolve({ filter: /^(?:@[^/]+\/)?[^./][^:]*/ }, ({ path }) => ({
      external: true,
      path,
    }))
    build.onLoad({ filter: /\.vue$/ }, async ({ path }) => ({
      contents: (await compilePdfSfc(
        await readFile(path, 'utf8'),
        path,
        path === entry ? 'template' : 'component',
        true,
        composablesImport,
      )).code,
      loader: 'js',
      resolveDir: dirname(path),
    }))
  },
})

/** Compile a real PDF SFC graph with the same compiler used by the Nuxt module. */
export async function loadPdfSfc(filename: string): Promise<Component> {
  const entry = resolve(filename)
  const composablesImport = resolveComposablesImport()
  const result = await build({
    absWorkingDir: dirname(entry),
    bundle: true,
    entryPoints: [entry],
    format: 'esm',
    packages: 'external',
    platform: 'node',
    plugins: [sfcCompilerPlugin(entry, composablesImport)],
    sourcemap: 'inline',
    target: 'node22',
    write: false,
  })
  const output = result.outputFiles?.[0]
  if (!output) throw new Error(`PDF SFC ${JSON.stringify(entry)} produced no JavaScript output.`)

  const appRoot = dirname(findPdfRoot(entry))
  const cacheDirectory = join(appRoot, 'node_modules', '.cache')
  const compiledFile = join(cacheDirectory, `nuxt-pdf-sfc-${process.pid}-${Date.now()}.mjs`)
  await mkdir(cacheDirectory, { recursive: true })
  await writeFile(compiledFile, output.contents)

  try {
    const loaded = await import(`${pathToFileURL(compiledFile).href}?v=${Date.now()}`) as { default?: unknown }
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
  const entry = resolve(filename)
  const pdfRoot = findPdfRoot(entry)
  const rootDir = resolve(options.rootDir ?? dirname(pdfRoot))
  const limits = resolvePdfRenderLimits(options.limits)
  const [component, imageFiles, fonts] = await Promise.all([
    loadPdfSfc(entry),
    discoverPdfImageFiles([{ name: 'test', rootDir }]),
    bundlePdfFonts(options.fonts ?? [], { fontRoots: [join(rootDir, 'pdfs', 'fonts')] }),
  ])
  const loadedAssets = await Promise.all(imageFiles.map(image =>
    loadPdfImageAsset(image.key, {
      roots: [image.rootDir],
      maxBytes: limits.maxImageBytes,
      maxPixels: limits.maxImagePixels,
    })))
  const assets = Object.fromEntries(loadedAssets.map(asset => [asset.key, asset]))

  return renderPdfTemplate(component, props, {
    assets,
    file: entry,
    fonts,
    key: options.key,
    limits,
    remote: options.remote,
  })
}
