import { randomBytes } from 'node:crypto'
import {
  defineEventHandler,
  getQuery,
  getRequestURL,
} from 'h3'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- Nuxt generates this development-only virtual module.
import { pdfPreview } from '#pdf'
import { NuxtPdfError } from '../shared/errors'
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
      h1 { margin: 0; font-size: clamp(1.5rem, 4vw, 2.5rem); letter-spacing: -0.04em; }
      p { color: #b6beb6; line-height: 1.6; }
      code { color: #dce4dc; }
      .actions { display: flex; align-items: baseline; gap: 16px; }
      nav { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
      nav a { border: 1px solid #3f493f; border-radius: 999px; padding: 6px 11px; text-decoration: none; color: #dce4dc; }
      nav a.active { background: #a9e477; border-color: #a9e477; color: #101211; font-weight: 600; }
      iframe { width: 100%; min-height: calc(100vh - 300px); border: 1px solid #343a35; border-radius: 10px; background: white; }
      .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
      .card { border: 1px solid #343a35; border-radius: 10px; padding: 16px; display: flex; flex-direction: column; gap: 6px; }
      .card strong { font-size: 1.05rem; }
      .card .file { color: #8b948b; font-size: 0.8rem; word-break: break-all; }
      .card .meta { color: #b6beb6; font-size: 0.85rem; }
      .card .links { margin-top: 8px; display: flex; gap: 14px; }
      .diagnostics { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; margin-bottom: 16px; }
      .stat { border: 1px solid #343a35; border-radius: 10px; padding: 12px 14px; }
      .stat .label { color: #8b948b; font-size: 0.72rem; letter-spacing: 0.06em; text-transform: uppercase; }
      .stat .value { font-size: 1.35rem; font-variant-numeric: tabular-nums; margin-top: 4px; }
      .font-faces { border: 1px solid #343a35; background: #151815; border-radius: 10px; padding: 12px 16px; margin-bottom: 16px; }
      .font-faces .label { color: #8b948b; font-size: 0.78rem; letter-spacing: 0.04em; text-transform: uppercase; margin-bottom: 8px; }
      .font-faces ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
      .font-faces li { color: #d7ddd7; font-size: 0.85rem; line-height: 1.5; }
      .error { border: 1px solid #6b2f2b; background: #1d1210; border-left: 3px solid #ef786f; border-radius: 10px; padding: 18px 20px; }
      .error h2 { margin: 0 0 12px; font-size: 1.1rem; color: #f3d7d3; }
      .error dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 0 0 12px; }
      .error dt { color: #c69a95; font-size: 0.8rem; }
      .error dd { margin: 0; font-family: ui-monospace, SFMono-Regular, monospace; font-size: 0.85rem; word-break: break-all; }
      .error .message { color: #f0d9d6; line-height: 1.6; white-space: pre-wrap; }
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

const scenarioCount = (template: PreviewTemplate): string =>
  template.scenarioNames.length > 0
    ? `${template.scenarioNames.length} scenario${template.scenarioNames.length === 1 ? '' : 's'}`
    : 'sample data'

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
      '<header><h1>PDF templates</h1></header><p>No templates found. Add <code>pdfs/invoice.vue</code> and restart the development server.</p>',
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
      + `<span class="meta">${scenarioCount(template)}</span>`
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
): string => {
  const params = new URLSearchParams()
  if (scenario !== undefined) params.set('scenario', scenario)
  if (renderToken !== undefined) params.set('render', renderToken)
  if (download) params.set('download', '1')
  const query = params.size > 0 ? `?${params.toString()}` : ''
  return `${rootPath}/${encodeTemplatePath(key)}.pdf${query}`
}

const scenarioNav = (
  template: PreviewTemplate,
  rootPath: string,
  active?: string,
): string => {
  const base = `${rootPath}/${encodeTemplatePath(template.template.key)}`
  const tab = (label: string, href: string, isActive: boolean): string =>
    `<a href="${escapeHtml(href)}"${isActive ? ' class="active" aria-current="page"' : ''}>${escapeHtml(label)}</a>`

  const tabs = [
    tab('Default', base, active === undefined),
    ...template.scenarioNames.map(name =>
      tab(name, `${base}?scenario=${encodeURIComponent(name)}`, active === name),
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

const diagnosticsPanel = (diagnostics: PdfRenderDiagnostics): string => {
  const stat = (label: string, value: string): string =>
    `<div class="stat"><div class="label">${label}</div><div class="value">${escapeHtml(value)}</div></div>`

  const stats = [
    stat('Duration', formatDuration(diagnostics.durationMs)),
    stat('Size', formatBytes(diagnostics.byteLength)),
    stat('Pages', String(diagnostics.pageCount)),
    stat('Layout passes', String(diagnostics.passes)),
    stat('Font faces', String(diagnostics.registeredFontFaces.length)),
  ].join('')

  const fonts = diagnostics.registeredFontFaces.length > 0
    ? `<div class="font-faces"><div class="label">Registered font faces</div><ul>${
      diagnostics.registeredFontFaces.map((face) => {
        const attributes = [face.fontWeight, face.fontStyle].filter(value => value !== undefined)
        return `<li>${escapeHtml(face.family)}${attributes.length > 0 ? ` — ${escapeHtml(attributes.join(' '))}` : ''}</li>`
      }).join('')
    }</ul></div>`
    : ''

  return `<div class="diagnostics">${stats}</div>${fonts}`
}

const errorDetails = (
  error: unknown,
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
        PDF_LAYOUT_ERROR: 'PDF layout failed. Check the server output for details.',
        PDF_LIMIT_EXCEEDED: 'The PDF exceeded a configured render limit.',
        PDF_RENDER_ERROR: 'PDF serialization failed. Check the server output for details.',
        PDF_TEMPLATE_INVALID: 'The PDF template definition is invalid.',
        PDF_TEMPLATE_NOT_FOUND: 'The PDF template is not registered.',
        PDF_TREE_INVALID: 'The rendered PDF component tree is invalid.',
      }[error.code]
    : `Failed to render PDF template "${fallbackKey}".`

  const safeFile = file && !/^(?:[A-Z]:\\|\/)/u.test(file) ? file : undefined
  const fileRow = safeFile
    ? `<dt>File</dt><dd>${escapeHtml(safeFile)}</dd>`
    : ''

  return `<div class="error">`
    + `<h2>This template failed to render</h2>`
    + `<dl><dt>Code</dt><dd>${escapeHtml(code)}</dd>`
    + `<dt>Template</dt><dd>${escapeHtml(name)}</dd>`
    + fileRow
    + `</dl><p class="message">${escapeHtml(message)}</p></div>`
}

const viewerPage = async (
  template: PreviewTemplate,
  props: object,
  rootPath: string,
  scenario?: string,
  hmrClientPath = DEFAULT_HMR_CLIENT_PATH,
): Promise<Response> => {
  const handle = template.template
  const base = `${rootPath}/${encodeTemplatePath(handle.key)}`
  const scenarioQuery = scenario === undefined
    ? ''
    : `?scenario=${encodeURIComponent(scenario)}`
  const refreshHref = `${base}${scenarioQuery}${scenarioQuery ? '&' : '?'}_r=${Date.now()}`
  const nav = scenarioNav(template, rootPath, scenario)

  const actions = `<span class="actions">`
    + `<a href="${escapeHtml(refreshHref)}">Refresh</a>`
    + `<a href="${escapeHtml(rawUrl(rootPath, handle.key, scenario))}">Raw PDF</a>`
    + `<a href="${escapeHtml(rawUrl(rootPath, handle.key, scenario, undefined, true))}">Download</a>`
    + `<a href="${escapeHtml(rootPath)}">All templates</a>`
    + `</span>`

  let body: string
  let title: string
  try {
    const result = await handle.render(props)
    rememberSuccessfulRender(template, result, scenario)
    title = result.metadata.title || handle.key
    const token = parkRender(result, handle.key, scenario)
    body = diagnosticsPanel(result.diagnostics)
      + `<iframe title="${escapeHtml(title)}" src="${escapeHtml(rawUrl(rootPath, handle.key, scenario, token))}"></iframe>`
  }
  catch (error) {
    title = handle.key
    body = errorDetails(error, handle.key, template.file)
    const stale = previousSuccessfulRender(template, scenario)
    if (stale) {
      const token = parkRender(stale, handle.key, scenario)
      body += '<div class="stale" role="status">Render failed. Showing the previous successful PDF; it is stale.</div>'
        + `<iframe title="${escapeHtml(title)} (stale)" src="${escapeHtml(rawUrl(rootPath, handle.key, scenario, token))}"></iframe>`
    }
  }

  return htmlResponse(
    title,
    `<header><h1>${escapeHtml(title)}</h1>${actions}</header>${nav}${body}`
    + `<script type="module">import { createHotContext } from ${JSON.stringify(hmrClientPath)};createHotContext('/_pdf').on('nuxt-pdf:update',()=>location.reload());</script>`,
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

  const props = template.getPreviewProps(request.scenario)
  if (!props) {
    return errorPage(
      'Preview data required',
      `Add sampleData to definePdf() in "${key}", or choose one of its named scenarios.`,
      rootPath,
      422,
    )
  }

  if (!raw) {
    return viewerPage(
      template,
      props,
      rootPath,
      request.scenario,
      request.hmrClientPath,
    )
  }

  const disposition = request.download ? 'attachment' : 'inline'

  const parked = request.render === undefined
    ? undefined
    : takeParkedRender(request.render, key, request.scenario)
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
    const result = await template.template.render(props)
    return result.response({
      disposition,
      headers: {
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    })
  }
  catch (error) {
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
  const routeIndex = pathname.lastIndexOf(PREVIEW_ROUTE)
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
  })
})
