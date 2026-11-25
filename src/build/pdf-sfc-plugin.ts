// Rollup, Vite and esbuild plugins for PDF SFCs: virtual ids, import checks, development recovery.

import { generateCodeFrame } from '@vue/compiler-sfc'
import type { Plugin as EsbuildPlugin } from 'esbuild'
import { Buffer } from 'node:buffer'
import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, resolve } from 'node:path'
import { PDF_COMPILE_ERROR_PROPERTY, type PdfCompileErrorInfo } from '../runtime/shared/compile-error'
import { forwardSlashes } from '../runtime/shared/paths'
import { isLocalModule, isMissingFile, projectPath } from './paths'
import { compilePdfSfc, type PdfSfcCompileOptions, type PdfSfcKind, type PdfSfcTransformResult } from './sfc/compile'
import { bundlerError, errorAtNode, PdfSfcCompileError } from './sfc/errors'
import { asAstNode, moduleImportSources, moduleStatements, pdfSfc } from './sfc/script-ast'
import { textPositions } from './sfc/source-text'
import { parsePdfSfc } from './sfc/vue-compiler'

export { compilePdfSfc, type PdfSfcCompileOptions } from './sfc/compile'
export { PdfSfcCompileError } from './sfc/errors'

export type PdfSfcPluginOptions = {
  /** Absolute filenames discovered by the Nuxt module. The map may be updated in development. */
  files: ReadonlyMap<string, PdfSfcKind>
  isProduction?: boolean
  /**
   * Development only. With it, a file that fails to compile, or that imports
   * a module the bundler cannot resolve, becomes a stub component that fails
   * at render with the message and position, so the Nitro build and the other
   * templates keep working. The callback reports a file when it breaks and
   * when its message changes, not on every rebuild. Without it the build
   * fails.
   */
  onCompileError?: (error: Error) => void
} & PdfSfcCompileOptions

/** The part of Rollup's plugin context the SFC plugin uses. */
export type PdfSfcPluginContext = {
  addWatchFile(file: string): void
  load?(options: { id: string, resolveDependencies?: boolean }): Promise<unknown>
  resolve?(source: string, importer?: string, options?: { skipSelf?: boolean }): Promise<unknown>
}

export type PdfSfcPlugin = {
  enforce: 'pre'
  load(this: PdfSfcPluginContext, id: string): Promise<PdfSfcTransformResult | null>
  name: 'nuxt-pdf:sfc'
  resolveId(source: string, importer?: string): string | null
  transform(this: unknown, source: string, id: string): Promise<PdfSfcTransformResult | null>
}

/** The bundler's watcher, when the plugin context has one (Rollup and Vite do). */
const watcherOf = (context: unknown): ((file: string) => void) | undefined => {
  if (typeof context !== 'object' || context === null || !('addWatchFile' in context)) return undefined
  const { addWatchFile } = context
  return typeof addWatchFile === 'function' ? (file: string) => addWatchFile.call(context, file) : undefined
}

/** What the import checks ask the bundler about the compiled module. */
type PdfBundler = {
  /** The id an import of the compiled module resolves to, or `null`. */
  resolve(source: string): Promise<{ external: boolean, id: string } | null>
  /**
   * Loads and transforms a module as the build will; resolves to the ids it
   * imports and rejects with the transform error.
   */
  load?(id: string): Promise<readonly string[]>
}

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

/**
 * The bundler's own resolver and loader, as Rollup will call them for the
 * compiled module. `skipSelf: false` keeps this plugin's resolver for imports
 * relative to a virtual SFC id.
 */
