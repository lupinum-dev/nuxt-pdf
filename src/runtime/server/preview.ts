import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import {
  defineEventHandler,
  getQuery,
  getRequestURL,
} from 'h3'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- Nuxt generates this development-only virtual module.
import { pdfPreview } from '#pdf'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- Nuxt generates this development-only virtual module.
import { hmrClientPath, openInEditorPath, rootDir } from '#pdf-preview-config'
import { NuxtPdfError, type PdfSourcePosition } from '../shared/errors'
import { pdfCompileErrorOf } from '../shared/compile-error'
import type {
  PdfRenderDiagnostics,
  PdfRenderResult,
} from '../shared/template'
import type { PdfPreviewEntry } from './registry'

const PREVIEW_ROUTE = '/_pdf'

type PreviewTemplate = PdfPreviewEntry<object>

export type PdfPreviewRegistry = Readonly<Record<string, PreviewTemplate>>

export interface PdfPreviewRequest {
  path?: string
  rootPath?: string
  scenario?: string
  /** Token of a parked viewer render the raw route should serve verbatim. */
  render?: string
  /** Serve a raw response as a download instead of inline. */
  download?: boolean
  /** Nuxt/Vite client path used by the development-only auto-refresh hook. */
  hmrClientPath?: string
  /** Vite's open-in-editor endpoint that source controls call. */
  openInEditorPath?: string
  /** Project root that source positions are relative to. */
  rootDir?: string
  /** Draw the engine's layout boxes (`?debug=1`). */
  debug?: boolean
}

interface PreviewPageOptions {
  debug: boolean
  hmrClientPath: string
  openInEditorPath: string
  rootDir?: string
}

// A viewer render is briefly parked here so the embedded iframe serves the
// EXACT bytes the diagnostics panel describes — without it, a non-deterministic
// template would show one render while the stats describe another. Dev-only,
// bounded FIFO; a miss (evicted or direct raw link) falls back to a fresh render.
interface ParkedRender {
  expiresAt: number
  key: string
  result: PdfRenderResult
  scenario?: string
}

const parkedRenders = new Map<string, ParkedRender>()
const lastSuccessfulRenders = new WeakMap<PreviewTemplate, Map<string, PdfRenderResult>>()
const PARKED_RENDER_LIMIT = 8
const PARKED_RENDER_TTL_MS = 30_000
const DEFAULT_HMR_CLIENT_PATH = '/_nuxt/@vite/client'
const DEFAULT_OPEN_IN_EDITOR_PATH = '/_nuxt/__open-in-editor'

// A layout-box render must never be served for a plain raw link, or the
// other way round.
const parkingKey = (key: string, debug: boolean): string =>
  debug ? `${key}\0debug` : key

const scenarioCacheKey = (scenario?: string): string => scenario ?? '\0'

const rememberSuccessfulRender = (
  template: PreviewTemplate,
  result: PdfRenderResult,
  scenario?: string,
): void => {
  let renders = lastSuccessfulRenders.get(template)
  if (!renders) {
    renders = new Map()
    lastSuccessfulRenders.set(template, renders)
  }
  renders.set(scenarioCacheKey(scenario), result)
}

const previousSuccessfulRender = (
  template: PreviewTemplate,
  scenario?: string,
): PdfRenderResult | undefined =>
  lastSuccessfulRenders.get(template)?.get(scenarioCacheKey(scenario))

// The preview runs only in `nuxt dev`. A render failure is logged once until
// the template renders again or fails with another message; compile errors
// are logged by the compiler. A template whose render failed on a component
// that did not compile is listed as failed in the index.
const loggedFailures = new Map<string, string>()
const componentCompileFailures = new WeakSet<PreviewTemplate>()

const recordRenderFailure = (template: PreviewTemplate, error: unknown): void => {
  const key = template.template.key
  if (error instanceof NuxtPdfError && pdfCompileErrorOf(error.cause)) {
    if (!template.compileError) componentCompileFailures.add(template)
    return
  }
  const message = error instanceof Error ? error.message : String(error)
  if (loggedFailures.get(key) === message) return
  loggedFailures.set(key, message)
  const cause = error instanceof NuxtPdfError && error.cause instanceof Error ? error.cause : error
  console.error(`[nuxt-pdf] ${message}`, ...(cause instanceof Error && cause.stack ? [`\n${cause.stack}`] : []))
}

const recordRenderSuccess = (template: PreviewTemplate): void => {
  loggedFailures.delete(template.template.key)
  componentCompileFailures.delete(template)
}

