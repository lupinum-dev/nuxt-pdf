import { NuxtPdfError, PDF_ERROR_CODES } from '../shared/errors'
import {
  PDF_PRIMITIVES,
  type PdfStyle,
  type PdfStyleValue,
} from '../authoring'
import { PDF_PAGE_SIZE_NAMES } from '../components'
import {
  PDF_PRIMITIVE_NAMES,
  type PdfDocumentNode,
  type PdfElementNode,
  type PdfElementType,
} from './types'

const RESERVED_DESTINATION_IDS = new Set([
  '__proto__',
  'constructor',
  'prototype',
])

const exactStyleKeys = <const Keys extends readonly (keyof PdfStyle)[]>(
  keys: Keys & (
    Exclude<keyof PdfStyle, Keys[number]> extends never
      ? unknown
      : { readonly __missingStyles: Exclude<keyof PdfStyle, Keys[number]> }
  ),
): ReadonlySet<keyof PdfStyle> => new Set(keys)

const PDF_STYLE_KEYS = exactStyleKeys([
  'alignItems',
  'backgroundColor',
  'borderBottomColor',
  'borderBottomLeftRadius',
  'borderBottomRightRadius',
  'borderBottomStyle',
  'borderBottomWidth',
  'borderColor',
  'borderLeftColor',
  'borderLeftStyle',
  'borderLeftWidth',
  'borderRadius',
  'borderRightColor',
  'borderRightStyle',
  'borderRightWidth',
  'borderStyle',
  'borderTopColor',
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderTopStyle',
  'borderTopWidth',
  'borderWidth',
  'bottom',
  'color',
  'flex',
  'flexBasis',
  'flexDirection',
  'flexGrow',
  'flexShrink',
  'flexWrap',
  'fontFamily',
  'fontSize',
  'fontStyle',
  'fontWeight',
  'gap',
  'height',
  'justifyContent',
  'left',
  'letterSpacing',
  'lineHeight',
  'margin',
  'marginBottom',
  'marginHorizontal',
  'marginLeft',
  'marginRight',
  'marginTop',
  'marginVertical',
  'maxHeight',
  'maxLines',
  'maxWidth',
  'minHeight',
  'minWidth',
  'objectFit',
  'opacity',
  'padding',
  'paddingBottom',
  'paddingHorizontal',
  'paddingLeft',
  'paddingRight',
  'paddingTop',
  'paddingVertical',
  'position',
  'right',
  'textAlign',
  'textDecoration',
  'textDecorationColor',
  'textDecorationStyle',
  'textOverflow',
  'textTransform',
  'top',
  'transform',
  'width',
] as const)

const DESTINATION_TYPES = new Set<PdfElementType>([
  PDF_PRIMITIVES.Page,
  PDF_PRIMITIVES.View,
  PDF_PRIMITIVES.Text,
  PDF_PRIMITIVES.Image,
  PDF_PRIMITIVES.Link,
  PDF_PRIMITIVES.Note,
])

const REQUIRED_PROPS: Partial<Record<PdfElementType, readonly string[]>> = {
  [PDF_PRIMITIVES.Path]: ['d'],
  [PDF_PRIMITIVES.Rect]: ['width', 'height'],
  [PDF_PRIMITIVES.Circle]: ['r'],
  [PDF_PRIMITIVES.Ellipse]: ['rx', 'ry'],
  [PDF_PRIMITIVES.Line]: ['x1', 'y1', 'x2', 'y2'],
  [PDF_PRIMITIVES.Polyline]: ['points'],
  [PDF_PRIMITIVES.Polygon]: ['points'],
  [PDF_PRIMITIVES.ClipPath]: ['id'],
  [PDF_PRIMITIVES.LinearGradient]: ['id'],
  [PDF_PRIMITIVES.RadialGradient]: ['id'],
  [PDF_PRIMITIVES.Stop]: ['offset', 'stopColor'],
}

const SVG_NUMERIC_PROPS = [
  'cx',
  'cy',
  'fillOpacity',
  'fx',
  'fy',
  'height',
  'offset',
  'r',
  'rx',
  'ry',
  'stopOpacity',
  'strokeOpacity',
  'strokeWidth',
  'width',
  'x',
  'x1',
  'x2',
  'y',
  'y1',
  'y2',
] as const