const bundlerOf = (context: unknown, importer: string): PdfBundler | undefined => {
  if (typeof context !== 'object' || context === null || !('resolve' in context)) return undefined
  const { resolve } = context
  if (typeof resolve !== 'function') return undefined
  const load = 'load' in context ? context.load : undefined
  return {
    async resolve(source) {
      const resolved: unknown = await resolve.call(context, source, importer, { skipSelf: false })
      if (typeof resolved !== 'object' || resolved === null || !('id' in resolved) || typeof resolved.id !== 'string') return null
      return { external: 'external' in resolved && resolved.external !== false, id: resolved.id }
    },
    load: typeof load === 'function'
      ? async (id) => {
        const info: unknown = await load.call(context, { id, resolveDependencies: true })
        return typeof info === 'object' && info !== null && 'importedIds' in info ? stringList(info.importedIds) : []
      }
      : undefined,
  }
}

const VIRTUAL_PREFIX = '\0nuxt-pdf:sfc:'

const VIRTUAL_SUFFIX = '.mjs'

/**
 * esbuild plugin for the standalone `/build` and `/test` entries: compiles `.vue` files with the
 * same compiler as the Nuxt module. `kind` says which files are templates.
 */
export const createPdfSfcEsbuildPlugin = (options: {
  kind: (path: string) => PdfSfcKind
  compileOptions?: PdfSfcCompileOptions
  /** Inline the compiler source map so stack traces point at the `.vue` file. */
  sourceMap?: boolean
}): EsbuildPlugin => ({
  name: 'nuxt-pdf:sfc',
  setup(builder) {
    builder.onLoad({ filter: /\.vue$/ }, async ({ path }) => {
      const source = await readFile(path, 'utf8')
      const result = await compilePdfSfc(source, path, options.kind(path), true, options.compileOptions)
      // esbuild reports an import it cannot resolve at the compiled position;
      // checked here, it names the import in the authored file, as the Nuxt build does.
      await assertImportsResolve(result.code, source, forwardSlashes(path), {
        async resolve(specifier) {
          const resolved = await builder.resolve(specifier, { kind: 'import-statement', resolveDir: dirname(path) })
          return resolved.errors.length > 0 ? null : { external: resolved.external, id: resolved.path }
        },
      })
      const sourceMap = options.sourceMap && result.map
        ? `\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(result.map)).toString('base64')}`
        : ''
      return { contents: result.code + sourceMap, loader: 'js', resolveDir: dirname(path) }
    })
  },
})

export const createPdfSfcPlugin = (
  options: PdfSfcPluginOptions,
): PdfSfcPlugin => {
  const recovery = compileRecoveryOf(options.onCompileError)
  return {
    name: 'nuxt-pdf:sfc',
    enforce: 'pre',
    resolveId(source, importer) {
      const filename = resolvePdfImport(source, importer)

      if (!filename) return null
      if (options.files.has(filename)) return virtualPdfId(filename)

      return importer?.startsWith(VIRTUAL_PREFIX)
        ? resolveRelativeModule(filename)
        : null
    },
    async load(id) {
      const filename = filenameFromVirtualId(id)
      if (!filename) return null

      const kind = options.files.get(filename)
      if (!kind) return null

      // Watched before compiling, so a fix rebuilds even after a failure.
      this.addWatchFile(filename)
      let source: string
      try {
        source = await readFile(filename, 'utf8')
      }
      catch (error) {
      // In development Rollup's watcher can rebuild before the module has
      // dropped a removed file from the registry; the registry rebuild follows.
        if (!recovery || !isMissingFile(error)) throw error
        recovery.succeeded(filename)
        return { code: compileErrorStub(compileErrorInfo(new Error('This file was removed.'), filename, options.rootDir)), map: null }
      }
      return compileOrRecover(
        source,
        filename,
        kind,
        options,
        recovery,
        file => this.addWatchFile(file),
        bundlerOf(this, id),
      )
    },
    async transform(source, id) {
      if (id.includes('?') || id.startsWith(VIRTUAL_PREFIX)) return null

      const filename = resolve(id)
      const kind = options.files.get(filename)

      if (!kind) return null

      return compileOrRecover(
        source,
        filename,
        kind,
        options,
        recovery,
        watcherOf(this),
        bundlerOf(this, id),
      )
    },
  }
}

