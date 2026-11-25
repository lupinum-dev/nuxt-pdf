import { readFileSync } from 'node:fs'
import { defineComponent, h, type Component, type VNode } from 'vue'
import { PDF_COMPONENTS } from '../../src/runtime/components'

// The paint audit:
// every value form and prop the painter reads, each in one of these
// hand-written documents, so that step 2 of E5 compares each one pixel by
// pixel in Poppler between the pdfkit writer and ours. A form is listed once
// per place the painter reads it (a box, a text, an SVG shape). Add a form
// here when validation admits a new one.

const {
  PdfCircle, PdfClipPath, PdfDefs, PdfDocument, PdfEllipse, PdfG, PdfImage, PdfLine,
  PdfLinearGradient, PdfLink, PdfNote, PdfPage, PdfPath, PdfPolygon, PdfPolyline,
  PdfRadialGradient, PdfRect, PdfStop, PdfSvg, PdfText, PdfTspan, PdfView,
} = PDF_COMPONENTS

/** 48 × 32 pixels, JPEG. */
const JPEG = new Uint8Array(readFileSync(new URL('./corpus/images-sample.jpg', import.meta.url)))
/** 700 × 420 pixels, PNG with an alpha channel. */
const PNG = new Uint8Array(readFileSync(new URL('./assets/sample.png', import.meta.url)))

const document = (pages: () => VNode[]): Component =>
  defineComponent(() => () => h(PdfDocument, { title: 'Paint audit' }, pages))

const page = (content: () => VNode[]) => h(PdfPage, { size: 'A4', style: { padding: 24, flexDirection: 'row', flexWrap: 'wrap', gap: 8 } }, content)

const label = (text: string) => h(PdfText, { style: { fontSize: 6, width: '100%' } }, () => text)

/** Every colour form validation admits somewhere, with its alpha. */
export const COLOR_FORMS = [
  '#c33', '#3c3c', '#2a6fdb', '#2a6fdb80',
  'rgb(200, 40, 40)', 'rgb(200, 40, 40, 0.5)', 'rgba(200, 40, 40, 50%)', 'rgb(200 40 40)', 'rgb(200 40 40 / 0.5)',
  'rgb(80%, 15%, 15%)', 'rgb(80% 15% 15% / 50%)',
  'hsl(210, 70%, 50%)', 'hsla(210, 70%, 50%, 0.5)', 'hsl(210deg 70% 50%)', 'hsl(210 70% 50% / 0.5)',
  'hwb(210 10% 20%)', 'hwb(210, 10%, 20%, 0.5)',
  'teal', 'rebeccapurple', 'transparent',
] as const

const colors = document(() => [
  page(() => [
    label('Background, text colour, border colour and SVG fill and stroke of each colour form'),
    ...COLOR_FORMS.map(color => h(PdfView, { style: { width: 120, padding: 4, backgroundColor: color } }, () => [
      h(PdfText, { style: { fontSize: 8, color } }, () => color),
    ])),
    ...COLOR_FORMS.map(color => h(PdfView, { style: { width: 40, height: 24, borderWidth: 3, borderColor: color } })),
    h(PdfSvg, { width: 540, height: 60, viewBox: '0 0 540 60' }, () => COLOR_FORMS.map((color, index) =>
      h(PdfRect, { x: 4 + index * 26, y: 4, width: 20, height: 50, fill: color, stroke: color, strokeWidth: 2, fillOpacity: index % 3 === 0 ? 0.5 : undefined }))),
  ]),
])

const box = (style: Record<string, unknown>, text?: string) =>
  h(PdfView, { style: { width: 120, height: 60, backgroundColor: '#dde7f5', ...style } }, () => text === undefined ? [] : [h(PdfText, { style: { fontSize: 8 } }, () => text)])

