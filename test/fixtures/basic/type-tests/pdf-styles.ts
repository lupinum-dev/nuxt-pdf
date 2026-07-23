import type {
  PdfLength,
  PdfPercentage,
  PdfStyle,
  PdfStyleValue,
} from '../../../../src/module'

const pointLength: PdfLength = 12
const physicalLength: PdfLength = '2.5mm'
const relativeLength: PdfPercentage = '50%'

const dimensions = {
  height: '24pt',
  maxHeight: '90%',
  maxWidth: 420,
  minHeight: 24,
  minWidth: '1in',
  width: relativeLength,
} satisfies PdfStyle

const flex = {
  alignItems: 'center',
  flex: 1,
  flexBasis: '25%',
  flexDirection: 'row',
  flexGrow: 1,
  flexShrink: 0,
  flexWrap: 'wrap',
  gap: '4mm',
  justifyContent: 'space-between',
} satisfies PdfStyle

const boxModel = {
  margin: 'auto',
  marginBottom: pointLength,
  marginHorizontal: '5%',
  marginLeft: '1rem',
  marginRight: 8,
  marginTop: '4px',
  marginVertical: '2vh',
  padding: 12,
  paddingBottom: '2mm',
  paddingHorizontal: '4%',
  paddingLeft: '1cm',
  paddingRight: '8pt',
  paddingTop: '1vw',
  paddingVertical: 6,
} satisfies PdfStyle

const positioning = {
  bottom: 24,
  left: '5%',
  position: 'absolute',
  right: '4mm',
  top: 0,
} satisfies PdfStyle

const paintAndBorders = {
  backgroundColor: '#f4f6f4',
  borderBottomColor: '#202020',
  borderBottomLeftRadius: '4%',
  borderBottomRightRadius: 4,
  borderBottomStyle: 'dotted',
  borderBottomWidth: '1pt',
  borderColor: '#101010',
  borderLeftColor: '#303030',
  borderLeftStyle: 'solid',
  borderLeftWidth: 1,
  borderRadius: '2mm',
  borderRightColor: '#404040',
  borderRightStyle: 'dashed',
  borderRightWidth: '1px',
  borderStyle: 'solid',
  borderTopColor: '#505050',
  borderTopLeftRadius: 4,
  borderTopRightRadius: '4%',
  borderTopStyle: 'solid',
  borderTopWidth: 1,
  borderWidth: 1,
  color: '#18251d',
  opacity: 0.85,
} satisfies PdfStyle

const text = {
  color: '#18251d',
  fontFamily: 'Invoice Sans',
  fontSize: '11pt',
  fontStyle: 'italic',
  fontWeight: 600,
  letterSpacing: 0.4,
  lineHeight: '140%',
  maxLines: 2,
  textAlign: 'right',
  textDecoration: 'underline',
  textDecorationColor: '#18251d',
  textDecorationStyle: 'dashed',
  textOverflow: 'ellipsis',
  textTransform: 'uppercase',
} satisfies PdfStyle

const image = {
  height: 80,
  objectFit: 'cover',
  width: '100%',
} satisfies PdfStyle

const transformed = {
  transform: 'rotate(4deg) scale(1.1) translate(2, 4)',
} satisfies PdfStyle

const retainedTransformSpellings = [
  { transform: 'rotate(0.5rad)' },
  { transform: 'scale(1.1,1.2)' },
  { transform: 'scale(1.1, 1.2)' },
  { transform: 'scale(1.1 1.2)' },
  { transform: 'translate(2,4)' },
  { transform: 'translate(2, 4)' },
  { transform: 'translate(2 4)' },
] as const satisfies readonly PdfStyle[]

const nestedStyles = [
  dimensions,
  false,
  [null, flex, [undefined, boxModel]],
  positioning,
  paintAndBorders,
  text,
  image,
  transformed,
] as const satisfies PdfStyleValue

void nestedStyles
void physicalLength
void retainedTransformSpellings

const unknownKey = {
  // @ts-expect-error Misspelled keys are outside the framework-owned contract.
  backgroundColour: '#fff',
} satisfies PdfStyle

const invalidDimension = {
  // @ts-expect-error `em` is not a unit resolved by the engine.
  width: '2em',
} satisfies PdfStyle

const invalidFlex = {
  // @ts-expect-error Flex direction is a closed engine enum.
  flexDirection: 'diagonal',
} satisfies PdfStyle

const invalidBoxModel = {
  // @ts-expect-error Padding does not accept `auto`.
  padding: 'auto',
} satisfies PdfStyle

const invalidPosition = {
  // @ts-expect-error Browser-only fixed positioning is not supported.
  position: 'fixed',
} satisfies PdfStyle

const needlessStaticPosition = {
  // @ts-expect-error Static positioning is not part of the v1 PDF authoring contract.
  position: 'static',
} satisfies PdfStyle

const invalidBorder = {
  // @ts-expect-error Double borders are not implemented by the engine.
  borderStyle: 'double',
} satisfies PdfStyle

const invalidPaint = {
  // @ts-expect-error Opacity is numeric after style resolution.
  opacity: '0.5',
} satisfies PdfStyle

const invalidText = {
  // @ts-expect-error Browser logical alignment values are not supported.
  textAlign: 'start',
} satisfies PdfStyle

const nonstandardTextTransform = {
  // @ts-expect-error The upstream-only `upperfirst` extension is deliberately not public.
  textTransform: 'upperfirst',
} satisfies PdfStyle

const inertWordSpacing = {
  // @ts-expect-error The pinned text engine ignores word spacing, so it is not public authoring API.
  wordSpacing: 2,
} satisfies PdfStyle

const invalidImage = {
  // @ts-expect-error Only conformance-tested image fit modes are public.
  objectFit: 'stretch',
} satisfies PdfStyle

const invalidTransform = {
  // @ts-expect-error `spin` is not a supported transform operation.
  transform: 'spin(4deg)',
} satisfies PdfStyle

const transformWithMisleadingUnits = {
  // @ts-expect-error translate() is point-based; the engine does not resolve units here.
  transform: 'translate(2px, 4px)',
} satisfies PdfStyle

const invalidArray = [
  dimensions,
  // @ts-expect-error Only false/null/undefined are valid non-style entries.
  true,
] satisfies PdfStyleValue

void unknownKey
void invalidDimension
void invalidFlex
void invalidBoxModel
void invalidPosition
void needlessStaticPosition
void invalidBorder
void invalidPaint
void invalidText
void nonstandardTextTransform
void inertWordSpacing
void invalidImage
void invalidTransform
void transformWithMisleadingUnits
void invalidArray
