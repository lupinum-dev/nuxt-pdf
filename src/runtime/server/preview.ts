import {
  defineEventHandler,
  getQuery,
  getRequestURL,
} from 'h3'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- Nuxt generates this server-only virtual module.
import { pdf } from '#pdf'
import { NuxtPdfError } from '../shared/errors'
import type { PdfTemplate } from '../shared/template'

const PREVIEW_ROUTE = '/_pdf'

type PreviewTemplate = Pick<
  PdfTemplate<object>,
  | 'getPreviewProps'
  | 'key'
  | 'render'
  | 'resolveMetadata'
  | 'scenarioNames'
>

export type PdfPreviewRegistry = Readonly<Record<string, PreviewTemplate>>

export interface PdfPreviewRequest {
  path?: string
  rootPath?: string
  scenario?: string
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
      ul { list-style: none; margin: 0; padding: 0; }
      li { border-top: 1px solid #343a35; }
      li:last-child { border-bottom: 1px solid #343a35; }
      li a { display: flex; justify-content: space-between; gap: 16px; padding: 16px 4px; text-decoration: none; }
      code { color: #dce4dc; }
      nav { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
      nav a { border: 1px solid #3f493f; border-radius: 999px; padding: 6px 11px; text-decoration: none; }
      iframe { width: 100%; min-height: calc(100vh - 180px); border: 1px solid #343a35; border-radius: 10px; background: white; }
      .error { max-width: 720px; border-left: 3px solid #ef786f; padding-left: 18px; }
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
  Object.values(registry).find(template => template.key === key)

const indexPage = (
  registry: PdfPreviewRegistry,
  rootPath: string,
): Response => {
  const templates = Object.values(registry)
    .sort((left, right) => left.key.localeCompare(right.key))

  if (templates.length === 0) {
    return htmlResponse(
      'PDF templates',
      '<header><h1>PDF templates</h1></header><p>No templates found. Add <code>pdfs/invoice.vue</code> and restart the development server.</p>',
    )
  }

  const items = templates.map((template) => {
    const href = `${rootPath}/${encodeTemplatePath(template.key)}`
    const scenarios = template.scenarioNames.length > 0
      ? `${template.scenarioNames.length} scenario${template.scenarioNames.length === 1 ? '' : 's'}`
      : 'sample data'

    return `<li><a href="${escapeHtml(href)}"><strong>${escapeHtml(template.key)}</strong><span>${scenarios}</span></a></li>`
  }).join('')

  return htmlResponse(
    'PDF templates',
    `<header><h1>PDF templates</h1><span>${templates.length}</span></header><ul>${items}</ul>`,
  )
}

const errorPage = (
  title: string,
  message: string,
  rootPath: string,
  status: number,
): Response => htmlResponse(
  title,
  `<div class="error"><p><a href="${escapeHtml(rootPath)}">← All templates</a></p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></div>`,
  status,
)

const previewUrl = (
  rootPath: string,
  key: string,
  scenario?: string,
): string => {
  const query = scenario === undefined
    ? ''
    : `?scenario=${encodeURIComponent(scenario)}`
  return `${rootPath}/${encodeTemplatePath(key)}.pdf${query}`
}

const templatePage = (
  template: PreviewTemplate,
  props: object,
  rootPath: string,
  scenario?: string,
): Response => {
  let title: string
  try {
    title = template.resolveMetadata(props).title || template.key
  }
  catch (error) {
    const message = error instanceof Error
      ? error.message
      : 'Template metadata could not be evaluated.'
    return errorPage('Preview failed', message, rootPath, 500)
  }

  const scenarioLinks = [
    `<a href="${escapeHtml(`${rootPath}/${encodeTemplatePath(template.key)}`)}">Default</a>`,
    ...template.scenarioNames.map(name =>
      `<a href="${escapeHtml(`${rootPath}/${encodeTemplatePath(template.key)}?scenario=${encodeURIComponent(name)}`)}">${escapeHtml(name)}</a>`,
    ),
  ].join('')
  const rawUrl = previewUrl(rootPath, template.key, scenario)

  return htmlResponse(
    title,
    `<header><h1>${escapeHtml(title)}</h1><a href="${escapeHtml(rootPath)}">All templates</a></header><nav>${scenarioLinks}</nav><iframe title="${escapeHtml(title)}" src="${escapeHtml(rawUrl)}"></iframe>`,
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

  if (!raw) return templatePage(template, props, rootPath, request.scenario)

  try {
    const result = await template.render(props)
    return result.response({
      disposition: 'inline',
      headers: {
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    })
  }
  catch (error) {
    // The registry has already stamped the message with the template name and
    // file; surface the error code alongside it so the failing stage is visible.
    const message = error instanceof NuxtPdfError
      ? `${error.code}: ${error.message}`
      : error instanceof Error
        ? error.message
        : `Failed to render PDF template "${key}".`
    return errorPage('PDF render failed', message, rootPath, 500)
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

  return renderPdfPreview(pdf as unknown as PdfPreviewRegistry, {
    ...route,
    scenario: typeof query.scenario === 'string' ? query.scenario : undefined,
  })
})