/** Development: how a failed file is reported. */
type PdfCompileRecovery = {
  failed(filename: string, error: Error): void
  succeeded(filename: string): void
}

/**
 * Rollup compiles every module again on each rebuild. Keeping the last
 * message reported per file, a file still broken after an unrelated edit stays
 * quiet. Nitro keeps the plugin object, and so this state, across its dev
 * rebuilds; a Nuxt restart starts with an empty record.
 */
function compileRecoveryOf(report: ((error: Error) => void) | undefined): PdfCompileRecovery | undefined {
  if (!report) return undefined
  const reported = new Map<string, string>()
  return {
    failed(filename, error) {
      if (reported.get(filename) === error.message) return
      reported.set(filename, error.message)
      report(error)
    },
    succeeded: filename => reported.delete(filename),
  }
}

async function compileOrRecover(
  source: string,
  filename: string,
  kind: PdfSfcKind,
  options: PdfSfcPluginOptions,
  recovery: PdfCompileRecovery | undefined,
  onDependency: ((file: string) => void) | undefined,
  bundler: PdfBundler | undefined,
): Promise<PdfSfcTransformResult> {
  const { files: _files, isProduction, onCompileError: _onCompileError, ...compileOptions } = options
  try {
    const result = await compilePdfSfc(source, filename, kind, isProduction, { ...compileOptions, onDependency })
    // Rollup reports an import it cannot resolve against the virtual module id
    // and, in development, fails the whole build. Checked here, the error names
    // the import in the authored file, in every build; in development the file
    // fails alone, like a compile error.
    if (bundler) {
      const imported = await assertImportsResolve(result.code, source, forwardSlashes(filename), bundler)
      if (recovery && bundler.load) await assertLocalModulesLoad(imported, bundler.load, options.rootDir ?? process.cwd(), onDependency)
    }
    recovery?.succeeded(filename)
    return result
  }
  catch (error) {
    if (!recovery) throw withCodeFrame(error, source, filename)
    const failure = error instanceof Error ? error : new Error(String(error))
    recovery.failed(filename, failure)
    return { code: compileErrorStub(compileErrorInfo(failure, filename, options.rootDir)), map: null }
  }
}

/**
 * A production compile error with the code frame of its position. Nitro prints
 * a failed build's `frame` (and the text "undefined" when it has none).
 */
function withCodeFrame(error: unknown, source: string, filename: string): unknown {
  if (!(error instanceof PdfSfcCompileError) || error.filename !== forwardSlashes(filename)) return error
  const offset = textPositions(source).offset(error.line, error.column)
  return Object.assign(error, { frame: generateCodeFrame(source, offset, offset + 1) })
}

/**
 * Fails at the first import of the compiled module that the bundler cannot
 * resolve, at the position of that import in the authored file. Compiled code
 * keeps only imports that are used, so an unused import of a missing file
 * passes here as it passes the production build.
 */
async function assertImportsResolve(
  code: string,
  source: string,
  filename: string,
  bundler: PdfBundler,
): Promise<string[]> {
  const imported: string[] = []
  for (const specifier of moduleImportSources(code)) {
    const resolved = await bundler.resolve(specifier)
    if (resolved) {
      if (!resolved.external) imported.push(resolved.id)
      continue
    }
    const message = `Cannot resolve the import "${specifier}". Check the path or alias, and that the package is installed.`
    const sfc = pdfSfc(parsePdfSfc(source, filename), filename)
    for (const block of [sfc.descriptor.scriptSetup, sfc.descriptor.script]) {
      if (!block) continue
      for (const statement of moduleStatements(sfc.program(block))) {
        const literal = asAstNode(statement.source)
        if (literal?.value === specifier) throw errorAtNode(filename, block, literal, message)
      }
    }
    throw new PdfSfcCompileError(filename, 1, 1, message)
  }
  return imported
}