const boxes = document(() => [
  page(() => [
    label('Border styles, unequal widths and colours, each radius corner'),
    ...(['solid', 'dashed', 'dotted'] as const).map(borderStyle => box({ borderWidth: 4, borderColor: '#24364f', borderStyle })),
    box({ borderTopWidth: 1, borderRightWidth: 3, borderBottomWidth: 6, borderLeftWidth: 10, borderColor: '#24364f' }),
    box({ borderWidth: 5, borderTopColor: 'red', borderRightColor: 'green', borderBottomColor: 'blue', borderLeftColor: 'orange' }),
    box({ borderTopWidth: 4, borderTopStyle: 'dashed', borderRightWidth: 4, borderRightStyle: 'dotted', borderBottomWidth: 4, borderLeftWidth: 4, borderColor: '#24364f' }),
    box({ borderRadius: 12 }),
    box({ borderTopLeftRadius: 20 }),
    box({ borderTopRightRadius: 20 }),
    box({ borderBottomRightRadius: 20 }),
    box({ borderBottomLeftRadius: 20 }),
    box({ borderTopLeftRadius: '50%', borderBottomRightRadius: 8 }),
    box({ borderRadius: 16, borderWidth: 3, borderColor: '#24364f', borderStyle: 'dashed' }),
    box({ borderRadius: 16, borderTopWidth: 1, borderRightWidth: 4, borderBottomWidth: 8, borderLeftWidth: 2, borderColor: '#24364f' }),
    label('Opacity on a box and on a text, transforms'),
    box({ opacity: 0.4, borderWidth: 2, borderColor: '#24364f' }, 'opacity 0.4 on the box'),
    box({ opacity: 0.6, backgroundColor: 'rgba(36, 54, 79, 0.5)', borderWidth: 4, borderColor: '#24364f80' }, 'alpha 0.5 under opacity 0.6'),
    h(PdfView, { style: { width: 120, height: 60 } }, () => [h(PdfText, { style: { opacity: 0.4, fontSize: 12 } }, () => 'opacity 0.4 on the text')]),
    h(PdfView, { style: { width: 120, height: 60 } }, () => [h(PdfText, { style: { opacity: 0.6, fontSize: 12, color: '#c3380080', textDecoration: 'underline' } }, () => 'alpha 0.5 under opacity 0.6')]),
    box({ transform: 'rotate(15deg)' }, 'rotate 15deg'),
    box({ transform: 'rotate(0.5rad)' }, 'rotate 0.5rad'),
    box({ transform: 'scale(0.6)' }, 'scale 0.6'),
    box({ transform: 'scale(1.2, 0.5)' }, 'scale 1.2 0.5'),
    box({ transform: 'translate(10, 6)' }, 'translate 10 6'),
    box({ transform: 'translate(10, 0) rotate(-10deg) scale(0.8)' }, 'three steps'),
  ]),
])

const decorated = (style: Record<string, unknown>, text: string) =>
  h(PdfText, { style: { fontSize: 14, width: '100%', ...style } }, () => text)

const text = document(() => [
  page(() => [
    label('Text decorations, their styles and colours, run backgrounds, inline images'),
    ...(['underline', 'line-through', 'underline line-through'] as const).flatMap(textDecoration =>
      (['solid', 'dashed', 'dotted'] as const).map(textDecorationStyle =>
        decorated({ textDecoration, textDecorationStyle }, `${textDecoration} ${textDecorationStyle}`))),
    decorated({ textDecoration: 'underline', textDecorationColor: '#c33', color: '#2a6fdb' }, 'underline in another colour'),
    decorated({ textDecoration: 'underline', color: 'rgb(200 40 40 / 0.5)' }, 'translucent text and its underline'),
    h(PdfText, { style: { fontSize: 14, width: '100%' } }, () => [
      'A run ',
      h(PdfText, { style: { backgroundColor: '#ffe08a' } }, () => 'with a background'),
      ', a run ',
      h(PdfText, { style: { backgroundColor: 'hsl(210 70% 50% / 0.3)', textDecoration: 'line-through' } }, () => 'with both'),
      ' and an inline image ',
      h(PdfImage, { src: JPEG, style: { width: 24, height: 16 } }),
      ' in the line.',
    ]),
    decorated({ textAlign: 'justify', letterSpacing: 1.5, textDecoration: 'underline' }, 'Justified and letter-spaced text with an underline, long enough to wrap onto a second line of the page.'),
  ]),
])

const images = document(() => [
  page(() => [
    label('objectFit values in a wide and a tall box, opacity, padding, a PNG with alpha'),
    ...(['contain', 'cover', 'fill', 'none', 'scale-down'] as const).flatMap(objectFit => [
      h(PdfImage, { src: JPEG, style: { width: 100, height: 40, objectFit, backgroundColor: '#dde7f5' } }),
      h(PdfImage, { src: JPEG, style: { width: 40, height: 100, objectFit, backgroundColor: '#dde7f5' } }),
    ]),
    h(PdfImage, { src: JPEG, style: { width: 20, height: 12, objectFit: 'scale-down' } }),
    h(PdfImage, { src: JPEG, style: { width: 100, height: 60, opacity: 0.4 } }),
    h(PdfImage, { src: JPEG, style: { width: 100, height: 60, padding: 10, objectFit: 'contain', backgroundColor: '#dde7f5' } }),
    h(PdfImage, { src: PNG, style: { width: 140, height: 84, backgroundColor: '#24364f' } }),
  ]),
])

