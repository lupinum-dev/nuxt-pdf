import type PDFDocument from '@react-pdf/pdfkit'

// Same tree and same `creationDate` → same bytes. pdfkit breaks this in three
// places (CONTRACTS.md, "Reproducible output"):
//
// 1. Each embedded font subset gets a name with six random letters
//    (`Math.random`), written as `FontName` of the descriptor and `BaseFont` of
//    the CID font and the Type0 font.
// 2. A compressed stream is deflated by an asynchronous zlib stream and written
//    when its deflate ends. Several streams in flight end in the order the
//    thread pool completes them (attachments, fonts, page contents).
// 3. A PNG with transparency (or interlacing) is inflated asynchronously; the
//    callback creates the soft mask object and writes it and the image. With
//    several such images, both the object order and the soft mask object
//    numbers follow whichever inflate ends first.
//
// The fix holds every asynchronous write back and releases it in a fixed
// order: the streams in the order `end()` was called, then the image callbacks
// in the order the images were embedded. Painting is synchronous, so every
// stream has been ended before the first callback can run; the order of a
// render without competing writes stays what it was. All of it is wrapped on
// our own document instance: no global `Math.random`, no change to what is
// compressed or how.

/** pdfkit's subset prefix: six uppercase letters and `+` (ISO 32000-1, 9.6.4). */
const SUBSET_TAG = /^[A-Z]{6}\+/

/** The n-th subset tag: AAAAAA, AAAAAB, … (base 26, six letters). */
const subsetTag = (index: number): string => {
  let tag = ''
  let rest = index
  for (let position = 0; position < 6; position++) {
    tag = String.fromCharCode(65 + (rest % 26)) + tag
    rest = Math.floor(rest / 26)
  }
  return tag
}

const FONT_NAME_KEYS = ['FontName', 'BaseFont'] as const

interface HeldWrite {
  run: (() => void) | undefined
}

export const makeOutputReproducible = (context: PDFDocument): void => {
  // Random subset name → deterministic name, in order of first appearance.
  const subsetNames = new Map<string, string>()
  const renameSubset = (data: Record<string, unknown>): void => {
    for (const key of FONT_NAME_KEYS) {
      const name = data[key]
      if (typeof name !== 'string' || !SUBSET_TAG.test(name)) continue
      let stable = subsetNames.get(name)
      if (stable === undefined) {
        stable = subsetTag(subsetNames.size) + name.slice(6)
        subsetNames.set(name, stable)
      }
      data[key] = stable
    }
  }

  // `run` is set when the asynchronous work is done; the head runs first.
  const streams: HeldWrite[] = []
  const images: HeldWrite[] = []
  const release = (): void => {
    for (const queue of [streams, images]) {
      while (queue[0]?.run !== undefined) queue.shift()!.run!()
      if (queue.length > 0) return
    }
  }

  const ref = context.ref.bind(context)
  context.ref = (data) => {
    const object = ref(data)
    const finalize = object.finalize
    const end = object.end.bind(object)
    const held: HeldWrite = { run: undefined }
    object.finalize = () => {
      renameSubset(object.data)
      // Without a deflate stream, `end()` writes the object at once.
      if (object.deflate === null) {
        finalize()
        return
      }
      held.run = finalize
      release()
    }
    object.end = (chunk) => {
      end(chunk)
      // `end()` created the deflate stream (or earlier writes did): the object
      // is written when the deflate ends, so it waits its turn.
      if (object.deflate !== null) streams.push(held)
    }
    return object
  }

  const openImage = context.openImage.bind(context)
  context.openImage = (src) => {
    const image = openImage(src)
    const png = image.image
    const decodePixels = png?.decodePixels
    if (png == null || decodePixels === undefined) return image
    png.decodePixels = (done) => {
      const held: HeldWrite = { run: undefined }
      images.push(held)
      decodePixels.call(png, (pixels) => {
        held.run = () => done(pixels)
        release()
      })
    }
    return image
  }
}