/**
 * Development: a project module in the file's import graph that fails to
 * transform (a syntax error in a helper `.ts`) or imports a missing module
 * fails the whole Nitro build. Loaded here through the bundler, which caches
 * the result for the build, it fails only this file, at the module's own
 * position. Each module is watched, so fixing it compiles the file again.
 */
async function assertLocalModulesLoad(
  ids: readonly string[],
  load: NonNullable<PdfBundler['load']>,
  rootDir: string,
  onDependency: ((file: string) => void) | undefined,
): Promise<void> {
  const seen = new Set<string>()
  const queue = ids.filter(id => isLocalModule(id, rootDir))
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    if (seen.has(id)) continue
    seen.add(id)
    onDependency?.(id)
    let imported: readonly string[]
    try {
      imported = await load(id)
    }
    catch (error) {
      throw bundlerError(error, id)
    }
    queue.push(...imported.filter(next => isLocalModule(next, rootDir)))
  }
}

/** Position and message of a compile failure, relative to the project root. */
function compileErrorInfo(error: Error, filename: string, rootDir = process.cwd()): PdfCompileErrorInfo {
  const located = error instanceof PdfSfcCompileError
  return {
    message: located ? error.detail : error.message,
    source: {
      file: projectPath(rootDir, located ? error.filename : filename),
      line: located ? error.line : 1,
      column: located ? error.column : 1,
    },
  }
}

/**
 * Development stand-in for a file that failed to compile. Imports nothing, so
 * it cannot fail to build. The registry and the preview read the marker; a
 * template that uses a failed component gets the thrown `Error`.
 */
function compileErrorStub(info: PdfCompileErrorInfo): string {
  const marker = JSON.stringify(PDF_COMPILE_ERROR_PROPERTY)
  return [
    `const info = Object.freeze(${JSON.stringify({ message: info.message, source: info.source })})`,
    `export default { name: 'NuxtPdfCompileError', [${marker}]: info, setup() { throw Object.assign(new Error(info.message), { [${marker}]: info }) } }`,
    '',
  ].join('\n')
}

const MODULE_EXTENSIONS: readonly string[] = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
] as const

function resolveRelativeModule(filename: string): string | null {
  const extension = extname(filename)
  const candidates = MODULE_EXTENSIONS.includes(extension)
    ? [filename]
    : [
        filename,
        ...MODULE_EXTENSIONS.map(extension => `${filename}${extension}`),
        ...MODULE_EXTENSIONS.map(extension => resolve(filename, `index${extension}`)),
      ]

  for (const candidate of candidates) {
    if (candidate.endsWith('.vue') || !existsSync(candidate)) continue

    try {
      if (statSync(candidate).isFile()) return candidate
    }
    catch {
      // The normal module resolver will provide the final missing-import error.
    }
  }

  return null
}

function resolvePdfImport(source: string, importer?: string): string | undefined {
  if (source.startsWith('\0') || source.includes('?')) return undefined

  if (isAbsolute(source)) return resolve(source)
  if (!source.startsWith('.')) return undefined

  const importerFilename = importer?.startsWith(VIRTUAL_PREFIX)
    ? filenameFromVirtualId(importer)
    : importer?.split('?', 1)[0]

  return importerFilename
    ? resolve(dirname(importerFilename), source)
    : undefined
}

function virtualPdfId(filename: string): string {
  return `${VIRTUAL_PREFIX}${Buffer.from(filename).toString('base64url')}${VIRTUAL_SUFFIX}`
}

function filenameFromVirtualId(id: string): string | undefined {
  if (!id.startsWith(VIRTUAL_PREFIX) || !id.endsWith(VIRTUAL_SUFFIX)) return undefined

  const encoded = id.slice(VIRTUAL_PREFIX.length, -VIRTUAL_SUFFIX.length)

  try {
    return Buffer.from(encoded, 'base64url').toString('utf8')
  }
  catch {
    return undefined
  }
}
