import { resolve } from 'node:path'
import { NuxtPdfError, type PdfSourcePosition } from '../shared/errors'
import { pdfCompileErrorOf } from '../shared/compile-error'
import type { PdfLayoutWarning, PdfRenderDiagnostics } from '../shared/template'

// The HTML of the development preview (preview.ts): escaping, the page shell
// and its CSS, URLs, and the diagnostics and error panels. Nothing here holds
// render state or reads a template.

export interface PreviewPageOptions {
  debug: boolean
  hmrClientPath: string
  openInEditorPath: string
  rootDir?: string
}

/**
 * The registry wraps a value thrown by the template's own code (its setup,
 * render or a metadata function) in a `PDF_RENDER_ERROR` with that value as the
 * cause; failures of this module's stages are already a `NuxtPdfError`.
 */
const templateThrew = (error: NuxtPdfError): boolean =>
  error.code === 'PDF_RENDER_ERROR' && !(error.cause instanceof NuxtPdfError)

export const escapeHtml = (value: string): string => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll('\'', '&#039;')

/** A string literal that is safe inside an inline `<script>`. */
const scriptString = (value: string): string =>
  JSON.stringify(value).replaceAll('<', '\\u003c')

const sourceControl = (
  source: PdfSourcePosition,
  options: PreviewPageOptions,
): string => {
  const position = `${source.file}:${source.line}:${source.column}`
  const file = options.rootDir ? resolve(options.rootDir, source.file) : source.file
  return `<button type="button" class="source" title="Open in editor" data-file="${escapeHtml(`${file}:${source.line}:${source.column}`)}">${escapeHtml(position)}</button>`
}

// Opens the editor without leaving the preview page.
export const sourceScript = (options: PreviewPageOptions): string =>
  `<script type="module">document.addEventListener('click',(event)=>{`
  + `const button=event.target instanceof Element?event.target.closest('button.source'):null;`
  + `if(button)fetch(${scriptString(options.openInEditorPath)}+'?file='+encodeURIComponent(button.dataset.file));`
  + `});</script>`

