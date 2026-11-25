// Helpers of every validate-*.ts file: the wrong value in a message, own
// props, plain objects and destination ids.
import { PDF_CONTENTS_ID_PREFIX, PDF_FOOTNOTE_ID_PREFIX } from '../primitives'
import { describePdfValue } from '../shared/describe-value'
import { treeInvalid } from '../shared/errors'
import type { PdfElementNode } from './types'

export const RESERVED_DESTINATION_IDS = new Set([
  '__proto__',
  'constructor',
  'prototype',
])

/** The wrong value at the end of a message (see `describePdfValue` for what it must never get). */
export const got = (value: unknown): string => ` Got ${describePdfValue(value)}.`

export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const validateDestinationId = (value: unknown, label: string): string | undefined => {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim() === '') {
    return treeInvalid(`<${label}> "id" must be a non-empty string.${got(value)}`)
  }
  if (RESERVED_DESTINATION_IDS.has(value)) {
    treeInvalid(`<${label}> uses a reserved identifier as its id; use another id.`)
  }
  if (value.startsWith(PDF_FOOTNOTE_ID_PREFIX)) {
    treeInvalid(`<${label}> has an id that starts with "${PDF_FOOTNOTE_ID_PREFIX}", which the notes of footnotes use. Use another id.`)
  }
  if (value.startsWith(PDF_CONTENTS_ID_PREFIX)) {
    treeInvalid(`<${label}> has an id that starts with "${PDF_CONTENTS_ID_PREFIX}", which the entries of a <PdfContents> use. Use another id.`)
  }
  return value
}

export const hasProp = (node: PdfElementNode, key: string): boolean =>
  Object.hasOwn(node.props, key)
