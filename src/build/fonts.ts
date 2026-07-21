import { Buffer } from 'node:buffer'
import {
  open,
  realpath,
  stat,
} from 'node:fs/promises'
import {
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
  win32,
} from 'node:path'
import type {
  BundledPdfFontDescriptor,
  PdfFontDataUrl,
  PdfFontDeclaration,
  PdfFontStyle,
  PdfFontWeight,
  PdfFontWeightName,
} from '../runtime/server/fonts'

export const DEFAULT_MAX_PDF_FONT_BYTES = 5 * 1024 * 1024

export interface BundlePdfFontsOptions {
  fontRoots: readonly string[]
  maxBytes?: number
}

type PreparedFontRoot = {
  realPath: string
  sourcePath: string
}

const FONT_WEIGHT_VALUES: Readonly<Record<PdfFontWeightName, number>> = {
  black: 900,
  bold: 700,
  demibold: 600,
  extrabold: 800,
  extralight: 200,
  hairline: 100,
  heavy: 900,
  light: 300,
  medium: 500,
  normal: 400,
  semibold: 600,
  thin: 100,
  ultrabold: 800,
  ultralight: 200,
}

const FONT_STYLES = new Set<PdfFontStyle>([
  'italic',
  'normal',
  'oblique',
])

const STANDARD_FONT_FAMILIES = new Set([
  'Courier',
  'Courier-Bold',
  'Courier-BoldOblique',
  'Courier-Oblique',
  'Helvetica',
  'Helvetica-Bold',
  'Helvetica-BoldOblique',
  'Helvetica-Oblique',
  'Times-Bold',
  'Times-BoldItalic',
  'Times-Italic',
  'Times-Roman',
])

const fontError = (
  source: string,
  message: string,
): TypeError => new TypeError(`Invalid PDF font "${source}": ${message}`)

const isPdfFontsRoot = (root: string): boolean => {
  const parts = root.replaceAll('\\', '/').split('/').filter(Boolean)
  return parts.at(-2)?.toLowerCase() === 'pdfs'
    && parts.at(-1)?.toLowerCase() === 'fonts'
}

const isContained = (root: string, target: string): boolean => {
  const pathFromRoot = relative(root, target)
  return pathFromRoot !== ''
    && pathFromRoot !== '..'
    && !pathFromRoot.startsWith(`..${sep}`)
    && !isAbsolute(pathFromRoot)
}

const prepareFontRoots = async (
  roots: readonly string[],
): Promise<PreparedFontRoot[]> => {
  if (roots.length === 0) {
    throw new TypeError('At least one absolute pdfs/fonts root is required.')
  }

  const prepared: PreparedFontRoot[] = []
  const seen = new Set<string>()

  for (const root of roots) {
    if (typeof root !== 'string' || !isAbsolute(root) || !isPdfFontsRoot(root)) {
      throw new TypeError(
        `PDF font root "${root}" must be an absolute pdfs/fonts directory.`,
      )
    }

    let rootRealPath: string
    try {
      rootRealPath = await realpath(root)
    }
    catch (error) {
      throw new TypeError(`PDF font root "${root}" does not exist.`, {
        cause: error,
      })
    }

    const pdfsRealPath = await realpath(dirname(root))
    if (!isContained(pdfsRealPath, rootRealPath)) {
      throw new TypeError(
        `PDF font root "${root}" resolves outside its pdfs directory.`,
      )
    }

    const rootStats = await stat(rootRealPath)
    if (!rootStats.isDirectory()) {
      throw new TypeError(`PDF font root "${root}" must be a directory.`)
    }
    if (seen.has(rootRealPath)) continue

    seen.add(rootRealPath)
    prepared.push({ realPath: rootRealPath, sourcePath: root })
  }

  return prepared
}

const validateRelativeSource = (source: unknown): string => {
  if (typeof source !== 'string' || source.trim() === '') {
    throw fontError(String(source), 'src must be a non-empty relative path.')
  }

  const value = source.trim()
  const pathParts = value.split(/[\\/]+/)
  if (value.includes('\0')) {
    throw fontError(value, 'null bytes are not allowed in src.')
  }
  if (
    isAbsolute(value)
    || win32.isAbsolute(value)
    || /^[a-z][a-z\d+.-]*:/i.test(value)
    || value.startsWith('//')
  ) {
    throw fontError(value, 'src must be a relative local path.')
  }
  if (pathParts.includes('..')) {
    throw fontError(value, 'parent path segments are not allowed.')
  }

  return value
}

const resolveFontFile = async (
  source: string,
  roots: readonly PreparedFontRoot[],
): Promise<string> => {
  const pathParts = source.split(/[\\/]+/).filter(part => part !== '.')

  for (const root of roots) {
    const candidate = resolve(root.sourcePath, ...pathParts)
    let candidateRealPath: string

    try {
      candidateRealPath = await realpath(candidate)
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw fontError(source, 'the source file could not be resolved.')
    }

    if (!isContained(root.realPath, candidateRealPath)) {
      throw fontError(source, 'the resolved path escapes its pdfs/fonts root.')
    }

    return candidateRealPath
  }

  throw fontError(source, 'the source file was not found in any pdfs/fonts root.')
}

