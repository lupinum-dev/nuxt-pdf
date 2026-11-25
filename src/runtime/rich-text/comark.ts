// comark input: a document that comark parsed (`{ frontmatter, meta, nodes }`)
// or its node list, as a project that parses its content for the web already
// has it. The shape is checked first, then the same mapping as for HTML runs
// (allowlist and limits). No parser runs here, and the `comark` package is not
// needed.

import { describePdfValue } from '../shared/describe-value'
import type { PdfRichSourceNode } from './html'
import {
  limitIssue,
  MAX_RICH_TEXT_DEPTH,
  MAX_RICH_TEXT_ISSUES,
  MAX_RICH_TEXT_LENGTH,
  MAX_RICH_TEXT_NODES,
  richTextInvalid,
} from './limits'
import { mapRichTextTree, type PdfRichTreeSource } from './map'
import type { PdfRichBlock, PdfRichTextIssue } from './types'
import { isRecord, StopWalk } from './validate'
import { createRichTextWarnings, type RichTextWarnings } from './warnings'

/**
 * A comark node list, checked and copied: each node a string or
 * `[tag, props, ...children]` with a non-empty tag string and a props object.
 * comark writes an HTML comment as `[null, props, text]`; the copy leaves it
 * out. Fails with `PDF_RICH_TEXT_INVALID` for any other shape and over the
 * limits; issues name the path (`comark.nodes[2][3]`, the index in the array)
 * and the wrong value, never the text.
 */
export const checkedComarkNodes = (nodes: unknown, path: string): PdfRichSourceNode[] => {
  const issues: PdfRichTextIssue[] = []
  let count = 0
  let characters = 0
  const wrong = (at: string, message: string): void => {
    issues.push({ rule: 'PDF-RICH-NODE', path: at, message })
    if (issues.length >= MAX_RICH_TEXT_ISSUES) throw new StopWalk()
  }
  const limit = (at: string, message: string): never => {
    issues.push(limitIssue(at, message))
    throw new StopWalk()
  }

  /** The checked copy of a node, or undefined for a comment or a wrong node. */
  const node = (value: unknown, at: string, depth: number): PdfRichSourceNode | undefined => {
    if (depth > MAX_RICH_TEXT_DEPTH) limit(at, `nesting depth ${depth} is over the limit of ${MAX_RICH_TEXT_DEPTH}`)
    count += 1
    if (count > MAX_RICH_TEXT_NODES) limit(at, `${count} nodes are over the limit of ${MAX_RICH_TEXT_NODES}`)
    if (typeof value === 'string') {
      characters += value.length
      if (characters > MAX_RICH_TEXT_LENGTH) limit(at, `the text is longer than the limit of ${MAX_RICH_TEXT_LENGTH} characters`)
      return value
    }
    if (!Array.isArray(value)) {
      wrong(at, `expected a text or a [tag, props, ...children] node, found ${describePdfValue(value)}`)
      return undefined
    }
    const [tag, props] = value
    if (tag === null && isRecord(props)) return undefined
    const children = list(value, at, depth + 1, 2)
    if (typeof tag !== 'string' || tag === '') wrong(`${at}[0]`, `expected a tag name, found ${describePdfValue(tag)}`)
    else if (!isRecord(props)) wrong(`${at}[1]`, `expected a props object, found ${describePdfValue(props)}`)
    else return [tag, props, ...children]
    return undefined
  }

  const list = (values: readonly unknown[], at: string, depth: number, from: number): PdfRichSourceNode[] => {
    const copy: PdfRichSourceNode[] = []
    for (let index = from; index < values.length; index += 1) {
      const checked = node(values[index], `${at}[${index}]`, depth)
      if (checked !== undefined) copy.push(checked)
    }
    return copy
  }

  let copy: PdfRichSourceNode[] = []
  try {
    if (!Array.isArray(nodes)) wrong(path, `expected a list of comark nodes, found ${describePdfValue(nodes)}`)
    else copy = list(nodes, path, 1, 0)
  }
  catch (error) {
    if (!(error instanceof StopWalk)) throw error
  }
  if (issues.length > 0) throw richTextInvalid(issues)
  return copy
}

/**
 * The model of a comark document (the object with `nodes`) or node list. Tags
 * that are not HTML element names become component blocks.
 */
export const mapComark = (value: unknown, source: PdfRichTreeSource = 'comark', warnings: RichTextWarnings = createRichTextWarnings()): PdfRichBlock[] => {
  const nodes = isRecord(value) && 'nodes' in value ? value.nodes : value
  const path = nodes === value ? source : `${source}.nodes`
  return mapRichTextTree(checkedComarkNodes(nodes, path), source, warnings)
}
