import { NuxtPdfError, PDF_ERROR_CODES } from '../shared/errors'
import type { PdfDocumentNode, PdfElementNode } from './types'

const RESERVED_DESTINATION_IDS = new Set([
  '__proto__',
  'constructor',
  'prototype',
])

const treeInvalid = (message: string): never => {
  throw new NuxtPdfError(PDF_ERROR_CODES.TreeInvalid, message)
}

const validateDestinationId = (value: unknown): string | undefined => {
  if (value === undefined) return undefined
  if (typeof value === 'string') {
    if (value.trim() === '') {
      treeInvalid('PDF destination ids must be non-empty strings.')
    }
    return value
  }
  return treeInvalid('PDF destination ids must be non-empty strings.')
}

/** Validate invariants that require the complete mounted document tree. */
export const validatePdfDocumentTree = (document: PdfDocumentNode): void => {
  const destinationIds = new Set<string>()
  const pending: PdfElementNode[] = [document]

  while (pending.length > 0) {
    const node = pending.pop()!
    const id = validateDestinationId(node.props.id)

    if (id !== undefined) {
      if (RESERVED_DESTINATION_IDS.has(id)) {
        treeInvalid('A PDF destination uses a reserved identifier.')
      }
      if (destinationIds.has(id)) {
        treeInvalid('PDF destination ids must be unique within a document.')
      }
      destinationIds.add(id)
    }

    for (const child of node.children) {
      if ('children' in child) pending.push(child)
    }
  }
}
