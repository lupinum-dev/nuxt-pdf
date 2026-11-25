import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Poppler as a second PDF reader (I21, I22): pdfinfo for the page count and
// sizes and (I23) the structure tree, pdftotext -bbox -raw for the words in
// content-stream order, pdftoppm for the paint. One child process per
// document, in a temporary folder that is removed afterwards.

const TOOLS = ['pdfinfo', 'pdftotext', 'pdftoppm'] as const

/** Raster resolution of I22: 72 dpi, one pixel per point. */
export const RASTER_DPI = 72

let availability: boolean | undefined

/**
 * Whether the Poppler tools run. Never a silent skip: a missing tool prints
 * one line (to stderr, which vitest shows also for passing tests), and fails
 * the run when `required` (the invariants job: CI=true and
 * NUXT_PDF_INVARIANT_SIZE or _RUNS set). The CI jobs of `pnpm test` have no
 * Poppler and print the line.
 */
export const popplerAvailable = (required: boolean): boolean => {
  if (availability !== undefined) return availability
  const missing = TOOLS.filter(tool => spawnSync(tool, ['-v'], { stdio: 'ignore' }).error !== undefined)
  if (missing.length > 0 && required) {
    throw new Error(`I21 to I23 need Poppler, and ${missing.join(', ')} is not installed: install poppler-utils.`)
  }
  if (missing.length > 0) process.stderr.write(`invariants: I21, I22 and the Poppler reading of I23 skipped: Poppler is not installed (${missing.join(', ')} not found)\n`)
  availability = missing.length === 0
  return availability
}

/** A word as pdftotext reads it: PDF points, origin top left. */
export interface PopplerWord {
  text: string
  left: number
  top: number
  width: number
  height: number
}

/** One page rendered in gray, one byte per pixel, rows from the top. */
export interface Raster {
  width: number
  height: number
  pixels: Uint8Array
}

export interface PopplerRead {
  /** Page sizes in points from pdfinfo, page by page. */
  sizes: Array<{ width: number, height: number }>
  /** Words per page from pdftotext, content-stream order. */
  words: PopplerWord[][]
  /** Gray pages from pdftoppm when asked for. */
  rasters: Raster[]
  /** I23: the words of `pdfinfo -struct-text`, whole structure tree in order, when asked for. */
  structure?: string[]
}

/** The quoted text lines of `pdfinfo -struct-text`, split into words. */
const parseStructure = (text: string): string[] =>
  [...text.matchAll(/^\s*"(.*)"\s*$/gm)].flatMap(match => match[1]!.split(/\s+/).filter(word => word !== ''))

const parseSizes = (info: string): PopplerRead['sizes'] =>
  [...info.matchAll(/^Page\s+(\d+) size:\s+([\d.]+) x ([\d.]+) pts/gm)]
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map(match => ({ width: Number(match[2]), height: Number(match[3]) }))

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'' }

/**
 * pdftotext -bbox -raw: a <page> element per page, a <word> element per word
 * with its box. (Poppler 26.04 writes no words for -tsv -raw.)
 */
const parseWords = (html: string): PopplerWord[][] =>
  html.split('<page ').slice(1).map(page => [...page.matchAll(/<word xMin="([\d.-]+)" yMin="([\d.-]+)" xMax="([\d.-]+)" yMax="([\d.-]+)">([^<]*)<\/word>/g)]
    .map(([, xMin, yMin, xMax, yMax, text]) => ({
      text: text!.replace(/&(\w+);/g, (entity, name: string) => ENTITIES[name] ?? entity),
      left: Number(xMin),
      top: Number(yMin),
      width: Number(xMax) - Number(xMin),
      height: Number(yMax) - Number(yMin),
    })))

/** A binary PGM (P5, maxval 255). */
const parsePgm = (bytes: Buffer): Raster => {
  const header = /^P5\s+(\d+)\s+(\d+)\s+255\s/.exec(bytes.subarray(0, 64).toString('latin1'))
  if (!header) throw new Error('pdftoppm wrote no binary PGM')
  const width = Number(header[1])
  const height = Number(header[2])
  return { width, height, pixels: new Uint8Array(bytes.subarray(header[0].length, header[0].length + width * height)) }
}

/**
 * Read a PDF with Poppler. A protected PDF is opened with its user password,
 * which goes to the tools as an argument and never into a message.
 */
export const readPoppler = (bytes: Uint8Array, { password, raster, structure = false }: { password?: string, raster: boolean, structure?: boolean }): PopplerRead => {
  const folder = mkdtempSync(join(tmpdir(), 'nuxt-pdf-poppler-'))
  try {
    writeFileSync(join(folder, 'in.pdf'), bytes)
    // "$@" is the password option (or nothing) for each tool.
    const script = [
      'pdfinfo "$@" -f 1 -l 1000000 in.pdf > info.txt',
      'pdftotext "$@" -bbox -raw in.pdf words.html',
      ...(raster ? [`pdftoppm "$@" -r ${RASTER_DPI} -gray in.pdf page`] : []),
      ...(structure ? ['pdfinfo "$@" -struct-text in.pdf > structure.txt'] : []),
    ].join(' && ')
    const result = spawnSync('sh', ['-c', script, 'sh', ...(password === undefined ? [] : ['-upw', password])], { cwd: folder, encoding: 'utf8' })
    if (result.status !== 0) throw new Error(`Poppler could not read the PDF (exit ${result.status ?? result.signal}): ${result.stderr.slice(0, 200)}`)
    const sizes = parseSizes(readFileSync(join(folder, 'info.txt'), 'utf8'))
    const words = parseWords(readFileSync(join(folder, 'words.html'), 'utf8'))
    const rasters = raster
      ? readdirSync(folder)
          .flatMap((name) => {
            const match = /^page-(\d+)\.pgm$/.exec(name)
            return match ? [{ name, page: Number(match[1]) }] : []
          })
          .sort((a, b) => a.page - b.page)
          .map(({ name }) => parsePgm(readFileSync(join(folder, name))))
      : []
    return { sizes, words, rasters, ...(structure ? { structure: parseStructure(readFileSync(join(folder, 'structure.txt'), 'utf8')) } : {}) }
  }
  finally {
    rmSync(folder, { recursive: true, force: true })
  }
}

/**
 * The lines of a PDF as `pdftotext` reads them in its default mode, which
 * orders each line by the Unicode bidi algorithm: the right-to-left
 * reading of Arabic text. The embedding marks it writes around each
 * direction run (U+202A to U+202E) are removed, and empty lines dropped.
 */
export const readPopplerLines = (bytes: Uint8Array): string[] => {
  const folder = mkdtempSync(join(tmpdir(), 'nuxt-pdf-poppler-'))
  try {
    writeFileSync(join(folder, 'in.pdf'), bytes)
    const result = spawnSync('pdftotext', ['-q', 'in.pdf', '-'], { cwd: folder, encoding: 'utf8' })
    if (result.status !== 0) throw new Error(`pdftotext could not read the PDF (exit ${result.status ?? result.signal}): ${result.stderr.slice(0, 200)}`)
    return result.stdout.replace(/[\u202A-\u202E\f]/g, '').split('\n').filter(line => line !== '')
  }
  finally {
    rmSync(folder, { recursive: true, force: true })
  }
}
