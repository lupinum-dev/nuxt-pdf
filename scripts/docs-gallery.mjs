// The template gallery of the docs, generated from the playground templates so
// that it cannot drift from them.
//
//   node scripts/docs-gallery.mjs           render each template with its own
//                                           sampleData, write the page images,
//                                           the gallery page and the lock file
//   node scripts/docs-gallery.mjs --check   fail when the page, an image or a
//                                           template input changed since the
//                                           last run (part of pnpm test:docs)
//
// The page images come from the same raster path as the raster tests:
// `rasterizePdf` (pdf.js `pdfjs-dist` drawing on `@napi-rs/canvas`, both pinned
// in package.json). Pixels differ slightly between platforms, so the check
// never re-renders: it hashes the inputs of each template (its file, the files
// it imports, the images it names, the playground font configuration) and the
// image files, and compares them with the lock file.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const pagePath = join(root, 'docs/content/docs/34.gallery.md')
const imageDirectory = join(root, 'docs/public/gallery')
const lockPath = join(root, 'scripts/docs-gallery.lock.json')
const repositoryUrl = 'https://github.com/lupinum-dev/nuxt-pdf/blob/main'
/** Width of a page image in pixels: sharp at the docs' reading width on a high-density screen. */
const IMAGE_WIDTH = 900
const WEBP_QUALITY = 80

/**
 * One entry per template. `data` names the export that the template's
 * `definePdf({ sampleData })` uses (the compiled template does not keep
 * `sampleData`; only the development preview does). `sentences` are exactly
 * three; `features` link to the docs pages of what the template uses.
 */