/**
 * The registry wraps a value thrown by the template's own code (its setup,
 * render or a metadata function) in a `PDF_RENDER_ERROR` with that value as the
 * cause; failures of this module's stages are already a `NuxtPdfError`.
 */
const templateThrew = (error: NuxtPdfError): boolean =>
  error.code === 'PDF_RENDER_ERROR' && !(error.cause instanceof NuxtPdfError)

const pruneExpiredRenders = (now: number): void => {
  for (const [token, render] of parkedRenders) {
    if (render.expiresAt <= now) parkedRenders.delete(token)
  }
}

const createRenderToken = (): string => {
  let token: string
  do token = randomBytes(32).toString('base64url')
  while (parkedRenders.has(token))
  return token
}

const parkRender = (
  result: PdfRenderResult,
  key: string,
  scenario?: string,
): string => {
  const now = Date.now()
  pruneExpiredRenders(now)

  const token = createRenderToken()
  parkedRenders.set(token, {
    expiresAt: now + PARKED_RENDER_TTL_MS,
    key,
    result,
    scenario,
  })
  while (parkedRenders.size > PARKED_RENDER_LIMIT) {
    const oldest = parkedRenders.keys().next().value
    if (oldest === undefined) break
    parkedRenders.delete(oldest)
  }
  return token
}

const takeParkedRender = (
  token: string,
  key: string,
  scenario?: string,
): PdfRenderResult | undefined => {
  const render = parkedRenders.get(token)
  if (!render) return undefined

  if (render.expiresAt <= Date.now()) {
    parkedRenders.delete(token)
    return undefined
  }
  if (render.key !== key || render.scenario !== scenario) return undefined

  parkedRenders.delete(token)
  return render.result
}

const escapeHtml = (value: string): string => value
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
const sourceScript = (options: PreviewPageOptions): string =>
  `<script type="module">document.addEventListener('click',(event)=>{`
  + `const button=event.target instanceof Element?event.target.closest('button.source'):null;`
  + `if(button)fetch(${scriptString(options.openInEditorPath)}+'?file='+encodeURIComponent(button.dataset.file));`
  + `});</script>`

