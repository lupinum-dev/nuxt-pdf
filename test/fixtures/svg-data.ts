// Shared geometry and styles for the paired React/Vue SVG conformance fixture.
// Both fixtures build the identical node tree so any difference belongs to the
// renderer boundary, not the test data.

export const svgStyles = {
  page: {
    fontFamily: 'Roboto',
    fontSize: 11,
    paddingTop: 48,
    paddingRight: 42,
    paddingBottom: 48,
    paddingLeft: 42,
  },
  title: {
    fontSize: 22,
    marginBottom: 12,
    color: '#17212b',
  },
  intro: {
    fontSize: 11,
    lineHeight: 1.45,
    marginBottom: 12,
  },
  logoRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    marginBottom: 14,
  },
  logoLabel: {
    fontSize: 11,
    marginLeft: 10,
  },
  logo: {
    width: 28,
    height: 28,
  },
  showcase: {
    width: 300,
    height: 300,
  },
}

// A checkmark logo placed in normal page flow to prove Svg is a flex leaf
// measured from its viewBox aspect ratio.
export const logo = {
  svg: { viewBox: '0 0 24 24' },
  path: {
    d: 'M4 12 l6 6 l10 -14',
    stroke: '#2a9d8f',
    strokeWidth: 3,
    fill: 'none',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  },
}

// Main showcase drawn in a 200x200 user space.
export const showcase = {
  svg: { viewBox: '0 0 200 200' },
  linearGradient: {
    id: 'brand',
    x1: '0',
    y1: '0',
    x2: '1',
    y2: '0',
  },
  gradientStops: [
    { offset: '0', stopColor: '#e63946' },
    { offset: '1', stopColor: '#457b9d', stopOpacity: '0.85' },
  ],
  clipPath: { id: 'badge' },
  clipCircle: { cx: 45, cy: 45, r: 38 },
  gradientRect: {
    x: 10,
    y: 10,
    width: 80,
    height: 50,
    rx: 8,
    ry: 8,
    fill: 'url(#brand)',
  },
  circle: {
    cx: 150,
    cy: 40,
    r: 30,
    fill: '#2a9d8f',
    stroke: '#264653',
    strokeWidth: 3,
  },
  ellipse: { cx: 150, cy: 110, rx: 40, ry: 18, fill: '#e9c46a' },
  line: { x1: 10, y1: 78, x2: 90, y2: 78, stroke: '#264653', strokeWidth: 2 },
  polyline: {
    points: '10,98 30,118 50,98 70,118',
    stroke: '#e76f51',
    strokeWidth: 2,
    fill: 'none',
  },
  polygon: { points: '10,140 40,140 25,170', fill: '#f4a261' },
  checkPath: {
    d: 'M110 150 l14 14 l30 -34',
    stroke: '#2a9d8f',
    strokeWidth: 4,
    fill: 'none',
  },
  group: {
    transform: 'translate(150,150) rotate(15)',
    fill: '#8338ec',
  },
  groupRects: [
    { x: -20, y: -20, width: 18, height: 18 },
    { x: 4, y: 4, width: 18, height: 18, fillOpacity: '0.6' },
  ],
  clippedRect: {
    x: 8,
    y: 8,
    width: 90,
    height: 90,
    fill: '#ff006e',
    clipPath: 'url(#badge)',
  },
  text: {
    x: 100,
    y: 195,
    style: { fontFamily: 'Roboto', fontSize: 12, color: '#1d3557' },
  },
  textTspans: [
    { text: 'Hello ' },
    { x: 132, text: 'world' },
  ],
}
