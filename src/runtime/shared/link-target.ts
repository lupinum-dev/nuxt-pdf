/** The URI schemes a link may open, for `PdfLink` and for rich text. */
export const LINK_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:'] as const

/**
 * Whether a link target is an absolute `http:`, `https:`, `mailto:` or `tel:`
 * URL. Leading and trailing whitespace is ignored, as a browser does; anything
 * else (a relative path, `#id`, `javascript:`, `file:`, a scheme with a tab or
 * a control character inside) is not on the list. Link targets often come from
 * data, and a PDF reader must not get a script or file URI from a template.
 */
export const isAllowedLinkUri = (href: string): boolean => {
  const target = href.trim().toLowerCase()
  for (let index = 0; index < target.length; index += 1) {
    const code = target.charCodeAt(index)
    // A control character is never part of a URL; a PDF reader would get it as written.
    if (code < 32 || code === 127) return false
  }
  return LINK_SCHEMES.some(scheme => target.startsWith(scheme) && target.length > scheme.length)
}
