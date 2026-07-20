export const conformanceLines = [
  { id: 'alpha', label: 'Alpha service', amount: 'EUR 120.00' },
  { id: 'beta', label: 'Beta support', amount: 'EUR 80.00' },
  { id: 'gamma', label: 'Gamma hosting', amount: 'EUR 40.00' },
]

export const conformanceParagraphs = [
  'Nuxt PDF turns structured application data into a document tree. This paragraph is deliberately long enough to exercise text measurement, line breaking, and normal page flow while keeping the fixture readable. The same content is mounted by React and Vue so differences belong to the renderer boundary rather than the test data.',
  'A compatibility kernel should be boring. Vue creates plain PDF nodes, the existing layout engine resolves dimensions and pagination, and the renderer paints the result. Nuxt-specific discovery and delivery sit outside this fixture because this document proves the lower-level contract first.',
  'The fixture also contains keyed rows, conditional content, a local image, a local font, a fixed footer, a dynamic page count, a link, and an explicit page break. Each behavior has a semantic assertion next to the visual comparison.',
]

export const conformanceStyles = {
  page: {
    fontFamily: 'Roboto',
    fontSize: 11,
    paddingTop: 54,
    paddingRight: 42,
    paddingBottom: 58,
    paddingLeft: 42,
  },
  header: {
    position: 'absolute' as const,
    top: 22,
    left: 42,
    right: 42,
    color: '#65717c',
    fontSize: 8,
  },
  title: {
    fontSize: 24,
    marginBottom: 14,
    color: '#17212b',
  },
  image: {
    width: 140,
    height: 84,
    marginBottom: 14,
  },
  paragraph: {
    fontSize: 11,
    lineHeight: 1.45,
    marginBottom: 10,
  },
  section: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#cbd3da',
  },
  sectionTitle: {
    fontSize: 15,
    marginBottom: 8,
    color: '#263746',
  },
  row: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    paddingTop: 4,
    paddingBottom: 4,
  },
  conditional: {
    marginTop: 8,
    color: '#375b45',
  },
  link: {
    marginTop: 12,
    color: '#2457a6',
  },
  footer: {
    position: 'absolute' as const,
    left: 42,
    right: 42,
    bottom: 22,
    textAlign: 'center' as const,
    color: '#65717c',
    fontSize: 8,
  },
}