const htmlResponse = (
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

const encodeTemplatePath = (key: string): string =>
  key.split('/').map(segment => encodeURIComponent(segment)).join('/')

const templateByKey = (
  registry: PdfPreviewRegistry,
  key: string,
): PreviewTemplate | undefined =>
  Object.values(registry).find(entry => entry.template.key === key)

// The props of the default preview: `sampleData`, or no props at all for a
// template that declares none.
const defaultPreviewProps = (template: PreviewTemplate): object | undefined =>
  template.getPreviewProps() ?? (template.declaresProps ? undefined : {})

const previewDataLabel = (template: PreviewTemplate): string => {
  if (template.scenarioNames.length > 0) {
    return `${template.scenarioNames.length} scenario${template.scenarioNames.length === 1 ? '' : 's'}`
  }
  if (template.getPreviewProps() !== undefined) return 'sample data'
  return template.declaresProps ? 'no preview data' : 'no props'
}

const indexPage = (
  registry: PdfPreviewRegistry,
  rootPath: string,
): Response => {
  const templates = Object.values(registry)
    .sort((left, right) =>
      left.template.key.localeCompare(right.template.key),
    )

  if (templates.length === 0) {
    return htmlResponse(
      'PDF templates',
      '<header><h1>PDF templates</h1></header><p>No templates found. Add <code>pdfs/invoice.vue</code>; Nuxt PDF registers it automatically.</p>',
    )
  }

  const cards = templates.map((template) => {
    const base = `${rootPath}/${encodeTemplatePath(template.template.key)}`
    const file = template.file
      ? `<span class="file">${escapeHtml(template.file)}</span>`
      : ''

    return `<article class="card">`
      + `<strong>${escapeHtml(template.template.key)}</strong>`
      + file
      + (template.compileError || componentCompileFailures.has(template)
        ? `<span class="meta failed">Compile error</span>`
        : `<span class="meta">${previewDataLabel(template)}</span>`)
      + `<span class="links">`
      + `<a href="${escapeHtml(base)}">Preview</a>`
      + `<a href="${escapeHtml(`${base}.pdf`)}">Raw PDF</a>`
      + `</span></article>`
  }).join('')

  return htmlResponse(
    'PDF templates',
    `<header><h1>PDF templates</h1><span>${templates.length}</span></header><div class="cards">${cards}</div>`,
  )
}

const errorPage = (
  title: string,
  message: string,
  rootPath: string,
  status: number,
): Response => htmlResponse(
  title,
  `<header><h1>${escapeHtml(title)}</h1><a href="${escapeHtml(rootPath)}">All templates</a></header><div class="error"><p class="message">${escapeHtml(message)}</p></div>`,
  status,
)

const rawUrl = (
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

const viewerUrl = (
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

const scenarioNav = (
  template: PreviewTemplate,
  rootPath: string,
  active: string | undefined,
  debug: boolean,
): string => {
  const base = `${rootPath}/${encodeTemplatePath(template.template.key)}`
  const tab = (label: string, href: string, isActive: boolean): string =>
    `<a href="${escapeHtml(href)}"${isActive ? ' class="active" aria-current="page"' : ''}>${escapeHtml(label)}</a>`

  const tabs = [
    tab('Default', viewerUrl(base, undefined, debug), active === undefined),
    ...template.scenarioNames.map(name =>
      tab(name, viewerUrl(base, name, debug), active === name),
    ),
  ].join('')

  return `<nav>${tabs}</nav>`
}

const formatDuration = (ms: number): string =>
  ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`

const formatBytes = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(2)} MB`
    : `${(bytes / 1024).toFixed(1)} KB`

const diagnosticsPanel = (
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
    stat('Font faces', String(diagnostics.registeredFontFaces.length)),
  ].join('')

  const warnings = diagnostics.layoutWarnings.length > 0
    ? `<div class="layout-warnings"><div class="label">Layout warnings</div><ul>${
      diagnostics.layoutWarnings.map(warning =>
        `<li><strong>${escapeHtml(warning.nodeType)}</strong> on page ${warning.pageNumber} is ${warning.nodeHeight} pt tall, but only ${warning.availableHeight} pt is available. Allow it to wrap or make it smaller.${warning.source ? ` ${sourceControl(warning.source, options)}` : ''}</li>`,
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

  return `<div class="diagnostics">${stats}</div>${warnings}${fonts}`
}

const errorDetails = (
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

const renderEntry = (
  template: PreviewTemplate,
  props: object,
  debug: boolean,
): Promise<PdfRenderResult> => debug
  ? template.renderWithLayoutBoxes(props)
  : template.template.render(props)

const viewerPage = async (
  template: PreviewTemplate,
  props: object,
  rootPath: string,
  scenario: string | undefined,
  options: PreviewPageOptions,
): Promise<Response> => {
  const handle = template.template
  const { debug } = options
  const base = `${rootPath}/${encodeTemplatePath(handle.key)}`
  const nav = scenarioNav(template, rootPath, scenario, debug)
  const key = parkingKey(handle.key, debug)

  const actions = `<span class="actions">`
    + `<a href="${escapeHtml(viewerUrl(base, scenario, !debug))}"${debug ? ' class="active" aria-current="true"' : ''}>Layout boxes</a>`
    + `<a href="${escapeHtml(viewerUrl(base, scenario, debug, Date.now()))}">Refresh</a>`
    + `<a href="${escapeHtml(rawUrl(rootPath, handle.key, scenario, undefined, false, debug))}">Raw PDF</a>`
    + `<a href="${escapeHtml(rawUrl(rootPath, handle.key, scenario, undefined, true, debug))}">Download</a>`
    + `<a href="${escapeHtml(rootPath)}">All templates</a>`
    + `</span>`

  let body: string
  let title: string
  let hasSource: boolean
  try {
    const result = await renderEntry(template, props, debug)
    recordRenderSuccess(template)
    if (!debug) rememberSuccessfulRender(template, result, scenario)
    title = result.metadata.title || handle.key
    const token = parkRender(result, key, scenario)
    body = diagnosticsPanel(result.diagnostics, options)
      + `<iframe title="${escapeHtml(title)}" src="${escapeHtml(rawUrl(rootPath, handle.key, scenario, token, false, debug))}"></iframe>`
    hasSource = result.diagnostics.layoutWarnings.some(warning => warning.source)
  }
  catch (error) {
    recordRenderFailure(template, error)
    title = handle.key
    body = errorDetails(error, options, handle.key, template.file)
    hasSource = error instanceof NuxtPdfError && error.source !== undefined
    const stale = debug ? undefined : previousSuccessfulRender(template, scenario)
    if (stale) {
      const token = parkRender(stale, key, scenario)
      body += '<div class="stale" role="status">Render failed. Showing the previous successful PDF; it is stale.</div>'
        + `<iframe title="${escapeHtml(title)} (stale)" src="${escapeHtml(rawUrl(rootPath, handle.key, scenario, token))}"></iframe>`
    }
  }

  return htmlResponse(
    title,
    `<header><h1>${escapeHtml(title)}</h1>${actions}</header>${nav}${body}`
    + `<script type="module">import { createHotContext } from ${JSON.stringify(options.hmrClientPath)};`
    + `createHotContext('/_pdf').on('nuxt-pdf:update',()=>{`
    + `location.reload();`
    + `});</script>`
    + (hasSource ? sourceScript(options) : ''),
  )
}

export const renderPdfPreview = async (
  registry: PdfPreviewRegistry,
  request: PdfPreviewRequest = {},
): Promise<Response> => {
  const rootPath = request.rootPath?.replace(/\/$/, '') || PREVIEW_ROUTE
  let path: string

  try {
    path = decodeURIComponent(request.path?.replace(/^\/+|\/+$/g, '') || '')
  }
  catch {
    return errorPage(
      'Invalid preview URL',
      'The template path contains invalid URL encoding.',
      rootPath,
      400,
    )
  }

  if (!path) return indexPage(registry, rootPath)

  const raw = path.endsWith('.pdf')
  const key = raw ? path.slice(0, -4) : path
  const template = templateByKey(registry, key)

  if (!template) {
    return errorPage(
      'Template not found',
      `No PDF template is registered as "${key}".`,
      rootPath,
      404,
    )
  }

  if (
    request.scenario !== undefined
    && !template.scenarioNames.includes(request.scenario)
  ) {
    const available = template.scenarioNames.length > 0
      ? template.scenarioNames.join(', ')
      : 'none'
    return errorPage(
      'Scenario not found',
      `Unknown scenario "${request.scenario}" for "${key}". Available scenarios: ${available}.`,
      rootPath,
      404,
    )
  }

  // A template that failed to compile has no preview data; rendering it with
  // empty props shows the compile error.
  const props = template.compileError
    ? {}
    : request.scenario === undefined
      ? defaultPreviewProps(template)
      : template.getPreviewProps(request.scenario)
  if (!props) {
    return errorPage(
      'Preview data required',
      `Add sampleData to definePdf() in "${key}", or choose one of its named scenarios.`,
      rootPath,
      422,
    )
  }

  const debug = request.debug === true
  if (!raw) {
    return viewerPage(template, props, rootPath, request.scenario, {
      debug,
      hmrClientPath: request.hmrClientPath ?? DEFAULT_HMR_CLIENT_PATH,
      openInEditorPath: request.openInEditorPath ?? DEFAULT_OPEN_IN_EDITOR_PATH,
      rootDir: request.rootDir,
    })
  }

  const disposition = request.download ? 'attachment' : 'inline'

  const parked = request.render === undefined
    ? undefined
    : takeParkedRender(request.render, parkingKey(key, debug), request.scenario)
  if (parked) {
    return parked.response({
      disposition,
      headers: {
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    })
  }

  try {
    const result = await renderEntry(template, props, debug)
    recordRenderSuccess(template)
    return result.response({
      disposition,
      headers: {
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    })
  }
  catch (error) {
    recordRenderFailure(template, error)
    // The registry has already stamped the message with the template name and
    // file; surface the error code alongside it so the failing stage is visible.
    return errorPage(
      'PDF render failed',
      error instanceof NuxtPdfError
        ? `${error.code}: The PDF could not be rendered. Check the server output for attributed details.`
        : `Failed to render PDF template "${key}". Check the server output for details.`,
      rootPath,
      500,
    )
  }
}

const requestRoute = (pathname: string): Pick<PdfPreviewRequest, 'path' | 'rootPath'> => {
  const routeIndex = pathname.indexOf(PREVIEW_ROUTE)
  if (routeIndex < 0) return { path: '', rootPath: PREVIEW_ROUTE }

  const rootEnd = routeIndex + PREVIEW_ROUTE.length
  return {
    path: pathname.slice(rootEnd),
    rootPath: pathname.slice(0, rootEnd),
  }
}

export default defineEventHandler(async (event) => {
  const url = getRequestURL(event)
  const query = getQuery(event)
  const route = requestRoute(url.pathname)

  return renderPdfPreview(pdfPreview as unknown as PdfPreviewRegistry, {
    ...route,
    scenario: typeof query.scenario === 'string' ? query.scenario : undefined,
    render: typeof query.render === 'string' ? query.render : undefined,
    download: query.download === '1',
    debug: query.debug === '1',
    hmrClientPath,
    openInEditorPath,
    rootDir,
  })
})
