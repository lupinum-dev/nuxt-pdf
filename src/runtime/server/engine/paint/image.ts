import type { PdfWriter } from '../pdf/writer'
import { clipNode, contentBox } from './box'
import type { MeasuredNode } from '../layout/types'

// The image node: object-fit inside the content box, clipped to the border
// box with its radii. Ported from `@react-pdf/render` 4.5.1.

type Position = number | string | undefined

interface Placement {
  width: number
  height: number
  xOffset: number
  yOffset: number
}

/** `'25%'` as 0.25; anything else falls back to centring (0.5). */
const fraction = (position: Position): number => {
  const match = /(-?\d+(?:\.\d*)?)%/.exec(`${position}`)
  return match ? Number.parseFloat(match[1]!) / 100 : 0.5
}

/** A number is an offset in points; a percentage places the image in the free space. */
const offset = (position: Position, free: number): number =>
  typeof position === 'number' && Number.isFinite(position) ? position : free * fraction(position)

const contain = (cw: number, ch: number, iw: number, ih: number, px: Position, py: Position): Placement => {
  const ratio = iw / ih
  if (cw / ch > ratio) {
    const width = ch * ratio
    return { width, height: ch, xOffset: offset(px, cw - width), yOffset: offset(py, 0) }
  }
  const height = cw / ratio
  return { width: cw, height, xOffset: offset(px, 0), yOffset: offset(py, ch - height) }
}

const cover = (cw: number, ch: number, iw: number, ih: number, px: Position, py: Position): Placement => {
  const ratio = iw / ih
  if (cw / ch > ratio) {
    const height = cw / ratio
    return { width: cw, height, xOffset: offset(px, 0), yOffset: offset(py, ch - height) }
  }
  const width = ch * ratio
  return { width, height: ch, xOffset: offset(px, cw - width), yOffset: offset(py, 0) }
}

const none = (cw: number, ch: number, iw: number, ih: number, px: Position, py: Position): Placement =>
  ({ width: iw, height: ih, xOffset: offset(px, cw - iw), yOffset: offset(py, ch - ih) })

/** `fill` stretches the image; only a numeric position moves it. */
const fill = (cw: number, ch: number, px: Position, py: Position): Placement => ({
  width: cw,
  height: ch,
  xOffset: typeof px === 'number' ? px || 0 : 0,
  yOffset: typeof py === 'number' ? py || 0 : 0,
})

const placement = (fit: string | undefined, cw: number, ch: number, iw: number, ih: number, px: Position, py: Position): Placement => {
  switch (fit) {
    case 'contain': return contain(cw, ch, iw, ih, px, py)
    case 'cover': return cover(cw, ch, iw, ih, px, py)
    case 'none': return none(cw, ch, iw, ih, px, py)
    case 'scale-down': {
      const contained = contain(cw, ch, iw, ih, px, py)
      const natural = none(cw, ch, iw, ih, px, py)
      return contained.width < natural.width ? contained : natural
    }
    default: return fill(cw, ch, px, py)
  }
}

export const renderImage = (writer: PdfWriter, node: MeasuredNode): void => {
  const { box, image, style } = node
  if (!image) return
  const content = contentBox(box)
  writer.save()
  clipNode(writer, node)
  const { width, height, xOffset, yOffset } = placement(
    style?.objectFit,
    content.width,
    content.height,
    image.width,
    image.height,
    style?.objectPositionX,
    style?.objectPositionY,
  )
  if (image.data && width !== 0 && height !== 0) {
    writer.image({ key: image.key, data: image.data }, content.left + xOffset, content.top + yOffset, width, height, style?.opacity ?? 1)
  }
  writer.restore()
}
