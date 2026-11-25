import { camelCase } from './case'

// Props removed with the plain-data document tree. The renderer and the SFC
// compiler both reject them with this one message, so a template author reads
// the same hint at build time and at render time. Vue-free, so build code can
// read it. Temporary; listed in internals/migrations.md.
const HYPHENS_HINT = ' Words split only at their soft hyphens, unless the style key hyphens: "auto" splits them by the patterns of the document language.'

const REMOVED_PROP_HINTS: Readonly<Record<string, string>> = {
  render: ' Use <PdfPageNumber /> and <PdfPageCount /> inside the text. Use pages="first" or pages="continuation" on a fixed text to show it on some pages only.',
  hyphenationCallback: HYPHENS_HINT,
  hyphenate: HYPHENS_HINT,
}

// The template AST keeps an attribute as written (`hyphenation-callback`);
// the renderer receives it camelized.

/** Whether `key`, in camel or kebab case, is a removed prop with a migration hint. */
export const isRemovedPdfProp = (key: string): boolean =>
  Object.hasOwn(REMOVED_PROP_HINTS, camelCase(key))

/** The error message for a prop that no `Pdf*` component accepts. */
export const unsupportedPdfPropMessage = (key: string, elementName: string): string =>
  `Unsupported prop "${key}" on <${elementName}>.${isRemovedPdfProp(key) ? REMOVED_PROP_HINTS[camelCase(key)] : ''}`
