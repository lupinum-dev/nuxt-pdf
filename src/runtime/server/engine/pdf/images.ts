import { pdfImage, type ImageHeader, type PdfImage } from '../image'
import type { PageContent } from './content'
import type { PdfFile } from './file'
import { formatNumber as n, type PdfRef } from './objects'
import type { ImageSource, Matrix } from './writer'
import { countWork } from '../work'

// Images in our writer: one XObject per image, placed as pdfkit's `image()`
// placed it. Decoding is `../image`.

/** The image XObject, with its palette and its alpha (`SMask`). */
const writeImage = (file: PdfFile, image: PdfImage): PdfRef => {
  const { width, height, colorSpace } = image
  const alpha = image.alpha === undefined
    ? undefined
    : file.stream({ Type: 'XObject', Subtype: 'Image', Width: width, Height: height, BitsPerComponent: 8, ColorSpace: 'DeviceGray', Decode: [0, 1], Filter: 'FlateDecode' }, image.alpha)
  return file.stream({
    Type: 'XObject',
    Subtype: 'Image',
    Width: width,
    Height: height,
    BitsPerComponent: image.bitsPerComponent,
    ColorSpace: typeof colorSpace === 'string' ? colorSpace : ['Indexed', 'DeviceRGB', colorSpace.palette.length / 3 - 1, file.stream({}, colorSpace.palette)],
    Filter: image.filter,
    DecodeParms: image.decodeParms,
    Decode: image.decode,
    Mask: image.mask,
    SMask: alpha,
  }, image.data)
}

/** How an image fills its place: stretched to `width` and `height` (either may be missing), or fitted into a box. */
export interface ImageSize {
  width?: number
  height?: number
  fit?: readonly [number, number]
}

/**
 * pdfkit's `image()` placement: `width` and `height` stretch the image; one
 * of them keeps its ratio; `fit` scales it into the box, centred, at the
 * bottom. Then the EXIF orientation turns and flips it in place.
 */
const imageMatrices = (image: ImageHeader, x: number, y: number, size: ImageSize): Matrix[] => {
  const [width, height] = image.orientation > 4 ? [image.height, image.width] : [image.width, image.height]
  let w = size.width || width
  let h = size.height || height
  if (size.width && !size.height) {
    const scale = w / width
    w = width * scale
    h = height * scale
  }
  else if (size.height && !size.width) {
    const scale = h / height
    w = width * scale
    h = height * scale
  }
  else if (size.fit) {
    const [boxWidth, boxHeight] = size.fit
    const ratio = width / height
    if (ratio > boxWidth / boxHeight) {
      w = boxWidth
      h = boxWidth / ratio
    }
    else {
      h = boxHeight
      w = boxHeight * ratio
    }
    x = x + boxWidth / 2 - w / 2
    y = y + boxHeight - h
  }
  // The image space has its origin at the bottom left, the painter's at the top left.
  const [originX, originY] = [x, y]
  let angle = 0
  switch (image.orientation) {
    case 2:
      w = -w
      h = -h
      x -= w
      y -= h
      break
    case 3:
      h = -h
      x -= w
      angle = 180
      break
    case 4:
      break
    case 5:
      [w, h] = [h, w]
      y -= h
      angle = 90
      break
    case 6:
      [w, h] = [h, -w]
      angle = 90
      break
    case 7:
      [w, h] = [-h, -w]
      x -= w
      angle = 90
      break
    case 8:
      [w, h] = [h, -w]
      x -= w
      y -= h
      angle = -90
      break
    default:
      h = -h
      y -= h
  }
  const matrices: Matrix[] = []
  if (angle !== 0) {
    const radians = angle * Math.PI / 180
    const [cos, sin] = [Math.cos(radians), Math.sin(radians)]
    matrices.push([cos, sin, -sin, cos, originX - (originX * cos - originY * sin), originY - (originX * sin + originY * cos)])
  }
  matrices.push([w, 0, 0, h, x, y])
  return matrices
}

/** Draws images on the current page; one XObject per key, or per byte array without one, decoded once. */
export const createImages = (file: PdfFile, content: PageContent): (source: ImageSource, x: number, y: number, size: ImageSize) => void => {
  const images = new Map<unknown, { name: string, ref: PdfRef, header: ImageHeader }>()
  return (source, x, y, size) => {
    const identity = source.key ?? source.data
    let entry = images.get(identity)
    if (entry === undefined) {
      if (!(source.data instanceof Uint8Array)) throw new TypeError('Nuxt PDF can only embed an image from its bytes.')
      const image = pdfImage(source.data)
      countWork('imagesEmbedded')
      entry = { name: `I${images.size + 1}`, ref: writeImage(file, image), header: image }
      images.set(identity, entry)
    }
    content.current().images.set(entry.name, entry.ref)
    content.write('q')
    for (const matrix of imageMatrices(entry.header, x, y, size)) content.write(`${matrix.map(n).join(' ')} cm`)
    content.write(`/${entry.name} Do`)
    content.write('Q')
  }
}
