import { Buffer } from 'node:buffer'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build, type Plugin } from 'esbuild'
import type { Component } from 'vue'
import {
  discoverPdfImageFiles,
  templateKeyFromRelativePath,
} from '../build/discover-templates'
import { bundlePdfFonts } from '../build/fonts'
import { compilePdfSfc } from '../build/pdf-sfc-plugin'
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

const RENDER_PDF_SFC_OPTION_KEYS = ['fonts', 'limits', 'remote'] as const

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
    build.onLoad({ filter: /\.vue$/ }, async ({ path }) => {
      const result = await compilePdfSfc(
        await readFile(path, 'utf8'),
        path,
        path === entry ? 'template' : 'component',
        true,
        composablesImport,
      )
      const sourceMap = result.map
        ? `\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(result.map)).toString('base64')}`
        : ''

      return {
        contents: result.code + sourceMap,
        loader: 'js',
        resolveDir: dirname(path),
      }
    })
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
  const [component, imageFiles, fonts] = await Promise.all([
    loadPdfSfc(entry),
    discoverPdfImageFiles([{ name: 'test', rootDir }]),
    bundlePdfFonts(options.fonts ?? [], { fontRoots: [join(rootDir, 'pdfs', 'fonts')] }),
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
  })
}
