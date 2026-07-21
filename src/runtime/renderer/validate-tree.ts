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

/** Validate invariants that require the complete mounted document tree. */
export const validatePdfDocumentTree = (document: PdfDocumentNode): void => {
  const destinationIds = new Set<string>()
  const pending: PdfElementNode[] = [document]

  while (pending.length > 0) {
    const node = pending.pop()!
    const id = node.props.id

    if (id !== undefined) {
      if (typeof id !== 'string') {
        treeInvalid('PDF destination ids must be non-empty strings.')
      }
      if (id.trim() === '') {
        treeInvalid('PDF destination ids must be non-empty strings.')
      }
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