const svg = document(() => [
  page(() => [
    label('Each SVG shape and paint prop, groups, text, images, gradients, clip paths'),
    h(PdfSvg, { width: 540, height: 380, viewBox: '0 0 540 380' }, () => [
      h(PdfDefs, null, () => [
        h(PdfLinearGradient, { id: 'linear', x1: 0, y1: 0, x2: 1, y2: 0 }, () => [
          h(PdfStop, { offset: 0, stopColor: '#2a6fdb' }),
          h(PdfStop, { offset: '50%', stopColor: 'hsl(40 90% 60%)', stopOpacity: 0.5 }),
          h(PdfStop, { offset: 1, stopColor: 'rgb(0 128 128 / 0.5)', stopOpacity: 0.8 }),
        ]),
        h(PdfLinearGradient, { id: 'diagonal', x1: 0, y1: 0, x2: 1, y2: 1 }, () => [
          h(PdfStop, { offset: 0, stopColor: 'red' }),
          h(PdfStop, { offset: 1, stopColor: 'blue' }),
        ]),
        h(PdfRadialGradient, { id: 'radial', cx: 0.5, cy: 0.5, r: 0.5, fx: 0.3, fy: 0.3 }, () => [
          h(PdfStop, { offset: 0, stopColor: 'white' }),
          h(PdfStop, { offset: 1, stopColor: '#24364f' }),
        ]),
        h(PdfClipPath, { id: 'circle-clip' }, () => [h(PdfCircle, { cx: 470, cy: 60, r: 40 })]),
        h(PdfClipPath, { id: 'path-clip' }, () => [h(PdfPath, { d: 'M380 140 L520 140 L450 240 Z' })]),
      ]),
      // Shapes
      h(PdfRect, { x: 10, y: 10, width: 60, height: 40, fill: '#2a6fdb' }),
      h(PdfRect, { x: 80, y: 10, width: 60, height: 40, rx: 10, ry: 6, fill: 'none', stroke: '#24364f', strokeWidth: 3 }),
      h(PdfCircle, { cx: 180, cy: 30, r: 20, fill: 'teal', stroke: 'black', strokeWidth: 1 }),
      h(PdfEllipse, { cx: 240, cy: 30, rx: 30, ry: 15, fill: 'rgb(200 40 40)' }),
      h(PdfLine, { x1: 280, y1: 10, x2: 340, y2: 50, stroke: '#c33', strokeWidth: 4 }),
      h(PdfPolyline, { points: '350,50 360,10 370,50 380,10', fill: 'none', stroke: 'black', strokeWidth: 2 }),
      h(PdfPolygon, { points: '390,50 410,10 430,50', fill: 'hsl(120, 50%, 40%)' }),
      h(PdfPath, { d: 'M10 70 h60 v30 h-60 z M20 80 h40 v10 h-40 z', fill: '#24364f' }),
      h(PdfPath, { d: 'M80 100 C80 70 140 70 140 100 S200 130 200 100', fill: 'none', stroke: '#2a6fdb', strokeWidth: 2 }),
      h(PdfPath, { d: 'M210 100 Q235 70 260 100 T310 100', fill: 'none', stroke: '#c33', strokeWidth: 2 }),
      h(PdfPath, { d: 'M320 100 A25 15 30 1 1 360 90 a10 10 0 0 0 10 10 Z', fill: 'none', stroke: 'black', strokeWidth: 1.5 }),
      // Paint props
      ...(['butt', 'round', 'square'] as const).map((strokeLinecap, index) =>
        h(PdfLine, { x1: 20, y1: 130 + index * 16, x2: 120, y2: 130 + index * 16, stroke: '#24364f', strokeWidth: 10, strokeLinecap })),
      ...(['miter', 'round', 'bevel'] as const).map((strokeLinejoin, index) =>
        h(PdfPolyline, { points: `${150 + index * 50},180 ${170 + index * 50},130 ${190 + index * 50},180`, fill: 'none', stroke: '#24364f', strokeWidth: 8, strokeLinejoin })),
      h(PdfRect, { x: 310, y: 130, width: 50, height: 50, fill: '#2a6fdb', fillOpacity: 0.4, stroke: '#c33', strokeOpacity: 0.5, strokeWidth: 6 }),
      // Groups and transforms
      h(PdfG, { transform: 'translate(20, 200) rotate(10)', fill: '#c33', stroke: 'black', strokeWidth: 1 }, () => [
        h(PdfRect, { x: 0, y: 0, width: 50, height: 30 }),
        h(PdfCircle, { cx: 80, cy: 15, r: 15, fill: 'teal' }),
      ]),
      h(PdfRect, { x: 0, y: 0, width: 50, height: 30, fill: '#2a6fdb', transform: 'translate(140 200)' }),
      h(PdfRect, { x: 210, y: 200, width: 50, height: 30, fill: '#24364f', transform: 'rotate(-15) translate(-40, 60)' }),
      // Text and images
      h(PdfText, { x: 20, y: 290, fill: '#24364f', style: { fontSize: 14 } }, () => [
        'SVG text ',
        h(PdfTspan, { fill: '#c33', x: 120, y: 290 }, () => 'and a span'),
      ]),
      h(PdfImage, { src: JPEG, style: { width: 60, height: 40 } }),
      // Gradients and clip paths
      h(PdfRect, { x: 10, y: 320, width: 160, height: 50, fill: 'url(#linear)' }),
      h(PdfCircle, { cx: 220, cy: 345, r: 25, fill: 'url(#radial)' }),
      h(PdfPath, { d: 'M260 320 L330 370 L260 370 Z', fill: 'url(#diagonal)' }),
      h(PdfRect, { x: 420, y: 10, width: 100, height: 100, fill: 'url(#linear)', clipPath: 'url(#circle-clip)' }),
      h(PdfG, { clipPath: 'url(#path-clip)' }, () => [
        h(PdfRect, { x: 370, y: 130, width: 160, height: 120, fill: '#2a6fdb' }),
        h(PdfCircle, { cx: 450, cy: 190, r: 30, fill: 'white' }),
      ]),
    ]),
  ]),
])

