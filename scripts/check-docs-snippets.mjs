import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import process from 'node:process'

import { babelParse, compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { transform } from 'esbuild'

import {
  findUndefinedClasses,
  findUnsupportedPrimitiveProps,
  loadPdfDocumentationContracts,
} from './docs-contracts.mjs'

const repositoryRoot = resolve(import.meta.dirname, '..')
const contentRoot = join(repositoryRoot, 'docs/content')
const supportedLanguages = new Set(['bash', 'css', 'text', 'ts', 'vue'])
// `css [pdfs/theme.css]` fences are written here, so a `<style>` block in a
// vue fence of the same page can `@import` them as a template would.
const snippetRoot = await realpath(await mkdtemp(join(tmpdir(), 'nuxt-pdf-docs-snippets-')))

const markdownFiles = await findMarkdownFiles(contentRoot)
const { compilePdfStyles, primitiveProps } = await loadPdfDocumentationContracts(repositoryRoot)
const failures = []
let snippetCount = 0

for (const file of markdownFiles) {
  const source = await readFile(file, 'utf8')
  const lines = source.split('\n')
  const pageRoot = join(snippetRoot, relative(contentRoot, file))
  await writeCssFences(lines, pageRoot)
  let fence

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]

    if (!fence) {
      const opening = /^```([^\s[]+)(?:\s+\[([^\]]+)\])?\s*$/.exec(line)
      if (!opening) {
        if (line.startsWith('```')) {
          failures.push(`${location(file, index + 1)}: code fences must declare a language`)
        }
        continue
      }

      fence = { label: opening[2], language: opening[1], line: index + 1, pageRoot, source: [] }
      continue
    }

    if (line === '```') {
      snippetCount += 1
      await checkSnippet(file, fence)
      fence = undefined
      continue
    }

    fence.source.push(line)
  }

  if (fence) {
    failures.push(`${location(file, fence.line)}: unclosed ${fence.language} code fence`)
  }
}

await rm(snippetRoot, { force: true, recursive: true })

if (failures.length > 0) {
  console.error(`Documentation snippet validation failed:\n\n${failures.join('\n')}`)
  process.exitCode = 1
}
else {
  console.log(`Documentation snippets: ${snippetCount} valid code fences in ${markdownFiles.length} files`)
}

async function checkSnippet(file, fence) {
  const label = location(file, fence.line)
  const source = fence.source.join('\n')

  if (!supportedLanguages.has(fence.language)) {
    failures.push(`${label}: unsupported code-fence language ${JSON.stringify(fence.language)}`)
    return
  }

  try {
    if (fence.language === 'ts') {
      await transform(source, { loader: 'ts' })
      return
    }

    if (fence.language === 'css') {
      checkVueSnippet(`<template><PdfView /></template>\n<style>\n${source}\n</style>`, fence, fence.line - 2)
    }

    if (fence.language === 'vue') {
      checkVueSnippet(source, fence, fence.line)
    }
  }
  catch (error) {
    failures.push(`${label}: ${formatError(error)}`)
  }
}

