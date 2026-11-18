// Props removed with the plain-data document tree. The renderer and the SFC
// compiler both reject them with this one message, so a template author reads
// the same hint at build time and at render time. Vue-free, so build code can
// read it. Temporary; listed in internals/migrations.md.
const REMOVED_PROP_HINTS: Readonly<Record<string, string>> = {
  render: ' Use <PdfPageNumber /> and <PdfPageCount /> inside the text. Use pages="first" or pages="continuation" on a fixed text to show it on some pages only.',
  hyphenationCallback: ' Use :hyphenate="false".',
}

// The template AST keeps an attribute as written (`hyphenation-callback`);
// the renderer receives it camelized.
const camelize = (key: string): string =>
  key.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())

/** Whether `key`, in camel or kebab case, is a removed prop with a migration hint. */
export const isRemovedPdfProp = (key: string): boolean =>
  Object.hasOwn(REMOVED_PROP_HINTS, camelize(key))

/** The error message for a prop that no `Pdf*` component accepts. */
export const unsupportedPdfPropMessage = (key: string, elementName: string): string =>
  `Unsupported prop "${key}" on <${elementName}>.${isRemovedPdfProp(key) ? REMOVED_PROP_HINTS[camelize(key)] : ''}`
