import type {
  ParsedPdf,
  ParsedPdfLink,
  PdfOutlineItem,
} from './pdf'

/**
 * Error thrown by the `expectPdf` helpers. Named so test runners surface it like
 * their own assertion errors, without this module depending on any runner.
 */
export class PdfAssertionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PdfAssertionError'
  }
}

export interface ToContainTextOptions {
  /** Restrict the search to a single 1-based page. */
  page?: number
}

export type LinkQuery
  = | { destination: string, page?: number }
    | { url: string, page?: number }
    | { destination: string, url: string, page?: number }

/** A partial outline shape: title is required; state and children are optional. */
export interface OutlineShape {
  title: string
  expanded?: boolean
  children?: OutlineShape[]
}

export interface PdfExpectation {
  toHavePageCount(count: number): PdfExpectation
  toContainText(text: string, options?: ToContainTextOptions): PdfExpectation
  toHaveLink(query: LinkQuery): PdfExpectation
  toHaveOutline(shape: OutlineShape[]): PdfExpectation
}

const truncate = (value: string, max = 200): string =>
  value.length > max ? `${value.slice(0, max)}…` : value

const pageText = (parsed: ParsedPdf, page: number): string | undefined =>
  parsed.pages.find(candidate => candidate.number === page)?.text

const linkMatches = (link: ParsedPdfLink, query: LinkQuery): boolean => {
  if ('destination' in query && link.destination !== query.destination) return false
  if ('url' in query && link.url !== query.url) return false
  if (query.page !== undefined && link.page !== query.page) return false
  return true
}

const describeQuery = (query: LinkQuery): string => {
  const parts: string[] = []
  if ('destination' in query) parts.push(`destination=${JSON.stringify(query.destination)}`)
  if ('url' in query) parts.push(`url=${JSON.stringify(query.url)}`)
  if (query.page !== undefined) parts.push(`page=${query.page}`)
  return parts.join(', ')
}

const describeLinks = (links: readonly ParsedPdfLink[]): string =>
  links.length === 0
    ? '(no links found)'
    : links
        .map(link => `{ page: ${link.page}${link.destination ? `, destination: ${JSON.stringify(link.destination)}` : ''}${link.url ? `, url: ${JSON.stringify(link.url)}` : ''} }`)
        .join(', ')

const outlineMismatch = (
  actual: readonly PdfOutlineItem[],
  shape: readonly OutlineShape[],
  path: string,
): string | undefined => {
  if (actual.length !== shape.length) {
    return `expected ${shape.length} item(s) at ${path}, found ${actual.length} `
      + `(${actual.map(item => JSON.stringify(item.title)).join(', ') || 'none'})`
  }

  for (let index = 0; index < shape.length; index += 1) {
    const expected = shape[index]!
    const found = actual[index]!
    const here = `${path}[${index}]`

    if (found.title !== expected.title) {
      return `expected outline title ${JSON.stringify(expected.title)} at ${here}, `
        + `found ${JSON.stringify(found.title)}`
    }

    if (expected.expanded !== undefined && found.expanded !== expected.expanded) {
      return `expected outline expanded=${expected.expanded} at ${here}, `
        + `found ${String(found.expanded)}`
    }

    if (expected.children !== undefined) {
      const nested = outlineMismatch(found.children, expected.children, `${here}.children`)
      if (nested) return nested
    }
  }

  return undefined
}

/**
 * Fluent, runner-agnostic assertions over a `ParsedPdf`. Every method returns the
 * same expectation so calls chain, and throws a `PdfAssertionError` on failure
 * with a message naming what was expected and what the document actually holds.
 */
export function expectPdf(parsed: ParsedPdf): PdfExpectation {
  const expectation: PdfExpectation = {
    toHavePageCount(count) {
      if (parsed.pageCount !== count) {
        throw new PdfAssertionError(
          `Expected the PDF to have ${count} page(s), but it has ${parsed.pageCount}.`,
        )
      }
      return expectation
    },

    toContainText(text, options = {}) {
      if (options.page !== undefined) {
        const target = pageText(parsed, options.page)
        if (target === undefined) {
          throw new PdfAssertionError(
            `Expected text ${JSON.stringify(text)} on page ${options.page}, `
            + `but the PDF has no page ${options.page} (page count: ${parsed.pageCount}).`,
          )
        }
        if (!target.includes(text)) {
          throw new PdfAssertionError(
            `Expected page ${options.page} to contain ${JSON.stringify(text)}, `
            + `but its text was ${JSON.stringify(truncate(target))}.`,
          )
        }
        return expectation
      }

      const found = parsed.pages.some(page => page.text.includes(text))
      if (!found) {
        const all = parsed.pages.map(page => `p${page.number}: ${truncate(page.text, 120)}`).join(' | ')
        throw new PdfAssertionError(
          `Expected some page to contain ${JSON.stringify(text)}, but none did. Pages: ${all}`,
        )
      }
      return expectation
    },

    toHaveLink(query) {
      if (!parsed.links.some(link => linkMatches(link, query))) {
        throw new PdfAssertionError(
          `Expected a link matching { ${describeQuery(query)} }, `
          + `but found: ${describeLinks(parsed.links)}.`,
        )
      }
      return expectation
    },

    toHaveOutline(shape) {
      const mismatch = outlineMismatch(parsed.outline, shape, 'outline')
      if (mismatch) {
        throw new PdfAssertionError(`Outline did not match: ${mismatch}.`)
      }
      return expectation
    },
  }

  return expectation
}
