import type {
  PdfBookmark,
  PdfClipPathProps,
  PdfDocumentProps,
  PdfImageProps,
  PdfLinearGradientProps,
  PdfLinkProps,
  PdfPageProps,
  PdfPageSize,
  PdfRadialGradientProps,
  PdfSvgPresentationProps,
  PdfSvgLength,
  PdfSvgProps,
  PdfTextProps,
} from '../../../../src/module'

const imageFromSrc: PdfImageProps = { src: 'images/logo.png' }
const imageFromBytes: PdfImageProps = { src: new Uint8Array() }

// @ts-expect-error An image without a source cannot render.
const imageWithoutSource: PdfImageProps = {}
// @ts-expect-error Decoded-image caching is not part of the isolated render contract.
const imageCachePassthrough: PdfImageProps = { src: 'images/logo.png', cache: false }

const internalLink: PdfLinkProps = { href: '#details' }
const externalLink: PdfLinkProps = { href: 'https://example.com' }
// @ts-expect-error A link without a target cannot create an annotation.
const linkWithoutTarget: PdfLinkProps = {}

const standardPage: PdfPageSize = 'A4'
const lessCommonStandardPage: PdfPageSize = 'SRA4'
const pointPage = [300, 400] as const satisfies PdfPageSize
const metricPage: PdfPageSize = { width: '210mm', height: '297mm' }
const pixelPage: PdfPageProps = {
  size: { width: '600px', height: '900px' },
  dpi: 300,
}

// @ts-expect-error Arbitrary strings are not page-size names.
const unknownPage: PdfPageSize = 'invoice'
// @ts-expect-error Custom dimensions only accept supported PDF units.
const cssRelativePage: PdfPageSize = { width: '50vw', height: '100vh' }
// @ts-expect-error A scalar page size is ambiguous and unsupported.
const scalarPage: PdfPageSize = 400
// @ts-expect-error Custom pages require explicit width and height.
const incompletePage: PdfPageSize = { width: 300 }
// @ts-expect-error One-value tuples are not a supported custom-page form.
const oneValuePage: PdfPageSize = [300]

const outlineBookmark: PdfBookmark = {
  title: 'Invoice details',
  expanded: true,
}

// @ts-expect-error Bookmark destination geometry is not a verified contract.
const bookmarkGeometry: PdfBookmark = { title: 'Invoice details', top: 42 }

const documentMetadata: PdfDocumentProps = {
  title: 'Invoice',
  pdfVersion: '1.7',
  pageLayout: 'singlePage',
}

// @ts-expect-error Initial reader page mode is not implemented.
const documentPageMode: PdfDocumentProps = { pageMode: 'useOutlines' }
// @ts-expect-error Upstream emits modificationDate under a non-standard custom info key.
const documentModificationDate: PdfDocumentProps = { modificationDate: new Date(0) }
// @ts-expect-error PDF encryption is not a supported document contract.
const documentEncryption: PdfDocumentProps = { ownerPassword: 'secret' }
// @ts-expect-error PDF permissions are not a supported document contract.
const documentPermissions: PdfDocumentProps = { permissions: { copying: false } }

const clipPath: PdfClipPathProps = { id: 'portrait-mask' }
// @ts-expect-error A clip path without an id cannot be referenced.
const anonymousClipPath: PdfClipPathProps = {}

const linearGradient: PdfLinearGradientProps = { id: 'brand', x1: 0, x2: 1 }
const radialGradient: PdfRadialGradientProps = { id: 'glow', r: 0.5 }
// @ts-expect-error The pinned renderer hardcodes the radial gradient's inner radius.
const radialInnerRadius: PdfRadialGradientProps = { id: 'glow', fr: 0.1 }

const alternateGradientUnits: PdfLinearGradientProps = {
  id: 'brand',
  // @ts-expect-error Alternate gradient coordinate systems are not verified.
  gradientUnits: 'userSpaceOnUse',
}
// @ts-expect-error Gradient inheritance is not a verified contract.
const inheritedGradient: PdfRadialGradientProps = { id: 'glow', xlinkHref: '#brand' }
const transformedGradient: PdfLinearGradientProps = {
  id: 'brand',
  // @ts-expect-error Gradient transforms are not a verified contract.
  gradientTransform: 'rotate(45)',
}

const svg: PdfSvgProps = { viewBox: '0 0 100 100', width: 100, height: 100 }
// @ts-expect-error Non-default aspect-ratio modes are not verified.
const alternateAspectRatio: PdfSvgProps = { preserveAspectRatio: 'none' }

const verifiedPresentationProps: PdfSvgPresentationProps = {
  fill: '#fff',
  fillOpacity: 0.5,
  stroke: '#000',
  strokeLinecap: 'round',
  strokeLinejoin: 'bevel',
  strokeOpacity: 0.75,
  strokeWidth: 1,
  transform: 'translate(10, 20)',
}

// @ts-expect-error SVG fill rules are not fixture-proven.
const unverifiedPresentationProp: PdfSvgPresentationProps = { fillRule: 'evenodd' }
// @ts-expect-error `square` is a line-cap value; PDF joins are miter, round, or bevel.
const invalidStrokeJoin: PdfSvgPresentationProps = { strokeLinejoin: 'square' }
const percentageSvgLength: PdfSvgLength = '50%'
// @ts-expect-error CSS expressions are not SVG numeric values.
const calculatedSvgLength: PdfSvgLength = 'calc(100% - 2px)'
// @ts-expect-error Arbitrary strings are not SVG numeric values.
const invalidSvgLength: PdfSvgLength = 'large'
// @ts-expect-error Shape styles are not a supported SVG paint surface.
const invalidShapeStyle: PdfSvgPresentationProps = { style: { fill: '#fff' } }
// @ts-expect-error Percentage stroke widths are not interpreted as percentages.
const percentageStrokeWidth: PdfSvgPresentationProps = { strokeWidth: '50%' }
// @ts-expect-error Only fixture-proven SVG transform operations are exposed.
const invalidSvgTransform: PdfSvgPresentationProps = { transform: 'skewX(10)' }
const svgText: PdfTextProps = { fill: '#315d3b', x: 0, y: 12 }
// @ts-expect-error SVG fill requires the explicit SVG text positioning branch.
const flowTextWithSvgFill: PdfTextProps = { fill: '#315d3b' }

void [
  alternateAspectRatio,
  alternateGradientUnits,
  anonymousClipPath,
  bookmarkGeometry,
  clipPath,
  cssRelativePage,
  documentEncryption,
  documentMetadata,
  documentModificationDate,
  documentPageMode,
  documentPermissions,
  imageCachePassthrough,
  imageFromBytes,
  imageFromSrc,
  imageWithTwoSources,
  imageWithoutSource,
  incompletePage,
  inheritedGradient,
  invalidShapeStyle,
  invalidSvgLength,
  invalidSvgTransform,
  invalidStrokeJoin,
  lessCommonStandardPage,
  linearGradient,
  internalLink,
  externalLink,
  linkWithoutTarget,
  metricPage,
  oneValuePage,
  outlineBookmark,
  pixelPage,
  pointPage,
  percentageSvgLength,
  percentageStrokeWidth,
  radialGradient,
  radialInnerRadius,
  scalarPage,
  svgText,
  flowTextWithSvgFill,
  standardPage,
  svg,
  transformedGradient,
  calculatedSvgLength,
  unknownPage,
  unverifiedPresentationProp,
  verifiedPresentationProps,
]