const navigation = document(() => [
  page(() => [
    h(PdfText, { id: 'top', bookmark: 'Navigation', style: { fontSize: 16, width: '100%' } }, () => 'Links, notes and bookmarks'),
    h(PdfLink, { href: 'https://example.com/', style: { width: 160, padding: 6, backgroundColor: '#dde7f5' } }, () => [h(PdfText, () => 'A block link to a URI')]),
    h(PdfLink, { href: '#later', hitSlop: { top: 6, right: 6, bottom: 6, left: 6 }, style: { width: 160, padding: 6, backgroundColor: '#dde7f5' } }, () => [h(PdfText, () => 'A block link to a destination')]),
    h(PdfLink, { href: 'mailto:someone@example.com', hitSlop: { top: 2, right: 8, bottom: 4, left: 0 }, style: { width: 160, padding: 6 } }, () => [h(PdfImage, { src: JPEG, style: { width: 48, height: 32 } })]),
    h(PdfText, { style: { width: '100%' } }, () => [
      'An inline ',
      h(PdfLink, { href: 'https://example.com/inline' }, () => 'link to a URI'),
      ' and one ',
      h(PdfLink, { href: '#later' }, () => 'to a destination'),
      ' in a line.',
    ]),
    h(PdfNote, { style: { backgroundColor: '#ffe08a' } }, () => 'A note with a colour'),
    h(PdfNote, null, () => 'A note without one'),
    h(PdfView, { bookmark: { title: 'A group', expanded: true }, style: { width: '100%' } }, () => [
      h(PdfText, { bookmark: 'A child', style: { width: '100%' } }, () => 'A bookmark inside another'),
      h(PdfText, { bookmark: { title: 'A closed child', expanded: false } }, () => 'And a closed one'),
    ]),
  ]),
  page(() => [
    h(PdfText, { id: 'later', bookmark: 'The second page' }, () => 'The destination on the second page'),
  ]),
])

/** The audit documents by name. */
export const PAINT_AUDIT_DOCUMENTS: Readonly<Record<string, Component>> = { colors, boxes, text, images, svg, navigation }
