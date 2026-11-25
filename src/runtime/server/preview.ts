// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- ambient declaration must follow source imports into generated Nuxt consumer typechecks
/// <reference path="./preview-config.d.ts" />
import { randomBytes } from 'node:crypto'
import {
  defineEventHandler,
  getQuery,
  getRequestURL,
} from 'h3'
import { hmrClientPath, openInEditorPath, pdfPreview, rootDir } from '#pdf-preview-config'
import { NuxtPdfError } from '../shared/errors'
import { pdfCompileErrorOf } from '../shared/compile-error'
import type { PdfRenderResult } from '../shared/template'
import {
  diagnosticsPanel,
  encodeTemplatePath,
  errorDetails,
  errorPage,
  escapeHtml,
  htmlResponse,
  rawUrl,
  sourceScript,
  viewerUrl,
  type PreviewPageOptions,
} from './preview-html'
import type { PdfPreviewEntry } from './registry'

const PREVIEW_ROUTE = '/_pdf'

type PreviewTemplate = PdfPreviewEntry<object>

type PdfPreviewRegistry = Readonly<Record<string, PreviewTemplate>>

interface PdfPreviewRequest {
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
    hasSource = [...result.diagnostics.layoutWarnings, ...result.diagnostics.imageWarnings, ...result.diagnostics.richTextWarnings].some(warning => warning.source)
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

  return renderPdfPreview(pdfPreview, {
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