const ENTRIES = [
  {
    key: 'invoice',
    title: 'Invoice with an e-invoice',
    file: 'playground/pdfs/invoice.vue',
    data: ['invoice', 'playground/shared/invoice.ts', 'sampleInvoice'],
    sentences: [
      'A two-page invoice of a fictional studio: page 1 holds the lines in a `PdfTable` and the totals, page 2 the project context and scope under a running head.',
      'The PDF carries the same invoice as Factur-X XML (profile EN 16931), so it is a PDF/A-3b file that accounting software reads without typing.',
      'The totals on the page come from `computeEInvoice`, the function that also writes the XML, so the printed invoice and the XML agree.',
    ],
    features: [
      ['E-invoices', '$docs.e-invoices'],
      ['PDF/A and Factur-X', '$docs.pdf-a-and-factur-x'],
      ['Table components', '$docs.tables'],
      ['Reusable components', '$docs.reusable-components'],
      ['Page tokens', '$docs.primitives#page-tokens'],
      ['Images', '$docs.images-and-fonts'],
    ],
  },
  {
    key: 'registration',
    title: 'Registration form',
    file: 'playground/pdfs/registration.vue',
    data: ['registration', 'playground/shared/registration.ts', 'sampleRegistration'],
    sentences: [
      'A one-page workshop registration that the recipient fills in and saves in a PDF reader.',
      'It has text fields, a drop-down list, a radio group and checkboxes, each with a label and sized by classes in the `<style>` block.',
      'A second scenario fills the form for a returning participant, so the same template prints a blank and a filled form.',
    ],
    features: [
      ['Fillable forms', '$docs.forms'],
      ['Radio groups', '$docs.forms#make-a-radio-group'],
      ['Styles', '$docs.styles'],
      ['definePdf scenarios', '$docs.define-pdf'],
    ],
  },
  {
    key: 'article',
    title: 'Article from a CMS',
    file: 'playground/pdfs/article.vue',
    data: ['article', 'playground/shared/article.ts', 'sampleArticle'],
    sentences: [
      'A journal post as a headless CMS delivers it: the HTML that a rich text editor saved, printed by `PdfRichText`.',
      'It shows headings, lists, a quote, code, a link and a photo with a caption, and the headings become bookmarks.',
      'One class sets the text size, and the `styles` prop sets the headings, quotes, code and links; the same template also prints a post written in Markdown.',
    ],
    features: [
      ['Rich text', '$docs.rich-text'],
      ['Images in rich text', '$docs.rich-text#images'],
      ['Bookmarks', '$docs.contents-links-bookmarks'],
      ['Fonts', '$docs.images-and-fonts'],
    ],
  },
  {
    key: 'ebook',
    title: 'E-book',
    file: 'playground/pdfs/ebook.vue',
    data: ['ebook', 'playground/shared/ebook.ts', 'sampleEbook'],
    sentences: [
      'A small-format e-book with a cover drawn with SVG, a contents page, and chapters that each start on a new page.',
      'The contents page prints the page on which each chapter starts with `PdfPageRef`, and each entry links to its chapter.',
      'A running head repeats on every body page, and the running foot names the chapter that the page belongs to.',
    ],
    features: [
      ['Table of contents', '$docs.contents-links-bookmarks'],
      ['Fixed content and pages', '$docs.page-breaking#fixed-content-and-pages'],
      ['Page breaks', '$docs.page-breaking#page-breaks'],
      ['SVG graphics', '$docs.svg-graphics'],
      ['Reusable components', '$docs.reusable-components'],
    ],
  },
  {
    key: 'paper',
    title: 'Research paper',
    file: 'playground/pdfs/paper.vue',
    data: ['paper', 'playground/shared/paper.ts', 'samplePaper'],
    sentences: [
      'A three-page journal article: a masthead and the abstract on page 1, then a body in two balanced columns.',
      'Two SVG figures and two tables float to the top or bottom of a column, and the text links to them and to the numbered references.',
      'The running head starts on page 2 with `pages="continuation"`, and each section is a bookmark.',
    ],
    features: [
      ['Columns', '$docs.styles#columns'],
      ['Internal links', '$docs.contents-links-bookmarks#named-destinations-and-internal-links'],
      ['Fixed pages', '$docs.page-breaking#fixed-content-and-pages'],
      ['Floats', '$docs.styles#floats'],
      ['Figures', '$docs.accessible-pdf#figures-with-a-caption'],
    ],
  },
  {
    key: 'letter',
    title: 'Business letter',
    file: 'playground/pdfs/letter.vue',
    data: ['letter', 'playground/shared/letter.ts', 'sampleLetter'],
    sentences: [
      'A one-page business letter with a letterhead, an information block, a subject line and a signature block.',
      'The address sits in the window of a DL envelope as DIN 5008 form B places it: 20 mm from the left, 45 mm from the top, 85 × 45 mm, with the return address in its top 17.7 mm.',
      'Fold marks at 105 mm and 210 mm and a hole mark at 148.5 mm are decorative views, and the footer is fixed to the bottom of the page.',
    ],
    features: [
      ['Styling and layout', '$docs.styling-and-layout'],
      ['Styles', '$docs.styles'],
      ['Fixed content and pages', '$docs.page-breaking#fixed-content-and-pages'],
      ['SVG graphics', '$docs.svg-graphics'],
      ['Page sizes', '$docs.page-sizes'],
    ],
  },
]

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const rel = path => relative(root, path).replaceAll('\\', '/')

/**
 * Every file a template's render depends on in the playground: the file, its
 * relative imports (recursively), the files in `pdfs/assets` whose names it
 * mentions, and the Nuxt config with the font declarations. Sorted by path.
 */
