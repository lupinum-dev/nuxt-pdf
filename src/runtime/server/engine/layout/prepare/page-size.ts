import { NuxtPdfError, PDF_ERROR_CODES } from '../../../../shared/errors'
import { PAGE_DIMENSION } from '../../../../shared/style-values'
import { flattenStyle } from '../styles/flatten'
import type { PdfPageSizeName } from '../../../../primitives'
import type { DocumentNode, ElementNode, NodeProps, SizedDocument, SizedPage } from '../types'

// No height for a page whose height is automatic (`NodeProps.size`).
type Size = { width: number, height?: number }

// Sizes in points (72 dpi, the unit of the PDF).
const PAGE_SIZES: Record<PdfPageSizeName, readonly [number, number]> = {
  '4A0': [4767.87, 6740.79],
  '2A0': [3370.39, 4767.87],
  'A0': [2383.94, 3370.39],
  'A1': [1683.78, 2383.94],
  'A2': [1190.55, 1683.78],
  'A3': [841.89, 1190.55],
  'A4': [595.28, 841.89],
  'A5': [419.53, 595.28],
  'A6': [297.64, 419.53],
  'A7': [209.76, 297.64],
  'A8': [147.4, 209.76],
  'A9': [104.88, 147.4],
  'A10': [73.7, 104.88],
  'B0': [2834.65, 4008.19],
  'B1': [2004.09, 2834.65],
  'B2': [1417.32, 2004.09],
  'B3': [1000.63, 1417.32],
  'B4': [708.66, 1000.63],
  'B5': [498.9, 708.66],
  'B6': [354.33, 498.9],
  'B7': [249.45, 354.33],
  'B8': [175.75, 249.45],
  'B9': [124.72, 175.75],
  'B10': [87.87, 124.72],
  'C0': [2599.37, 3676.54],
  'C1': [1836.85, 2599.37],
  'C2': [1298.27, 1836.85],
  'C3': [918.43, 1298.27],
  'C4': [649.13, 918.43],
  'C5': [459.21, 649.13],
  'C6': [323.15, 459.21],
  'C7': [229.61, 323.15],
  'C8': [161.57, 229.61],
  'C9': [113.39, 161.57],
  'C10': [79.37, 113.39],
  'RA0': [2437.8, 3458.27],
  'RA1': [1729.13, 2437.8],
  'RA2': [1218.9, 1729.13],
  'RA3': [864.57, 1218.9],
  'RA4': [609.45, 864.57],
  'SRA0': [2551.18, 3628.35],
  'SRA1': [1814.17, 2551.18],
  'SRA2': [1275.59, 1814.17],
  'SRA3': [907.09, 1275.59],
  'SRA4': [637.8, 907.09],
  'EXECUTIVE': [521.86, 756],
  'FOLIO': [612, 936],
  'LEGAL': [612, 1008],
  'LETTER': [612, 792],
  'TABLOID': [792, 1224],
  'ID1': [153, 243],
}

// Points per unit. Written as 1 / 25.4 * 72, not 72 / 25.4: the two can
// differ in the last bit, and the page size must not change.
const pointsPer = (unit: string): number =>
  unit === 'in' ? 72 : unit === 'mm' ? (1 / 25.4) * 72 : unit === 'cm' ? (1 / 2.54) * 72 : 1

/**
 * One page dimension in points: a number is points; a string has a unit
 * (`PAGE_DIMENSION`, the pattern admission uses), and `px` counts at the
 * page's `dpi`.
 */
// Admission (`renderer/validate-props.ts`) guarantees a known name or positive
// dimensions, so no dimension here is 0 or `auto`.
const toPoints = (value: number | string, dpi: number): number => {
  if (typeof value === 'number') return value
  const match = PAGE_DIMENSION.exec(value)
  if (!match) throw new NuxtPdfError(PDF_ERROR_CODES.TreeInvalid, `<PdfPage> has an unsupported size. Got "${value}".`)
  const amount = Number(match[1])
  const unit = match[2]!.toLowerCase()
  return unit === 'px' ? amount * (72 / dpi) : amount * pointsPer(unit)
}

const sizeOf = (size: NonNullable<NodeProps['size']>, dpi: number): Size => {
  if (typeof size === 'string') {
    const [width, height] = PAGE_SIZES[size]
    return { width, height }
  }
  if (!('width' in size)) return { width: toPoints(size[0], dpi), height: toPoints(size[1], dpi) }
  if (!('height' in size)) return { width: toPoints(size.width, dpi) }
  return { width: toPoints(size.width, dpi), height: toPoints(size.height, dpi) }
}

const withPageSize = (page: ElementNode): SizedPage => {
  const { size = 'A4', dpi = 72, orientation } = page.props ?? {}
  const natural = sizeOf(size, dpi)
  const turned = orientation === 'landscape' ? { width: natural.height ?? 0, height: natural.width } : natural
  return { ...page, style: { ...flattenStyle(page.style ?? {}), ...turned } }
}

/** Writes each page's size, in points and turned for `landscape`, into its style. */
export const resolvePageSizes = (root: DocumentNode): SizedDocument =>
  ({ ...root, children: root.children.map(withPageSize) })
