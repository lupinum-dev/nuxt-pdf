import { Buffer } from 'node:buffer'

// Shared image-conformance data. Both the React and the Vue fixture import this
// single module so any difference in output belongs to the renderer boundary,
// not to the test inputs. Nothing here touches the filesystem: the JPEG lives as
// a committed binary (images-sample.jpg) whose absolute path the test injects,
// and the PNG travels as base64 so the data: URL and the { data, format } buffer
// source are byte-identical on both sides.

// Intrinsic pixel dimensions of the committed corpus assets. These are facts of
// the binary files (JPEG SOF marker / PNG IHDR) that the layout engine reads to
// derive aspect ratios, so the sizing oracle can be computed instead of guessed.
export const imageDims = {
  jpeg: { width: 48, height: 32, ratio: 48 / 32 },
  png: { width: 40, height: 20, ratio: 40 / 20 },
} as const

// 40x20 PNG: left half blue, right half orange, white 4x4 top-left marker.
// Generated once with @napi-rs/canvas; committed as text so both renderers and a
// code reviewer see the exact same bytes.
export const pngBase64
  = 'iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAYAAAD/Rn+7AAAABHNCSVQICAgIfAhkiAAAAAFzUkdCAK7OHOkAAABMSURBVEiJ7dKxCQAgDAXRKFYO4RTu4eQO4DSxFdszYPFfn3CEJHd3O7SxjJi1o/lbfrotgAKpQn8u2vcXVCClQEqBlAIpBVIKpBRIbbi7B728vF0IAAAAAElFTkSuQmCC'

export const pngDataUri = `data:image/png;base64,${pngBase64}` as const

/**
 * `{ data, format }` buffer source — Buffer is a Uint8Array, so it satisfies
 * the public PdfImageSource type while giving React PDF the Buffer its PNG
 * decoder and its base64 cache key require.
 */
export const pngBufferSource = {
  data: Buffer.from(pngBase64, 'base64'),
  format: 'png' as const,
}

// A4 geometry the sources page pins so the percent-width oracle is deterministic.
export const sourcesPagePadding = 40

// Large square so objectFit's crop-vs-letterbox delta dominates the raster.
export const objectFitBoxSize = 220

export const imageStyles = {
  page: {
    fontFamily: 'Roboto',
    fontSize: 11,
    paddingTop: sourcesPagePadding,
    paddingRight: sourcesPagePadding,
    paddingBottom: sourcesPagePadding,
    paddingLeft: sourcesPagePadding,
  },
  title: {
    fontSize: 16,
    marginBottom: 10,
  },
  caption: {
    fontSize: 9,
    marginBottom: 12,
  },
  // (4) explicit width + height — box is exactly this, independent of ratio.
  jpegExplicit: {
    width: 90,
    height: 60,
    marginBottom: 8,
  },
  // (4) single-dimension aspect scaling — height is derived from width / ratio.
  pngAspectWidth: {
    width: 80,
    marginBottom: 8,
  },
  // (4) percent width — resolved against the page content box; height follows ratio.
  pngPercentWidth: {
    width: '25%' as const,
    marginBottom: 8,
  },
  objectFitRow: {
    flexDirection: 'row' as const,
  },
  // (5) objectFit within a fixed square box — the intrinsic 3:2 landscape image
  // is letterboxed by contain and cropped by cover; box stays square either way.
  // The box is large so the crop-vs-letterbox delta dominates the page and the
  // shared raster threshold reliably catches an objectFit regression.
  objectFitContain: {
    width: objectFitBoxSize,
    height: objectFitBoxSize,
    marginRight: 16,
    objectFit: 'contain' as const,
  },
  objectFitCover: {
    width: objectFitBoxSize,
    height: objectFitBoxSize,
    objectFit: 'cover' as const,
  },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    marginBottom: 14,
  },
  headerImage: {
    width: 36,
    height: 24,
    marginRight: 8,
  },
  headerLabel: {
    fontSize: 10,
  },
  body: {
    fontSize: 11,
    marginBottom: 8,
  },
} as const

// Sizing config the geometry oracle reads back. `pngPercentWidth` is a fraction,
// not points, because the resolved point value depends on the laid-out page box.
export const sizing = {
  jpegExplicit: { width: 90, height: 60 },
  pngWidth: 80,
  pngPercentFraction: 0.25,
} as const

// Text markers used for per-page semantic assertions on the fixed-header doc.
export const headerLabelText = 'Fixed header logo'
export const fixedHeaderBody = {
  first: 'First page body of the repeated-header proof.',
  second: 'Second page body — the fixed header image must repeat here.',
} as const

export const documentMeta = {
  language: 'en',
  creationDate: new Date('2026-07-20T00:00:00.000Z'),
} as const