function checkVueSnippet(source, fence, fenceLine) {
  const filename = join(fence.pageRoot, fence.label ?? `snippet-${fence.line}.vue`)
  const completeSfc = ['script', 'template'].some(tag => containsOpeningTag(source, tag))
  const sfcSource = completeSfc ? source : `<template>\n${source}\n</template>`
  const { descriptor, errors } = parse(sfcSource, { filename })

  if (errors.length > 0) {
    throw new Error(errors.map(formatError).join('; '))
  }

  if (descriptor.script || descriptor.scriptSetup) {
    compileScript(descriptor, { id: filename })
  }
  checkDefinePdf(descriptor, fence)

  // The same compiler as the build: invalid PDF CSS fails with its line in the
  // docs file (the fence line plus the line in the SFC, minus a wrapper line).
  const sfcLineOffset = fenceLine - (completeSfc ? 0 : 1)
  const { rules } = compilePdfStyles(
    descriptor.styles,
    (line, column, message, file) => new Error(file
      ? `${relative(fence.pageRoot, file)} line ${line}, column ${column}: ${message}`
      : `<style> line ${sfcLineOffset + line}, column ${column}: ${message}`),
    { alias: { '~': fence.pageRoot, '@': fence.pageRoot }, filename, rootDir: fence.pageRoot },
  )

  if (descriptor.template) {
    const result = compileTemplate({
      filename,
      id: filename,
      source: descriptor.template.content,
    })

    if (result.errors.length > 0) {
      throw new Error(result.errors.map(formatError).join('; '))
    }

    const propErrors = [
      ...findUnsupportedPrimitiveProps(result.ast, primitiveProps),
      // A fragment without a <style> block uses classes of a file it does not show.
      ...descriptor.styles.length > 0
        ? findUndefinedClasses(result.ast, new Set(rules.flatMap(([selectors]) => selectors.flatMap(selector => selector.split(/[\s.]+/)))))
        : [],
    ]
    if (propErrors.length > 0) throw new Error(propErrors.join('; '))
  }
}

/**
 * A fence labelled as a file under `pdfs/` must compile as that file: the
 * module rejects a template without exactly one `definePdf()` call and a
 * component under `pdfs/components/` with one. The Vue compiler alone does
 * not know these rules, so a copied template would fail only in the app.
 * A part of a longer file is labelled `pdfs/<name>.vue (excerpt)`.
 */
function checkDefinePdf(descriptor, fence) {
  const label = fence.label?.replaceAll('\\', '/')
  if (!label?.startsWith('pdfs/') || !label.endsWith('.vue')) return
  const calls = [descriptor.script, descriptor.scriptSetup].filter(Boolean).reduce((count, block) => {
    const plugins = block.lang === 'ts' || block.lang === 'tsx' ? ['typescript'] : []
    return count + countCalls(babelParse(block.content, { plugins, sourceType: 'module' }).program, 'definePdf')
  }, 0)
  if (label.startsWith('pdfs/components/')) {
    if (calls > 0) throw new Error(`${label} is a component, so it cannot call definePdf(); only templates directly in pdfs/ can.`)
    return
  }
  if (calls !== 1) {
    throw new Error(`${label} is a template and needs exactly one definePdf({...}) call in <script setup>; found ${calls}. Add one, or label a part of a longer file as "${label} (excerpt)".`)
  }
}

function countCalls(node, name) {
  if (Array.isArray(node)) return node.reduce((count, child) => count + countCalls(child, name), 0)
  if (!node || typeof node !== 'object' || typeof node.type !== 'string') return 0
  let count = node.type === 'CallExpression' && node.callee?.type === 'Identifier' && node.callee.name === name ? 1 : 0
  for (const [key, value] of Object.entries(node)) {
    if (key !== 'loc' && typeof value === 'object') count += countCalls(value, name)
  }
  return count
}

async function writeCssFences(lines, pageRoot) {
  await mkdir(pageRoot, { recursive: true })
  for (let index = 0; index < lines.length; index += 1) {
    const label = /^```css\s+\[([^\]]+)\]\s*$/.exec(lines[index])?.[1]
    if (!label) continue
    const end = lines.indexOf('```', index + 1)
    if (end === -1) continue
    const path = join(pageRoot, label)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, lines.slice(index + 1, end).join('\n'))
  }
}

function containsOpeningTag(source, tag) {
  const marker = `<${tag}`
  let offset = source.indexOf(marker)

  while (offset !== -1) {
    const next = source[offset + marker.length]
    if (next === '>' || next === ' ' || next === '\t' || next === '\r' || next === '\n') {
      return true
    }
    offset = source.indexOf(marker, offset + marker.length)
  }

  return false
}

async function findMarkdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...await findMarkdownFiles(path))
    }
    else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(path)
    }
  }

  return files.sort()
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error)
}

function location(file, line) {
  return `${relative(repositoryRoot, file)}:${line}`
}
