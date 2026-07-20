import React from 'react'
import {
  Circle,
  ClipPath,
  Defs,
  Document,
  Ellipse,
  G,
  Line,
  LinearGradient,
  Page,
  Path,
  Polygon,
  Polyline,
  RadialGradient,
  Rect,
  Stop,
  Svg,
  Text,
  Tspan,
  View,
} from '@react-pdf/renderer'
import { logo, showcase, svgStyles as styles } from './svg-data'

const h = React.createElement

export const createReactSvgDocument = () => h(
  Document,
  {
    title: 'Nuxt PDF SVG conformance proof',
    language: 'en',
    creationDate: new Date('2026-07-20T00:00:00.000Z'),
  },
  h(
    Page,
    { size: 'A4', style: styles.page },
    h(Text, { style: styles.title }, 'SVG drawing primitives'),
    h(
      Text,
      { style: styles.intro },
      'This page exercises the SVG primitives through the shared layout and render engine so React and Vue produce equivalent output.',
    ),
    h(
      View,
      { style: styles.logoRow },
      h(
        Svg,
        { ...logo.svg, style: styles.logo },
        h(Path, logo.path),
      ),
      h(Text, { style: styles.logoLabel }, 'Inline logo in normal page flow'),
    ),
    h(
      Svg,
      { ...showcase.svg, style: styles.showcase },
      h(
        Defs,
        null,
        h(
          LinearGradient,
          showcase.linearGradient,
          ...showcase.gradientStops.map((stop, index) =>
            h(Stop, { key: `stop-${index}`, ...stop }),
          ),
        ),
        h(
          RadialGradient,
          showcase.radialGradient,
          ...showcase.radialGradientStops.map((stop, index) =>
            h(Stop, { key: `radial-stop-${index}`, ...stop }),
          ),
        ),
        h(
          ClipPath,
          showcase.clipPath,
          h(Circle, showcase.clipCircle),
        ),
      ),
      h(Rect, showcase.gradientRect),
      h(Rect, showcase.radialRect),
      h(Circle, showcase.circle),
      h(Ellipse, showcase.ellipse),
      h(Line, showcase.line),
      h(Polyline, showcase.polyline),
      h(Polygon, showcase.polygon),
      h(Path, showcase.checkPath),
      h(Rect, showcase.clippedRect),
      h(
        G,
        showcase.group,
        ...showcase.groupRects.map((rect, index) =>
          h(Rect, { key: `group-rect-${index}`, ...rect }),
        ),
      ),
      h(
        Text,
        { x: showcase.text.x, y: showcase.text.y, style: showcase.text.style },
        ...showcase.textTspans.map((tspan, index) =>
          h(
            Tspan,
            { key: `tspan-${index}`, ...(tspan.x === undefined ? {} : { x: tspan.x }) },
            tspan.text,
          ),
        ),
      ),
    ),
  ),
)
