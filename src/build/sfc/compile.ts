// The compile pipeline of one PDF SFC: checks, metadata, classes, Vue compile, source map.

import remapping from '@jridgewell/remapping'
import type { SFCDescriptor } from '@vue/compiler-sfc'
import { transform as transformWithEsbuild } from 'esbuild'
import { PDF_DEFINITION_SOURCE_PROPERTY } from '../../runtime/shared/compile-error'
import { PDF_BINDINGS_PROPERTY, PDF_CLASSES_PROPERTY, PDF_DEFINITION_PROPERTY } from '../../runtime/shared/template'
import { forwardSlashes } from '../../runtime/shared/paths'
import { projectPath } from '../paths'
import { compilePdfStyles, type PdfCompiledStyles } from '../style/compile'
import { assertDefineOptionsStatements, assertNoRemovedApi, assertNoRemovedProps, assertSupportedBlocks, assertSupportedTemplate, assertSynchronousSetup, assertTemplate } from './checks'
import { bundlerError, PdfSfcCompileError } from './errors'
import { extractMetadata } from './metadata'
import { pdfSfc } from './script-ast'
import { applyEdits, blankEdit, restoreAuthoredColumns, sourcePositionTransform, type TextEdit } from './source-text'
import { rewriteTemplateClasses } from './template-classes'
import { compileComponent, COMPONENT_VARIABLE, injectAuthoringImports, parsePdfSfc, scriptLoader } from './vue-compiler'

export type PdfSfcKind = 'component' | 'template'

export type PdfSfcCompileOptions = {
  /** Path aliases for `@import` in a `<style>` block (Nuxt's `nuxt.options.alias`). */
  alias?: Readonly<Record<string, string>>
  /**
   * Development build: every `Pdf*` element gets its template source position
   * (`PDF_SOURCE_PROP`), so tree errors and layout warnings can name it.
   * Default `false`; production output must not contain file paths.
   */
  dev?: boolean
  /** Called with every file the compiled module depends on besides the SFC (imported `.css`). */
  onDependency?: (file: string) => void
  /**
   * Root that source positions are relative to, and that a `<style>`
   * `@import` cannot leave. Default: the working directory.
   */
  rootDir?: string
  /**
   * The module that exports the functions of `PDF_FUNCTION_AUTO_IMPORTS` (the
   * e-invoice and rich text functions), auto-imported in templates and
   * components, so the visible PDF can show the totals the embedded XML
   * holds. Without it only the Vue APIs are auto-imported.
   */
  functionsImport?: string
}

export type PdfSfcTransformResult = {
  code: string
  map: {
    file?: string
    mappings: string
    names: string[]
    sourceRoot?: string
    sources: string[]
    sourcesContent?: string[]
    version: 3
  } | null
}

export type PdfSourceMap = NonNullable<PdfSfcTransformResult['map']>

export async function compilePdfSfc(
  source: string,
  filename: string,
  kind: PdfSfcKind,
  isProduction = false,
  options: PdfSfcCompileOptions = {},
): Promise<PdfSfcTransformResult> {
  const compilerFilename = forwardSlashes(filename)
  const rootDir = options.rootDir ?? process.cwd()
  const original = parsePdfSfc(source, compilerFilename)
  const sfc = pdfSfc(original, compilerFilename)

  assertSupportedBlocks(original, compilerFilename)
  assertTemplate(original, compilerFilename)
  assertSynchronousSetup(sfc)
  assertDefineOptionsStatements(sfc)
  assertNoRemovedApi(sfc)
  assertNoRemovedProps(original, compilerFilename)
  assertSupportedTemplate(sfc)

  const metadata = extractMetadata(source, sfc, kind, isProduction)
  const styles = compilePdfStyles(
    original.styles,
    (line, column, message, file = compilerFilename) => new PdfSfcCompileError(file, line, column, message),
    {
      alias: options.alias,
      filename,
      onDependency: options.onDependency,
      rootDir,
      typescript: ['ts', 'tsx'].includes(scriptLoader(original)),
    },
  )
  const rewritten = applyClassStyles(metadata.source, original, styles, compilerFilename)
  const cleaned = parsePdfSfc(rewritten.code, compilerFilename)
  const sourcePositions = options.dev
    ? (baseOffset: number) => sourcePositionTransform(
        source,
        rewritten.edits,
        projectPath(rootDir, filename),
        baseOffset,
      )
    : undefined
  const component = compileComponent(cleaned, compilerFilename, isProduction, sourcePositions)
  const autoImportedComponent = await injectAuthoringImports(
    component.code,
    compilerFilename,
    options.functionsImport,
  )
  // Development: where definePdf is, so the registry can show a metadata
  // value that fails validation at that position instead of failing to load.
  const definitionSource = options.dev && metadata.call
    ? `${COMPONENT_VARIABLE}[${JSON.stringify(PDF_DEFINITION_SOURCE_PROPERTY)}] = ${JSON.stringify({
      file: projectPath(rootDir, filename),
      ...metadata.call,
    })}\n`
    : ''
  const metadataCode = kind === 'template'
    ? `${COMPONENT_VARIABLE}.${PDF_DEFINITION_PROPERTY} = ${metadata.expression}\n${definitionSource}`
    : ''
  const classesCode = [
    styles.rules.length > 0 ? `${COMPONENT_VARIABLE}.${PDF_CLASSES_PROPERTY} = ${JSON.stringify(styles.rules)}` : '',
    styles.bindings.length > 0 ? `${COMPONENT_VARIABLE}.${PDF_BINDINGS_PROPERTY} = ${JSON.stringify(styles.bindings)}` : '',
  ].filter(Boolean).join('\n')
  const loader = scriptLoader(cleaned)

  try {
    const result = await transformWithEsbuild([
      autoImportedComponent.code,
      metadataCode,
      classesCode,
      `export default ${COMPONENT_VARIABLE}`,
    ].filter(Boolean).join('\n'), {
      charset: 'utf8',
      format: 'esm',
      loader,
      sourcefile: compilerFilename,
      sourcemap: true,
      sourcesContent: true,
      target: 'es2022',
    })

    const esbuildMap = result.map
      ? JSON.parse(result.map) as PdfSourceMap
      : null
    const traced = esbuildMap && autoImportedComponent.map && component.map
      ? remapping(
          [esbuildMap, autoImportedComponent.map, component.map],
          () => null,
          { decodedMappings: true },
        )
      : null
    const map = traced ? restoreAuthoredColumns(traced, rewritten.code, source, rewritten.edits) : null

    if (map) map.sourcesContent = map.sources.map(() => source)

    return { code: result.code, map }
  }
  catch (error) {
    throw bundlerError(error, compilerFilename)
  }
}

/**
 * Removes the compiled `<style>` content (its rules travel as JSON on the
 * component) and rewrites `class` on component tags into the class helper.
 * Line breaks stay, so later compiler errors keep their lines.
 */
function applyClassStyles(
  source: string,
  original: SFCDescriptor,
  styles: PdfCompiledStyles,
  filename: string,
): { code: string, edits: readonly TextEdit[] } {
  const blanked = applyEdits(source, original.styles.map(style => blankEdit(source, style.loc.start.offset, style.loc.end.offset)))
  const ast = original.template?.ast
  return ast
    ? rewriteTemplateClasses(
        blanked,
        ast,
        styles,
        (line, column, message) => new PdfSfcCompileError(filename, line, column, message),
      )
    : { code: blanked, edits: [] }
}
