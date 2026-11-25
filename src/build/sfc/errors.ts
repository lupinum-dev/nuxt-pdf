// Compile errors with their position in the authored file, from Vue, Babel and the bundler.

import type { SFCBlock, SFCScriptBlock } from '@vue/compiler-sfc'
import { isAbsolute } from 'node:path'
import { forwardSlashes } from '../../runtime/shared/paths'
import type { AstLocation, AstNode } from './script-ast'

export class PdfSfcCompileError extends Error {
  readonly column: number
  /** The message without the `[nuxt-pdf] file:line:column` prefix. */
  readonly detail: string
  readonly filename: string
  readonly line: number

  constructor(filename: string, line: number, column: number, message: string) {
    // One path form in every message, on every platform (see forwardSlashes).
    const file = forwardSlashes(filename)
    super(`[nuxt-pdf] ${file}:${line}:${column} ${message}`)
    this.name = 'PdfSfcCompileError'
    this.detail = message
    this.filename = file
    this.line = line
    this.column = column
  }
}

/**
 * The one place a bundler error becomes a position: esbuild's
 * `errors[0].location` or Rollup's `loc`, both with a 0-based column. `id` is
 * the module the bundler worked on, for an error without an absolute file.
 */
export function bundlerError(error: unknown, id: string): PdfSfcCompileError {
  const first = isRecord(error) && Array.isArray(error.errors) && error.errors.length > 0 ? error.errors[0] : error
  const location = isRecord(first) && isRecord(first.location)
    ? first.location
    : isRecord(error) && isRecord(error.loc) ? error.loc : undefined
  const file = typeof location?.file === 'string' && isAbsolute(location.file) ? location.file : id
  return new PdfSfcCompileError(
    forwardSlashes(file),
    typeof location?.line === 'number' ? location.line : 1,
    typeof location?.column === 'number' ? location.column + 1 : 1,
    errorMessage(first),
  )
}

/** A 1-based line and column. */
export type FilePosition = { line: number, column: number }

/**
 * A 1-based position inside a block's content as the position in the file:
 * lines count from the block's first line, and only the first line starts at
 * the block's column.
 */
export function blockPosition(block: SFCBlock, position: FilePosition): FilePosition {
  return {
    line: block.loc.start.line + position.line - 1,
    column: position.line === 1 ? block.loc.start.column + position.column - 1 : position.column,
  }
}

/** The file position of a Babel node of a script block. Babel counts columns from 0. */
export function nodePosition(block: SFCScriptBlock, node: AstNode): FilePosition {
  return blockPosition(block, { line: node.loc?.start.line ?? 1, column: (node.loc?.start.column ?? 0) + 1 })
}

export function errorAtNode(
  filename: string,
  block: SFCScriptBlock,
  node: AstNode,
  message: string,
): PdfSfcCompileError {
  const { line, column } = nodePosition(block, node)
  return new PdfSfcCompileError(filename, line, column, message)
}

export function errorAtBlock(
  filename: string,
  block: SFCBlock,
  message: string,
): PdfSfcCompileError {
  return new PdfSfcCompileError(
    filename,
    block.loc.start.line,
    block.loc.start.column,
    message,
  )
}

export function errorAtTemplateNode(
  filename: string,
  node: { loc: AstLocation },
  message: string,
): PdfSfcCompileError {
  return new PdfSfcCompileError(filename, node.loc.start.line, node.loc.start.column, message)
}

/**
 * The one place a Vue, Babel or compiler-sfc error becomes a position in the
 * authored file. `block` is set for errors of a block compiled on its own
 * (the template outside `<script setup>`), whose lines start at the block.
 */
export function normalizeCompilerError(error: unknown, filename: string, block?: SFCBlock): Error {
  if (error instanceof PdfSfcCompileError) return error

  const location = errorLocation(error) ?? { column: 1, line: 1 }
  const { column, line } = block ? blockPosition(block, location) : location
  return new PdfSfcCompileError(filename, line, column, compilerMessage(error, filename))
}

/**
 * The 1-based position of a compiler error. Vue errors carry `loc.start` with a
 * 1-based column; Babel errors carry `loc` with a 0-based column.
 */
function errorLocation(error: unknown): { column: number, line: number } | undefined {
  if (!isRecord(error) || !isRecord(error.loc)) return undefined

  const location = isRecord(error.loc.start) ? error.loc.start : error.loc
  const vue = location !== error.loc

  return typeof location.line === 'number' && typeof location.column === 'number'
    ? { column: vue ? location.column : location.column + 1, line: location.line }
    : undefined
}

/**
 * The compiler's message without what the error position already says: the
 * code frame and file name Vue appends for an inline template, the file name
 * Vue appends to an empty file's message, and Babel's own `(line:column)`.
 */
function compilerMessage(error: unknown, filename: string): string {
  const [first = ''] = errorMessage(error).split('\n\n', 1)
  const withoutFile = first.endsWith(` ${filename}`) ? first.slice(0, -filename.length - 1) : first
  return withoutFile.replace(/ \(\d+:\d+\)$/, '')
}

function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  if (isRecord(error) && typeof error.text === 'string') return error.text
  if (isRecord(error) && typeof error.message === 'string') return error.message
  return 'Failed to compile PDF component.'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