const normalizeFontWeight = (
  source: string,
  weight: PdfFontWeight | undefined,
): number | undefined => {
  if (weight === undefined) return undefined
  if (typeof weight === 'string') {
    const value = FONT_WEIGHT_VALUES[weight]
    if (value === undefined) {
      throw fontError(source, `unsupported fontWeight "${weight}".`)
    }
    return value
  }
  if (!Number.isInteger(weight) || weight < 1 || weight > 1000) {
    throw fontError(source, 'numeric fontWeight must be an integer from 1 to 1000.')
  }
  return weight
}

type ValidatedFont = Omit<BundledPdfFontDescriptor, 'src'> & {
  readonly source: string
}

const validateFontSource = (src: unknown): string => {
  if (typeof src === 'string' && /^https?:/i.test(src.trim())) {
    throw fontError(
      '<remote-font>',
      'remote fonts are unsupported; use a local file in pdfs/fonts/.',
    )
  }

  return validateRelativeSource(src)
}

const validateDeclaration = (
  declaration: PdfFontDeclaration,
): ValidatedFont => {
  const source = validateFontSource(declaration?.src)
  const label = source
  if (typeof declaration.family !== 'string' || declaration.family.trim() === '') {
    throw fontError(label, 'family must be a non-empty string.')
  }
  const family = declaration.family.trim()
  if (Object.prototype.hasOwnProperty.call(Object.prototype, family)) {
    throw fontError(label, `family "${family}" is a reserved object key.`)
  }
  if (STANDARD_FONT_FAMILIES.has(family)) {
    throw fontError(label, `family "${family}" is reserved by a standard PDF font.`)
  }
  if (
    declaration.fontStyle !== undefined
    && !FONT_STYLES.has(declaration.fontStyle)
  ) {
    throw fontError(label, `unsupported fontStyle "${declaration.fontStyle}".`)
  }

  return {
    family,
    fontStyle: declaration.fontStyle,
    fontWeight: normalizeFontWeight(label, declaration.fontWeight),
    source,
  }
}

const detectFontFormat = (bytes: Uint8Array): 'otf' | 'ttf' | undefined => {
  if (bytes.byteLength < 12) return undefined

  const isTrueType = bytes[0] === 0x00
    && bytes[1] === 0x01
    && bytes[2] === 0x00
    && bytes[3] === 0x00
  const isOpenType = bytes[0] === 0x4F
    && bytes[1] === 0x54
    && bytes[2] === 0x54
    && bytes[3] === 0x4F

  if (isTrueType) return 'ttf'
  if (isOpenType) return 'otf'
  return undefined
}

const fontFormat = (
  source: string,
  bytes: Uint8Array,
): 'otf' | 'ttf' => {
  const extension = extname(source).toLowerCase()
  if (extension !== '.otf' && extension !== '.ttf') {
    throw fontError(source, 'only .ttf and .otf files are supported.')
  }
  if (bytes.byteLength < 12) {
    throw fontError(source, 'the file is too small to be a TTF or OTF font.')
  }

  const format = detectFontFormat(bytes)
  if (!format) {
    throw fontError(source, 'the file has an unsupported TTF or OTF signature.')
  }

  return format
}

const readFont = async (
  source: string,
  filePath: string,
  maxBytes: number,
): Promise<PdfFontDataUrl> => {
  const file = await open(filePath, 'r')
  let bytes: Uint8Array
  try {
    const fileStats = await file.stat()
    if (!fileStats.isFile()) {
      throw fontError(source, 'the resolved source must be a regular file.')
    }
    if (fileStats.size > maxBytes) {
      throw fontError(source, `the source exceeds the ${maxBytes}-byte limit.`)
    }

    bytes = await file.readFile()
    if (bytes.byteLength > maxBytes) {
      throw fontError(source, `the source exceeds the ${maxBytes}-byte limit.`)
    }
  }
  finally {
    await file.close()
  }

  const format = fontFormat(source, bytes)
  return `data:font/${format};base64,${Buffer.from(bytes).toString('base64')}`
}

export const bundlePdfFonts = async (
  declarations: readonly PdfFontDeclaration[],
  options: BundlePdfFontsOptions,
): Promise<readonly BundledPdfFontDescriptor[]> => {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_PDF_FONT_BYTES
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError('PDF font maxBytes must be a positive safe integer.')
  }
  if (declarations.length === 0) return Object.freeze([])

  let preparedRoots: PreparedFontRoot[] | undefined
  const getRoots = async (): Promise<PreparedFontRoot[]> =>
    (preparedRoots ??= await prepareFontRoots(options.fontRoots))
  const result: BundledPdfFontDescriptor[] = []
  const registrations = new Set<string>()

  for (const declaration of declarations) {
    const validated = validateDeclaration(declaration)
    const label = validated.source
    const registration = [
      validated.family,
      validated.fontStyle ?? 'normal',
      validated.fontWeight ?? 400,
    ].join('\0')
    if (registrations.has(registration)) {
      throw fontError(
        label,
        `duplicates family "${validated.family}" with the same style and weight.`,
      )
    }

    const filePath = await resolveFontFile(validated.source, await getRoots())
    const src: PdfFontDataUrl = await readFont(validated.source, filePath, maxBytes)

    const { family, fontStyle, fontWeight } = validated
    registrations.add(registration)
    result.push(Object.freeze({ family, fontStyle, fontWeight, src }))
  }

  return Object.freeze(result)
}
