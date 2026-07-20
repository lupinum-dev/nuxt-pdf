import React from 'react'
import {
  Document,
  Image,
  Page,
  Text,
  View,
} from '@react-pdf/renderer'
import {
  documentMeta,
  fixedHeaderBody,
  headerLabelText,
  imageStyles as styles,
  pngBufferSource,
  pngDataUri,
} from './images-data'

const h = React.createElement

interface ImagesFixtureOptions {
  jpegPath: string
}

// (1) JPEG file source, (2) data: URL source, (3) { data, format } buffer source,
// each paired with a distinct sizing mode: explicit width+height, single-dimension
// aspect scaling, and percent width.
export const createReactSourcesDocument = ({ jpegPath }: ImagesFixtureOptions) => h(
  Document,
  { title: 'Image sources and sizing', ...documentMeta },
  h(
    Page,
    { size: 'A4', style: styles.page },
    h(Text, { style: styles.title }, 'Image sources and sizing'),
    h(Text, { style: styles.caption }, 'JPEG file, data URL, and buffer sources.'),
    h(Image, { src: jpegPath, style: styles.jpegExplicit }),
    h(Image, { src: pngDataUri, style: styles.pngAspectWidth }),
    h(Image, { source: pngBufferSource, style: styles.pngPercentWidth }),
  ),
)

// (5) objectFit contain vs cover over the same intrinsic 3:2 landscape image.
export const createReactObjectFitDocument = ({ jpegPath }: ImagesFixtureOptions) => h(
  Document,
  { title: 'Image objectFit', ...documentMeta },
  h(
    Page,
    { size: 'A4', style: styles.page },
    h(
      View,
      { style: styles.objectFitRow },
      h(Image, { src: jpegPath, style: styles.objectFitContain }),
      h(Image, { src: jpegPath, style: styles.objectFitCover }),
    ),
  ),
)

// (6) An image inside a fixed header, repeated across an explicit page break.
export const createReactFixedHeaderDocument = ({ jpegPath }: ImagesFixtureOptions) => h(
  Document,
  { title: 'Fixed header image', ...documentMeta },
  h(
    Page,
    { size: 'A4', wrap: true, style: styles.page },
    h(
      View,
      { fixed: true, style: styles.header },
      h(Image, { src: jpegPath, style: styles.headerImage }),
      h(Text, { style: styles.headerLabel }, headerLabelText),
    ),
    h(Text, { style: styles.body }, fixedHeaderBody.first),
    h(
      View,
      { break: true },
      h(Text, { style: styles.body }, fixedHeaderBody.second),
    ),
  ),
)