export const htmlResponse = (
  title: string,
  content: string,
  status = 200,
): Response => new Response(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)} · Nuxt PDF</title>
    <style>
      :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; background: #101211; color: #f3f5f2; }
      main { width: min(1120px, calc(100% - 32px)); margin: 0 auto; padding: 32px 0; }
      a { color: #a9e477; }
      header { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
      @media (max-width: 640px) { header { flex-direction: column; align-items: flex-start; gap: 8px; } }
      h1 { margin: 0; font-size: clamp(1.5rem, 4vw, 2.5rem); letter-spacing: -0.04em; }
      p { color: #b6beb6; line-height: 1.6; }
      code { color: #dce4dc; }
      .actions { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 16px; }
      .actions a.active { background: #a9e477; border-radius: 999px; padding: 2px 8px; color: #101211; font-weight: 600; text-decoration: none; }
      nav { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
      nav a { border: 1px solid #3f493f; border-radius: 999px; padding: 6px 11px; text-decoration: none; color: #dce4dc; }
      nav a.active { background: #a9e477; border-color: #a9e477; color: #101211; font-weight: 600; }
      iframe { width: 100%; min-height: calc(100vh - 300px); border: 1px solid #343a35; border-radius: 10px; background: white; }
      .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
      .card { border: 1px solid #343a35; border-radius: 10px; padding: 16px; display: flex; flex-direction: column; gap: 6px; }
      .card strong { font-size: 1.05rem; }
      .card .file { color: #8b948b; font-size: 0.8rem; word-break: break-all; }
      .card .meta { color: #b6beb6; font-size: 0.85rem; }
      .card .meta.failed { color: #ef786f; }
      .card .links { margin-top: 8px; display: flex; gap: 14px; }
      .diagnostics { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; margin-bottom: 16px; }
      .stat { border: 1px solid #343a35; border-radius: 10px; padding: 12px 14px; }
      .stat .label { color: #8b948b; font-size: 0.72rem; letter-spacing: 0.06em; text-transform: uppercase; }
      .stat .value { font-size: 1.35rem; font-variant-numeric: tabular-nums; margin-top: 4px; }
      .fonts { border: 1px solid #343a35; background: #151815; border-radius: 10px; padding: 12px 16px; margin-bottom: 16px; }
      .fonts summary { color: #8b948b; font-size: 0.78rem; letter-spacing: 0.04em; text-transform: uppercase; cursor: pointer; }
      .fonts ul { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 6px; }
      .fonts li { color: #d7ddd7; font-size: 0.85rem; line-height: 1.5; }
      .layout-warnings { border: 1px solid #765b23; background: #211b0f; border-left: 3px solid #e2b653; border-radius: 10px; padding: 12px 16px; margin-bottom: 16px; }
      .layout-warnings .label { color: #e8c977; font-size: 0.78rem; letter-spacing: 0.04em; text-transform: uppercase; margin-bottom: 8px; }
      .layout-warnings ul { margin: 0; padding-left: 20px; display: grid; gap: 6px; }
      .layout-warnings li { color: #f0dfb2; font-size: 0.85rem; line-height: 1.5; }
      .error { border: 1px solid #6b2f2b; background: #1d1210; border-left: 3px solid #ef786f; border-radius: 10px; padding: 18px 20px; }
      .error h2 { margin: 0 0 12px; font-size: 1.1rem; color: #f3d7d3; }
      .error dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 0 0 12px; }
      .error dt { color: #c69a95; font-size: 0.8rem; }
      .error dd { margin: 0; font-family: ui-monospace, SFMono-Regular, monospace; font-size: 0.85rem; word-break: break-all; }
      .error .message { color: #f0d9d6; line-height: 1.6; white-space: pre-wrap; }
      .source { background: none; border: 0; padding: 0; font: inherit; font-family: ui-monospace, SFMono-Regular, monospace; color: #a9e477; text-decoration: underline; cursor: pointer; word-break: break-all; text-align: left; }
      .stale { border: 1px solid #755d25; background: #211b0e; color: #f1d88c; border-radius: 10px; padding: 12px 16px; margin: 16px 0; }
    </style>
  </head>
  <body><main>${content}</main></body>
</html>`, {
  status,
  headers: {
    'cache-control': 'no-store',
    'content-type': 'text/html; charset=utf-8',
    'x-content-type-options': 'nosniff',
  },
})

export const encodeTemplatePath = (key: string): string =>
  key.split('/').map(segment => encodeURIComponent(segment)).join('/')

export const errorPage = (
  title: string,
  message: string,
  rootPath: string,
  status: number,
): Response => htmlResponse(
  title,
  `<header><h1>${escapeHtml(title)}</h1><a href="${escapeHtml(rootPath)}">All templates</a></header><div class="error"><p class="message">${escapeHtml(message)}</p></div>`,
  status,
)

export const rawUrl = (
  rootPath: string,
  key: string,
  scenario?: string,
  renderToken?: string,
  download = false,
  debug = false,
): string => {
  const params = new URLSearchParams()
  if (scenario !== undefined) params.set('scenario', scenario)
  if (debug) params.set('debug', '1')
  if (renderToken !== undefined) params.set('render', renderToken)
  if (download) params.set('download', '1')
  const query = params.size > 0 ? `?${params.toString()}` : ''
  return `${rootPath}/${encodeTemplatePath(key)}.pdf${query}`
}

export const viewerUrl = (
  base: string,
  scenario: string | undefined,
  debug: boolean,
  refresh?: number,
): string => {
  const params = new URLSearchParams()
  if (scenario !== undefined) params.set('scenario', scenario)
  if (debug) params.set('debug', '1')
  if (refresh !== undefined) params.set('_r', String(refresh))
  return params.size > 0 ? `${base}?${params.toString()}` : base
}

const formatDuration = (ms: number): string =>
  ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`

const formatBytes = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(2)} MB`
    : `${(bytes / 1024).toFixed(1)} KB`

/** What a layout warning says, with what to do about it. */
const layoutWarningText = (warning: PdfLayoutWarning): string => {
  switch (warning.code) {
    case 'PDF_UNBREAKABLE_NODE_OVERFLOW':
      return `<strong>${escapeHtml(warning.nodeType)}</strong> on page ${warning.pageNumber} is ${warning.nodeHeight} pt tall, but only ${warning.availableHeight} pt is available. Allow it to wrap or make it smaller.`
    case 'PDF_CONTENT_HIDDEN': {
      const hidden = [warning.hiddenLines > 0 ? `${warning.hiddenLines} ${warning.hiddenLines === 1 ? 'line' : 'lines'}` : '', warning.hiddenNodes > 0 ? `${warning.hiddenNodes} ${warning.hiddenNodes === 1 ? 'box' : 'boxes'}` : ''].filter(Boolean).join(' and ')
      return `<strong>${escapeHtml(warning.nodeType)}</strong> on page ${warning.pageNumber} has ${hidden} that are cut off and not drawn. Give its box more height, shorten the content, or move an absolute node up.`
    }
    case 'PDF_TABLE_COLUMNS_TOO_NARROW':
      return `<strong>PdfTable</strong> on page ${warning.pageNumber} is ${warning.tableWidth} pt wide, but its columns need ${warning.neededWidth} pt to keep their longest words whole. Words wider than their column break or run over it. Give the table more room or shorten the longest words.`
    case 'PDF_FOOTNOTES_MOVED':
      return `<strong>Footnotes ${warning.footnotes.join(', ')}</strong> do not fit on page ${warning.pageNumber} with their marks and print from the top of the note area on page ${warning.pageNumber + 1}. Allow the block with the marks to wrap, or shorten the notes.`
    case 'PDF_KEEP_IGNORED':
      return `<strong>${escapeHtml(warning.nodeType)}</strong> on page ${warning.pageNumber} keeps with what follows it (keepWithNext or minPresenceAhead), but that is higher than the page, so the keep has no effect. Shorten the chain of nodes that keep together, or remove the keep.`
    case 'PDF_HYPHENATION_UNAVAILABLE':
      return `<strong>No hyphenation patterns</strong> for the document language ${escapeHtml(`"${warning.language}"`)}, so words break only at soft hyphens. Set language to a supported tag, such as "de" or "en-GB", or add soft hyphens (U+00AD) to long words.`
    case 'PDF_GLYPH_MISSING':
      return `<strong>U+${warning.codePoint.toString(16).toUpperCase().padStart(4, '0')}</strong> on page ${warning.pageNumber} is not in font ${escapeHtml(`"${warning.fontFamily}"`)} and shows as the font's empty box, or not at all in a standard font. Register a font that contains it and use it in fontFamily, or replace the character.`
  }
}

export const diagnosticsPanel = (
  diagnostics: PdfRenderDiagnostics,
  options: PreviewPageOptions,
): string => {
  const stat = (label: string, value: string): string =>
    `<div class="stat"><div class="label">${label}</div><div class="value">${escapeHtml(value)}</div></div>`

  const stats = [
    stat('Duration', formatDuration(diagnostics.durationMs)),
    stat('Size', formatBytes(diagnostics.byteLength)),
    stat('Pages', String(diagnostics.pageCount)),
    stat('Layout passes', String(diagnostics.passes)),
    stat('Layout warnings', String(diagnostics.layoutWarnings.length)),
    stat('Image warnings', String(diagnostics.imageWarnings.length)),
    stat('Rich text warnings', String(diagnostics.richTextWarnings.length)),
    stat('Font faces', String(diagnostics.registeredFontFaces.length)),
  ].join('')

  const warnings = diagnostics.layoutWarnings.length > 0
    ? `<div class="layout-warnings"><div class="label">Layout warnings</div><ul>${
      diagnostics.layoutWarnings.map(warning =>
        `<li>${layoutWarningText(warning)}${warning.source ? ` ${sourceControl(warning.source, options)}` : ''}</li>`,
      ).join('')
    }</ul></div>`
    : ''

  const imageWarnings = diagnostics.imageWarnings.length > 0
    ? `<div class="layout-warnings"><div class="label">Image warnings</div><ul>${
      diagnostics.imageWarnings.map(warning =>
        `<li><strong>PdfRichText</strong> image ${escapeHtml(warning.path)} printed its placeholder: its source was refused (${escapeHtml(warning.reason)}). Render with <code>brokenImages="error"</code> to see why.${warning.source ? ` ${sourceControl(warning.source, options)}` : ''}</li>`,
      ).join('')
    }</ul></div>`
    : ''

  const richTextWarnings = diagnostics.richTextWarnings.length > 0
    ? `<div class="layout-warnings"><div class="label">Rich text warnings</div><ul>${
      diagnostics.richTextWarnings.map(warning =>
        `<li><strong>${escapeHtml(warning.name)}</strong>${warning.count > 1 ? ` (${warning.count}×)` : ''}: ${escapeHtml(warning.message)}${warning.snippet ? ` <code>${escapeHtml(warning.snippet)}</code>` : ''}${warning.source ? ` ${sourceControl(warning.source, options)}` : ''}</li>`,
      ).join('')
    }</ul></div>`
    : ''

  const fonts = diagnostics.registeredFontFaces.length > 0
    ? `<details class="fonts"><summary>Registered font faces (${diagnostics.registeredFontFaces.length})</summary><ul>${
      diagnostics.registeredFontFaces.map((face) => {
        const attributes = [face.fontWeight, face.fontStyle].filter(value => value !== undefined)
        return `<li>${escapeHtml(face.family)}${attributes.length > 0 ? ` — ${escapeHtml(attributes.join(' '))}` : ''}</li>`
      }).join('')
    }</ul></details>`
    : ''

  return `<div class="diagnostics">${stats}</div>${warnings}${imageWarnings}${richTextWarnings}${fonts}`
}

export const errorDetails = (
  error: unknown,
  options: PreviewPageOptions,
  fallbackKey: string,
  fallbackFile?: string,
): string => {
  const code = error instanceof NuxtPdfError ? error.code : 'PDF_RENDER_ERROR'
  const name = error instanceof NuxtPdfError && error.templateKey
    ? error.templateKey
    : fallbackKey
  const file = error instanceof NuxtPdfError && error.templateFile
    ? error.templateFile
    : fallbackFile
  const message = error instanceof NuxtPdfError
    ? {
        PDF_ASSET_BLOCKED: 'A PDF resource was blocked by the configured policy.',
        PDF_ASSET_INVALID: 'A PDF resource failed validation.',
        PDF_INVOICE_INVALID: 'The e-invoice data breaks a rule of its profile.',
        PDF_LAYOUT_ERROR: 'PDF layout failed. Check the server output for details.',
        PDF_LIMIT_EXCEEDED: 'The PDF exceeded a configured render limit.',
        PDF_RICH_TEXT_INVALID: 'The rich text input is invalid or over a limit.',
        PDF_RENDER_ERROR: templateThrew(error)
          ? 'The template threw while rendering. Check the server output for details.'
          : 'PDF serialization failed. Check the server output for details.',
        PDF_TEMPLATE_INVALID: 'The PDF template definition is invalid.',
        PDF_TEMPLATE_NOT_FOUND: 'The PDF template is not registered.',
        PDF_TREE_INVALID: 'The rendered PDF component tree is invalid.',
      }[error.code]
    : `Failed to render PDF template "${fallbackKey}".`
  // Tree errors come from this module's own validators and describe the
  // document structure; compile errors and template errors (an invalid
  // definePdf value, an authoring pattern Vue reports such as a component it
  // cannot resolve) describe the author's own source. The preview shows them.
  // Every other code can carry URLs, paths or data and keeps its generic
  // sentence.
  const compileError = error instanceof NuxtPdfError ? pdfCompileErrorOf(error.cause) : undefined
  const detail = compileError
    ? compileError.message
    : error instanceof NuxtPdfError && (error.code === 'PDF_TREE_INVALID' || error.code === 'PDF_TEMPLATE_INVALID')
      ? error.message
      : message

  const safeFile = file && !/^(?:[A-Z]:\\|\/)/u.test(file) ? file : undefined
  const fileRow = safeFile
    ? `<dt>File</dt><dd>${escapeHtml(safeFile)}</dd>`
    : ''

  return `<div class="error">`
    + `<h2>This template failed to ${compileError ? 'compile' : 'render'}</h2>`
    + `<dl><dt>Code</dt><dd>${escapeHtml(code)}</dd>`
    + `<dt>Template</dt><dd>${escapeHtml(name)}</dd>`
    + fileRow
    + (error instanceof NuxtPdfError && error.source
      ? `<dt>Source</dt><dd>${sourceControl(error.source, options)}</dd>`
      : '')
    + `</dl><p class="message">${escapeHtml(detail)}</p></div>`
}
