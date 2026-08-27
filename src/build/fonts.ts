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
} from '../runtime/fonts'

export const DEFAULT_MAX_PDF_FONT_BYTES = 5 * 1024 * 1024
const DEFAULT_MAX_PDF_DECOMPRESSED_FONT_BYTES = 20 * 1024 * 1024

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

type PdfFontFormat = 'otf' | 'ttf' | 'woff2'

const detectFontFormat = (bytes: Uint8Array): PdfFontFormat | undefined => {
  if (bytes.byteLength < 4) return undefined

  const isTrueType = bytes[0] === 0x00
    && bytes[1] === 0x01
    && bytes[2] === 0x00
    && bytes[3] === 0x00
  const isOpenType = bytes[0] === 0x4F
    && bytes[1] === 0x54
    && bytes[2] === 0x54
    && bytes[3] === 0x4F
  const isWoff2 = bytes[0] === 0x77
    && bytes[1] === 0x4F
    && bytes[2] === 0x46
    && bytes[3] === 0x32

  if (isTrueType) return 'ttf'
  if (isOpenType) return 'otf'
  if (isWoff2) return 'woff2'
  return undefined
}

const validateWoff2Structure = (
  source: string,
  bytes: Uint8Array,
): void => {
  if (bytes.byteLength < 48) {
    throw fontError(source, 'the WOFF2 header is corrupt or truncated.')
  }

  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const flavor = data.readUInt32BE(4)
  const declaredLength = data.readUInt32BE(8)
  const tableCount = data.readUInt16BE(12)
  const reserved = data.readUInt16BE(14)
  const decompressedSize = data.readUInt32BE(16)
  const compressedSize = data.readUInt32BE(20)
  const isTrueType = flavor === 0x00010000
  const isOpenType = flavor === 0x4F54544F

  if (!isTrueType && !isOpenType) {
    throw fontError(source, 'the WOFF2 font must wrap a TTF or OTF font.')
  }
  if (
    declaredLength !== bytes.byteLength
    || tableCount < 1
    || tableCount > 4096
    || reserved !== 0
    || compressedSize < 1
    || compressedSize > bytes.byteLength - 48
  ) {
    throw fontError(source, 'the WOFF2 header is corrupt or truncated.')
  }
  if (
    decompressedSize < 12
    || decompressedSize > DEFAULT_MAX_PDF_DECOMPRESSED_FONT_BYTES
  ) {
    throw fontError(
      source,
      `the decompressed WOFF2 font exceeds the ${DEFAULT_MAX_PDF_DECOMPRESSED_FONT_BYTES}-byte limit.`,
    )
  }

  const metadataOffset = data.readUInt32BE(28)
  const metadataLength = data.readUInt32BE(32)
  const metadataOriginalLength = data.readUInt32BE(36)
  const privateOffset = data.readUInt32BE(40)
  const privateLength = data.readUInt32BE(44)
  const metadataAbsent = metadataOffset === 0
    && metadataLength === 0
    && metadataOriginalLength === 0
  const metadataPresent = metadataOffset >= 48
    && metadataLength > 0
    && metadataOriginalLength > 0
    && metadataOffset + metadataLength <= bytes.byteLength
  const privateAbsent = privateOffset === 0 && privateLength === 0
  const privatePresent = privateOffset >= 48
    && privateLength > 0
    && privateOffset + privateLength <= bytes.byteLength

  if ((!metadataAbsent && !metadataPresent) || (!privateAbsent && !privatePresent)) {
    throw fontError(source, 'the WOFF2 optional data blocks are corrupt.')
  }
}

const validateSfntStructure = (
  source: string,
  bytes: Uint8Array,
  format: 'otf' | 'ttf',
): void => {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tableCount = data.readUInt16BE(4)
  const directoryEnd = 12 + tableCount * 16
  if (tableCount < 1 || tableCount > 4096 || directoryEnd > data.byteLength) {
    throw fontError(source, 'the SFNT table directory is corrupt or truncated.')
  }

  const tables = new Set<string>()
  for (let index = 0; index < tableCount; index += 1) {
    const record = 12 + index * 16
    const tag = data.toString('latin1', record, record + 4)
    const offset = data.readUInt32BE(record + 8)
    const length = data.readUInt32BE(record + 12)
    const end = offset + length
    if (
      !/^[\x20-\x7E]{4}$/u.test(tag)
      || tables.has(tag)
      || offset < directoryEnd
      || !Number.isSafeInteger(end)
      || end > data.byteLength
    ) {
      throw fontError(source, 'the SFNT table directory is corrupt or truncated.')
    }
    tables.add(tag)
  }

  const outlineTable = format === 'ttf'
    ? tables.has('glyf')
    : tables.has('CFF ') || tables.has('CFF2')
  if (
    !tables.has('head')
    || !tables.has('maxp')
    || !tables.has('cmap')
    || !outlineTable
  ) {
    throw fontError(source, 'the font is missing required SFNT tables.')
  }
}

const fontFormat = (
  source: string,
  bytes: Uint8Array,
): PdfFontFormat => {
  const extension = extname(source).toLowerCase()
  if (extension !== '.otf' && extension !== '.ttf' && extension !== '.woff2') {
    throw fontError(source, 'only .ttf, .otf, and .woff2 files are supported.')
  }
  if (bytes.byteLength < 4) {
    throw fontError(source, 'the file is too small to be a supported font.')
  }

  const format = detectFontFormat(bytes)
  if (!format) {
    throw fontError(source, 'the file has an unsupported font signature.')
  }
  if (`.${format}` !== extension) {
    throw fontError(source, 'the file extension does not match its font signature.')
  }
  if (format === 'woff2') validateWoff2Structure(source, bytes)
  else validateSfntStructure(source, bytes, format)

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