const NON_NEGATIVE_SVG_PROPS = new Set([
  'height',
  'r',
  'rx',
  'ry',
  'strokeWidth',
  'width',
])
const UNIT_INTERVAL_SVG_PROPS = new Set([
  'fillOpacity',
  'offset',
  'stopOpacity',
  'strokeOpacity',
])
const FLOW_ONLY_TEXT_PROPS = [
  'bookmark',
  'break',
  'debug',
  'fixed',
  'id',
  'minPresenceAhead',
  'orphans',
  'render',
  'widows',
  'wrap',
] as const
const SVG_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(%?)$/i
const SVG_TRANSFORM_NUMBER = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?`
const SVG_TRANSFORM_OPERATION = String.raw`(?:translate\(${SVG_TRANSFORM_NUMBER}(?:(?:,\s*|\s+)${SVG_TRANSFORM_NUMBER})?\)|rotate\(${SVG_TRANSFORM_NUMBER}\))`
const SVG_TRANSFORM = new RegExp(`^${SVG_TRANSFORM_OPERATION}(?:\\s+${SVG_TRANSFORM_OPERATION}){0,2}$`, 'i')
const SVG_DEFINITION_ID = /^[a-z_][\w.:-]*$/i
const SVG_REFERENCE = /^url\(['"]?#([^'")]+)['"]?\)$/
const PAGE_DIMENSION = /^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:pt|in|mm|cm|px)$/i
const PAGE_SIZE_NAMES = new Set<string>(PDF_PAGE_SIZE_NAMES)

const treeInvalid = (message: string): never => {
  throw new NuxtPdfError(PDF_ERROR_CODES.TreeInvalid, message)
}

const validateDestinationId = (value: unknown): string | undefined => {
  if (value === undefined) return undefined
  if (typeof value === 'string') {
    if (value.trim() === '') {
      treeInvalid('PDF destination ids must be non-empty strings.')
    }
    return value
  }
  return treeInvalid('PDF destination ids must be non-empty strings.')
}

const hasProp = (node: PdfElementNode, key: string): boolean =>
  Object.hasOwn(node.props, key)

const validateRequiredProps = (node: PdfElementNode): void => {
  for (const key of REQUIRED_PROPS[node.type] ?? []) {
    if (!hasProp(node, key)) {
      treeInvalid(`<${PDF_PRIMITIVE_NAMES[node.type]}> requires the "${key}" prop.`)
    }
  }
}

const parseSvgNumber = (value: unknown): { value: number, percent: boolean } | undefined => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? { value, percent: false } : undefined
  }
  if (typeof value !== 'string') return undefined

  const match = SVG_NUMBER.exec(value)
  if (!match) return undefined

  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed)
    ? { value: parsed, percent: match[1] === '%' }
    : undefined
}

const validateSvgNumbers = (node: PdfElementNode): void => {
  for (const key of SVG_NUMERIC_PROPS) {
    if (!hasProp(node, key)) continue

    const parsed = parseSvgNumber(node.props[key])
    if (!parsed) {
      return treeInvalid(`<${PDF_PRIMITIVE_NAMES[node.type]}> has an invalid "${key}" value.`)
    }
    if (NON_NEGATIVE_SVG_PROPS.has(key) && parsed.value < 0) {
      treeInvalid(`<${PDF_PRIMITIVE_NAMES[node.type]}> requires a non-negative "${key}" value.`)
    }
    if (
      UNIT_INTERVAL_SVG_PROPS.has(key)
      && (parsed.value < 0 || parsed.value > (parsed.percent ? 100 : 1))
    ) {
      treeInvalid(`<${PDF_PRIMITIVE_NAMES[node.type]}> requires "${key}" between 0 and 1 (or 0% and 100%).`)
    }
    if (key === 'strokeWidth' && parsed.percent) {
      treeInvalid(`<${PDF_PRIMITIVE_NAMES[node.type]}> does not support a percentage stroke width.`)
    }
  }
}

const validateViewBox = (node: PdfElementNode): void => {
  if (node.type !== PDF_PRIMITIVES.Svg || !hasProp(node, 'viewBox')) return

  const value = node.props.viewBox
  const parts = typeof value === 'string'
    ? value.trim().split(/[\s,]+/).map(Number)
    : []

  if (
    parts.length !== 4
    || parts.some(part => !Number.isFinite(part))
    || parts[2]! <= 0
    || parts[3]! <= 0
  ) {
    treeInvalid('<PdfSvg> viewBox must contain four finite numbers with positive width and height.')
  }
}

const validateSvgTransform = (node: PdfElementNode): void => {
  if (!hasProp(node, 'transform')) return
  const value = node.props.transform
  if (typeof value !== 'string' || !SVG_TRANSFORM.test(value)) {
    treeInvalid(`<${PDF_PRIMITIVE_NAMES[node.type]}> has an unsupported SVG transform.`)
  }
}

const pageDimensionIsPositive = (value: unknown): boolean => {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0
  return typeof value === 'string'
    && PAGE_DIMENSION.test(value)
    && Number.parseFloat(value) > 0
}

const validatePage = (node: PdfElementNode): void => {
  if (node.type !== PDF_PRIMITIVES.Page) return

  if (hasProp(node, 'dpi')) {
    const dpi = node.props.dpi
    if (typeof dpi !== 'number' || !Number.isFinite(dpi) || dpi <= 0) {
      treeInvalid('<PdfPage> dpi must be a positive finite number.')
    }
  }

  if (!hasProp(node, 'size')) return

  const size = node.props.size
  let valid = false

  if (typeof size === 'string') {
    valid = PAGE_SIZE_NAMES.has(size)
  }
  else if (Array.isArray(size)) {
    valid = size.length === 2 && size.every(pageDimensionIsPositive)
  }
  else if (typeof size === 'object' && size !== null) {
    const dimensions = size as Record<string, unknown>
    valid = pageDimensionIsPositive(dimensions.width)
      && pageDimensionIsPositive(dimensions.height)
  }

  if (!valid) {
    treeInvalid('<PdfPage> size must be a known page name or positive width and height.')
  }
}

const validateLinkAndImageSources = (node: PdfElementNode): void => {
  if (node.type === PDF_PRIMITIVES.Image) {
    if (!hasProp(node, 'src')) {
      treeInvalid('<PdfImage> requires a "src" prop.')
    }
  }

  if (node.type === PDF_PRIMITIVES.Link) {
    if (!hasProp(node, 'href')) {
      treeInvalid('<PdfLink> requires an "href" prop.')
    }
    if (typeof node.props.href !== 'string' || node.props.href.trim() === '') {
      treeInvalid('<PdfLink> targets must be non-empty strings.')
    }
  }
}

const validateScalarInvariants = (node: PdfElementNode): void => {
  if (hasProp(node, 'minPresenceAhead')) {
    const value = node.props.minPresenceAhead
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      treeInvalid(`<${PDF_PRIMITIVE_NAMES[node.type]}> minPresenceAhead must be a non-negative finite number.`)
    }
  }

  for (const key of ['break', 'debug', 'fixed', 'wrap'] as const) {
    if (hasProp(node, key) && typeof node.props[key] !== 'boolean') {
      treeInvalid(`<${PDF_PRIMITIVE_NAMES[node.type]}> requires a boolean "${key}" value.`)
    }
  }
}

const validateStyle = (style: PdfStyleValue): void => {
  if (Array.isArray(style)) {
    for (const entry of style) {
      if (entry !== false && entry != null) validateStyle(entry as PdfStyleValue)
    }
    return
  }

  if (typeof style !== 'object' || style === null) {
    treeInvalid('PDF styles must be an object or a nested array of style objects.')
  }

  for (const key of Object.keys(style)) {
    if (!PDF_STYLE_KEYS.has(key as keyof PdfStyle)) {
      treeInvalid(`Unsupported PDF style "${key}".`)
    }
  }
}

const validateTextContext = (
  node: PdfElementNode,
  insideSvg: boolean,
): void => {
  if (node.type === PDF_PRIMITIVES.Tspan && !insideSvg) {
    treeInvalid('<PdfTspan> is only supported inside SVG text.')
  }

  if (node.type !== PDF_PRIMITIVES.Text) return

  if (!insideSvg) {
    if (hasProp(node, 'fill') || hasProp(node, 'x') || hasProp(node, 'y')) {
      treeInvalid('The PdfText fill, x, and y props are only supported inside <PdfSvg>.')
    }
    return
  }

  if (!hasProp(node, 'x') || !hasProp(node, 'y')) {
    treeInvalid('SVG <PdfText> requires both "x" and "y" props.')
  }
  if (FLOW_ONLY_TEXT_PROPS.some(key => hasProp(node, key))) {
    treeInvalid('SVG <PdfText> does not accept page-flow text props.')
  }
}

const validateDefinitionId = (value: unknown): string => {
  if (typeof value !== 'string' || !SVG_DEFINITION_ID.test(value)) {
    return treeInvalid('SVG definition ids must be safe non-empty identifiers.')
  }
  if (RESERVED_DESTINATION_IDS.has(value)) {
    treeInvalid('An SVG definition uses a reserved identifier.')
  }
  return value
}

const validateSvgDefinitions = (svg: PdfElementNode): void => {
  const defs = svg.children.filter(
    child => 'children' in child && child.type === PDF_PRIMITIVES.Defs,
  ) as PdfElementNode[]

  if (defs.length > 1) {
    treeInvalid('<PdfSvg> accepts at most one <PdfDefs> child.')
  }

  const definitions = new Map<string, PdfElementType>()
  for (const definition of defs[0]?.children ?? []) {
    if (!('children' in definition)) continue
    const id = validateDefinitionId(definition.props.id)
    if (definitions.has(id)) treeInvalid('SVG definition ids must be unique within one <PdfSvg>.')
    definitions.set(id, definition.type)
  }

  const pending: PdfElementNode[] = [svg]
  while (pending.length > 0) {
    const node = pending.pop()!

    if (hasProp(node, 'fill') && typeof node.props.fill === 'string') {
      const fill = node.props.fill
      if (fill.startsWith('url(')) {
        const match = SVG_REFERENCE.exec(fill)
        const type = match ? definitions.get(match[1]!) : undefined
        if (
          type !== PDF_PRIMITIVES.LinearGradient
          && type !== PDF_PRIMITIVES.RadialGradient
        ) {
          treeInvalid('An SVG fill references a missing or incompatible definition.')
        }
      }
    }

    if (hasProp(node, 'clipPath')) {
      const clipPath = node.props.clipPath
      const match = typeof clipPath === 'string'
        ? SVG_REFERENCE.exec(clipPath)
        : null
      if (!match || definitions.get(match[1]!) !== PDF_PRIMITIVES.ClipPath) {
        treeInvalid('An SVG clipPath references a missing or incompatible definition.')
      }
    }

    for (const child of node.children) {
      if ('children' in child) pending.push(child)
    }
  }
}

/** Validate invariants that require the complete mounted document tree. */
export const validatePdfDocumentTree = (document: PdfDocumentNode): void => {
  const destinationIds = new Set<string>()
  const internalLinkTargets = new Set<string>()
  let pageCount = 0
  const pending: Array<{ node: PdfElementNode, insideSvg: boolean }> = [{
    node: document,
    insideSvg: false,
  }]

  while (pending.length > 0) {
    const { node, insideSvg } = pending.pop()!
    validateRequiredProps(node)
    validateSvgNumbers(node)
    validateSvgTransform(node)
    validateViewBox(node)
    validatePage(node)
    validateLinkAndImageSources(node)
    validateScalarInvariants(node)
    validateStyle(node.style)
    validateTextContext(node, insideSvg)

    if (node.type === PDF_PRIMITIVES.Svg) validateSvgDefinitions(node)
    if (node.type === PDF_PRIMITIVES.Page) pageCount += 1

    if (node.type === PDF_PRIMITIVES.Link) {
      const target = hasProp(node, 'href') ? node.props.href : node.props.src
      if (typeof target === 'string' && target.startsWith('#')) {
        const id = target.slice(1)
        if (id.trim() === '') {
          treeInvalid('<PdfLink> internal destinations must name a non-empty id.')
        }
        internalLinkTargets.add(id)
      }
    }

    const id = DESTINATION_TYPES.has(node.type)
      ? validateDestinationId(node.props.id)
      : undefined

    if (id !== undefined) {
      if (RESERVED_DESTINATION_IDS.has(id)) {
        treeInvalid('A PDF destination uses a reserved identifier.')
      }
      if (destinationIds.has(id)) {
        treeInvalid('PDF destination ids must be unique within a document.')
      }
      destinationIds.add(id)
    }

    for (const child of node.children) {
      if ('children' in child) {
        pending.push({
          node: child,
          insideSvg: insideSvg || node.type === PDF_PRIMITIVES.Svg,
        })
      }
    }
  }

  if (pageCount === 0) {
    treeInvalid('<PdfDocument> requires at least one <PdfPage>.')
  }

  for (const target of internalLinkTargets) {
    if (!destinationIds.has(target)) {
      treeInvalid('<PdfLink> internal destination does not match any id in the document.')
    }
  }
}