const inputsOf = (file) => {
  const found = new Set()
  const assets = join(root, 'playground/pdfs/assets')
  const pending = [join(root, file)]
  while (pending.length > 0) {
    const path = pending.pop()
    if (found.has(path)) continue
    found.add(path)
    const source = readFileSync(path, 'utf8')
    for (const [, specifier] of source.matchAll(/(?:from|import)\s+['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const base = resolve(dirname(path), specifier)
      const target = [base, `${base}.ts`, `${base}/index.ts`].find(candidate => existsSync(candidate) && !candidate.endsWith('/'))
      if (target !== undefined && rel(target).startsWith('playground/')) pending.push(target)
    }
    for (const [, name] of source.matchAll(/['"]([\w./-]+\.(?:png|jpe?g))['"]/g)) {
      const asset = join(assets, name)
      if (existsSync(asset)) found.add(asset)
    }
  }
  found.add(join(root, 'playground/nuxt.config.ts'))
  return [...found].map(rel).sort()
}

const inputHash = paths => sha256(paths.map(path => `${path}\n${sha256(readFileSync(join(root, path)))}\n`).join(''))

/** The longest run of backticks in `text` plus one, at least three: a fence it cannot close. */
const fenceFor = text => '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map(match => match[0].length + 1)))

const page = (lock) => {
  const parts = [
    '---',
    'title: Template gallery',
    'slug: gallery',
    'description: Five complete templates from the playground, each with a page image, the features it uses and its source.',
    'icon: lucide:images',
    '---',
    '',
    '<!-- Generated by scripts/docs-gallery.mjs from playground/pdfs. Do not edit by hand: change the template or the script and run `node scripts/docs-gallery.mjs`. -->',
    '',
    'Each template below is a file in the playground of the repository, rendered with its own sample data.',
    'The page image is the first page of that render.',
    'Run `pnpm dev` in the repository and open `/_pdf` to see every page and change the data.',
    '',
  ]
  // A stylesheet that several templates `@import` is shown once, under the
  // first template that uses it; the docs snippet check resolves the
  // `@import` of every later template against that fence.
  const shownStylesheets = new Set()
  for (const entry of ENTRIES) {
    const source = readFileSync(join(root, entry.file), 'utf8').trimEnd()
    const fence = fenceFor(source)
    const image = lock[entry.key]
    const imports = inputsOf(entry.file).filter(path => path !== entry.file && /\.(?:vue|ts|css)$/.test(path) && path !== 'playground/nuxt.config.ts')
    const stylesheets = imports.filter(path => path.endsWith('.css') && !shownStylesheets.has(path))
    for (const path of stylesheets) shownStylesheets.add(path)
    const stylesheetFences = stylesheets.flatMap((path) => {
      const css = readFileSync(join(root, path), 'utf8').trimEnd()
      const cssFence = fenceFor(css)
      return [`${cssFence}css [${path}]`, css, cssFence]
    })
    parts.push(
      `## ${entry.title}`,
      '',
      `![First page of the ${entry.title[0].toLowerCase()}${entry.title.slice(1)} template](/gallery/${entry.key}.webp)`,
      '',
      entry.sentences.join(' '),
      '',
      `Uses: ${entry.features.map(([label, link]) => `[${label}](${link})`).join(', ')}.`,
      '',
      `Source: [\`${entry.file}\`](${repositoryUrl}/${entry.file})${imports.length > 0 ? `, with ${imports.map(path => `[\`${path.replace('playground/', '')}\`](${repositoryUrl}/${path})`).join(', ')}` : ''}.`,
      '',
      '::collapse',
      `${fence}vue [${entry.file}]`,
      source,
      fence,
      ...stylesheetFences,
      '::',
      '',
    )
    if (image === undefined) throw new Error(`No image recorded for "${entry.key}". Run node scripts/docs-gallery.mjs.`)
  }
  return `${parts.join('\n').trimEnd()}\n`
}

const readLock = () => existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, 'utf8')) : {}

const check = () => {
  const lock = readLock()
  const failures = []
  for (const entry of ENTRIES) {
    const recorded = lock[entry.key]
    if (recorded === undefined) {
      failures.push(`${entry.key}: no lock entry`)
      continue
    }
    const inputs = inputsOf(entry.file)
    if (inputHash(inputs) !== recorded.inputs) failures.push(`${entry.key}: a template input changed (${inputs.join(', ')})`)
    const imagePath = join(imageDirectory, `${entry.key}.webp`)
    if (!existsSync(imagePath)) failures.push(`${entry.key}: ${rel(imagePath)} is missing`)
    else if (sha256(readFileSync(imagePath)) !== recorded.image) failures.push(`${entry.key}: ${rel(imagePath)} is not the rendered image`)
  }
  const expected = failures.length === 0 ? page(lock) : undefined
  if (expected !== undefined && (!existsSync(pagePath) || readFileSync(pagePath, 'utf8') !== expected)) {
    failures.push(`${rel(pagePath)} differs from the generated page`)
  }
  if (failures.length > 0) {
    console.error(`Template gallery drifted:\n- ${failures.join('\n- ')}\nRun node scripts/docs-gallery.mjs, look at each image in docs/public/gallery, and commit the result.`)
    process.exit(1)
  }
  console.log(`Template gallery: ${ENTRIES.length} templates match their page images and source.`)
}

/** The test entry and the raster helpers, bundled from source with the same esbuild the docs checks use. */
const loadRenderer = async () => {
  const { build } = await import('esbuild')
  // Inside node_modules, so the bundle's bare imports resolve from the repository.
  const outfile = join(root, 'node_modules/.cache/nuxt-pdf-gallery/render.mjs')
  await build({
    stdin: {
      contents: [
        `export { renderPdfSfc } from './src/test/index.ts'`,
        `export { installPdfCanvasGlobals, rasterizePdf } from './src/test/pdf.ts'`,
        `export { pdfRenderPlacement } from './src/runtime/server/worker-pool.ts'`,
        ...ENTRIES.map(entry => `export * as data_${entry.key} from './${entry.data[1]}'`),
      ].join('\n'),
      loader: 'ts',
      resolveDir: root,
    },
    bundle: true,
    format: 'esm',
    logLevel: 'warning',
    outfile,
    packages: 'external',
    platform: 'node',
  })
  return import(pathToFileURL(outfile).href)
}

const generate = async () => {
  const renderer = await loadRenderer()
  const { createCanvas } = await import('@napi-rs/canvas')
  renderer.installPdfCanvasGlobals()
  // The bundle is one file, so the worker would load all of it: render in process.
  renderer.pdfRenderPlacement.inProcess = true
  mkdirSync(imageDirectory, { recursive: true })
  const lock = {}
  for (const entry of ENTRIES) {
    const file = join(root, entry.file)
    const [prop, module, name] = entry.data
    const sample = renderer[`data_${entry.key}`][name]
    if (sample === undefined) throw new Error(`${module} has no export ${name}.`)
    const props = { [prop]: sample }
    const { bytes, result } = await renderer.renderPdfSfc(file, props)
    if (result.diagnostics.layoutWarnings.length > 0 || result.diagnostics.imageWarnings.length > 0) {
      throw new Error(`${entry.file} renders with warnings: ${JSON.stringify(result.diagnostics)}`)
    }
    const [first] = await renderer.rasterizePdf(bytes, { scale: 1 })
    const [image] = await renderer.rasterizePdf(bytes, { scale: IMAGE_WIDTH / first.width })
    const canvas = createCanvas(image.width, image.height)
    const context = canvas.getContext('2d')
    const data = context.createImageData(image.width, image.height)
    data.data.set(image.pixels)
    context.putImageData(data, 0, 0)
    const webp = canvas.encodeSync('webp', WEBP_QUALITY)
    writeFileSync(join(imageDirectory, `${entry.key}.webp`), webp)
    lock[entry.key] = { inputs: inputHash(inputsOf(entry.file)), image: sha256(webp), width: image.width, height: image.height, pages: result.diagnostics.pageCount }
    console.log(`${entry.key}: ${image.width} × ${image.height} px, ${(webp.byteLength / 1024).toFixed(0)} KB, ${result.diagnostics.pageCount} page(s)`)
  }
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`)
  writeFileSync(pagePath, page(lock))
  console.log(`Wrote ${rel(pagePath)}, ${rel(lockPath)} and ${ENTRIES.length} images in ${rel(imageDirectory)}.`)
}

if (process.argv.includes('--check')) check()
else await generate()
