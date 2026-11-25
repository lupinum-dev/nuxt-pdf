// The style sheets of one SFC in CSS order: <style> blocks and the files they @import, inside the project.

import type { SFCStyleBlock } from '@vue/compiler-sfc'
import { readFileSync, realpathSync, type Stats, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import postcss, { type AtRule, type ChildNode, CssSyntaxError } from 'postcss'
import { forwardSlashes, isInside } from '../../runtime/shared/paths'
import { projectPath } from '../paths'
import { blockPosition, type FilePosition } from '../sfc/errors'

export type PdfStyleOptions = {
  /** Path aliases (Nuxt's `~`, `@`, `~~` …) for `@import`. */
  alias?: Readonly<Record<string, string>>
  /** The SFC file, absolute. Relative `@import` paths start here. */
  filename: string
  /** Called with every imported `.css` file, for the bundler's watcher. */
  onDependency?: (file: string) => void
  /** `@import` cannot leave this directory. */
  rootDir: string
  /** The `<script>` of the file is TypeScript, so `v-bind()` may use its syntax. */
  typescript?: boolean
}

/** `file` is set for a failure inside an imported `.css` file. */
export type PdfStyleFailure = (line: number, column: number, message: string, file?: string) => Error

/** Fails at a 1-based position of the sheet, as postcss gives it. */
export type FailAt = (position: FilePosition | undefined, message: string) => never

/** One parsed stylesheet: a `<style>` block or an imported file. */
export type Sheet = { failAt: FailAt, imported: boolean, root: postcss.Root, typescript: boolean }

const parseSheet = (content: string, failAt: FailAt): postcss.Root => {
  try {
    return postcss.parse(content)
  }
  catch (error) {
    if (error instanceof CssSyntaxError) {
      return failAt({ line: error.line ?? 1, column: error.column ?? 1 }, `Invalid CSS: ${error.reason}.`)
    }
    throw error
  }
}

export const isImport = (node: ChildNode): boolean => node.type === 'atrule' && node.name.toLowerCase() === 'import'

const IMPORT_URL = 'takes a local path in quotes, such as @import \'./theme.css\'.'

/**
 * Resolves the path of one `@import` to a real file inside the project:
 * relative to the importing file, or through an alias.
 */
const resolveImport = (node: AtRule, from: string, options: PdfStyleOptions, failAt: FailAt, projectRoot: () => string): string => {
  const at = node.source?.start
  const params = node.params.trim()
  const quote = params[0]
  const close = quote === '"' || quote === '\'' ? params.indexOf(quote, 1) : -1
  if (close === -1) return failAt(at, `@import ${IMPORT_URL}`)
  const path = params.slice(1, close)
  if (params.slice(close + 1).trim()) failAt(at, '@import takes only a path in PDF styles; media queries, layers and supports() are not supported.')
  if (/^[a-z][\w+.-]*:/i.test(path) || path.startsWith('//')) failAt(at, `@import ${IMPORT_URL} URLs are not loaded.`)
  if (!path.toLowerCase().endsWith('.css')) failAt(at, `@import reads .css files only; found "${path}".`)
  // eslint-disable-next-line no-control-regex -- control characters are what this rejects
  if (/[\u0000-\u001F\u007F]/.test(path)) failAt(at, `@import cannot read ${JSON.stringify(path)}: a path cannot hold control characters.`)

  const alias = Object.keys(options.alias ?? {})
    .filter(key => path === key || path.startsWith(`${key}/`))
    .sort((left, right) => right.length - left.length)[0]
  const resolved = path.startsWith('./') || path.startsWith('../')
    ? resolve(dirname(from), path)
    : alias === undefined
      ? failAt(at, `@import takes a path relative to this file or one that starts with an alias, such as ./theme.css or ~~/pdfs/theme.css; found "${path}".`)
      : resolve(options.alias![alias]!, `.${path.slice(alias.length)}`)
  // Watched before the checks, so creating a missing file rebuilds in `nuxt dev`.
  options.onDependency?.(resolved)
  let stats: Stats | undefined
  try {
    stats = statSync(resolved, { throwIfNoEntry: false })
  }
  catch (error) {
    // For example a name too long for the file system.
    failAt(at, `@import cannot read ${JSON.stringify(path)}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!stats?.isFile()) {
    failAt(at, `@import cannot find "${path}" (resolved to ${projectPath(options.rootDir, resolved)}).`)
  }
  const real = realpathSync(resolved)
  if (real !== resolved) options.onDependency?.(real)
  if (!isInside(projectRoot(), real)) failAt(at, `@import "${path}" leaves the project directory.`)
  return real
}

/** Keeps the last place of each sheet: a browser applies a repeated sheet at each place, and the last one wins. */
const lastPlaces = (sheets: readonly Sheet[]): Sheet[] => sheets.filter((sheet, index) => sheets.lastIndexOf(sheet) === index)

/**
 * Parses the `<style>` blocks and every file they import, in CSS order: an
 * imported sheet comes before the sheet that imports it, so the importing
 * file wins at equal specificity. A file imported twice in one graph is
 * parsed once and counts at its last place, as in a browser.
 */
export const loadSheets = (blocks: readonly SFCStyleBlock[], fail: PdfStyleFailure, options: PdfStyleOptions): Sheet[] => {
  const typescript = options.typescript ?? false
  const watched = new Set<string>()
  const report = options.onDependency
  const watching: PdfStyleOptions = {
    ...options,
    onDependency: report && ((file) => {
      if (watched.has(file)) return
      watched.add(file)
      report(file)
    }),
  }
  /** Each imported file with the sheets it brings in, in CSS order. */
  const expanded = new Map<string, Sheet[]>()
  let realRoot: string | undefined
  const projectRoot = (): string => realRoot ??= realpathSync(options.rootDir)

  const expand = (sheet: Sheet, from: string, chain: readonly string[]): Sheet[] => {
    const order: Sheet[] = []
    for (const node of sheet.root.nodes) {
      if (node.type === 'comment') continue
      if (node.type !== 'atrule' || !isImport(node)) break
      const file = resolveImport(node, from, watching, sheet.failAt, projectRoot)
      if (chain.includes(file)) {
        const steps = [...chain.slice(chain.indexOf(file)), file].map(step => projectPath(options.rootDir, step))
        sheet.failAt(node.source?.start, `@import "${node.params.trim().slice(1, -1)}" imports itself through ${steps.join(' → ')}.`)
      }
      let imported = expanded.get(file)
      if (!imported) {
        const failAt: FailAt = (position, message) => {
          throw fail(position?.line ?? 1, position?.column ?? 1, message, forwardSlashes(file))
        }
        imported = expand({ failAt, imported: true, root: parseSheet(readFileSync(file, 'utf8'), failAt), typescript }, file, [...chain, file])
        expanded.set(file, imported)
      }
      order.push(...imported)
    }
    order.push(sheet)
    return lastPlaces(order)
  }

  const sheets: Sheet[] = []

  for (const block of blocks) {
    const failAt: FailAt = (position, message) => {
      const { line, column } = blockPosition(block, { line: position?.line ?? 1, column: position?.column ?? 1 })
      throw fail(line, column, message)
    }
    sheets.push(...expand({ failAt, imported: false, root: parseSheet(block.content, failAt), typescript }, options.filename, []))
  }
  return lastPlaces(sheets)
}
