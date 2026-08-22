import { readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import process from 'node:process'

import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { transform } from 'esbuild'

import {
  findUnsupportedPrimitiveProps,
  loadPdfDocumentationContracts,
} from './docs-contracts.mjs'

const repositoryRoot = resolve(import.meta.dirname, '..')
const contentRoot = join(repositoryRoot, 'docs/content')
const supportedLanguages = new Set(['bash', 'ts', 'vue'])

const markdownFiles = await findMarkdownFiles(contentRoot)
const { primitiveProps } = await loadPdfDocumentationContracts(repositoryRoot)
const failures = []
let snippetCount = 0

for (const file of markdownFiles) {
  const source = await readFile(file, 'utf8')
  const lines = source.split('\n')
  let fence

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]

    if (!fence) {
      const opening = /^```([^\s[]+)(?:\s+\[[^\]]+\])?\s*$/.exec(line)
      if (!opening) {
        if (line.startsWith('```')) {
          failures.push(`${location(file, index + 1)}: code fences must declare a language`)
        }
        continue
      }

      fence = { language: opening[1], line: index + 1, source: [] }
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

    if (fence.language === 'vue') {
      checkVueSnippet(source, `${relative(repositoryRoot, file)}:${fence.line}`)
    }
  }
  catch (error) {
    failures.push(`${label}: ${formatError(error)}`)
  }
}

function checkVueSnippet(source, filename) {
  const completeSfc = ['script', 'template'].some(tag => containsOpeningTag(source, tag))
  const sfcSource = completeSfc ? source : `<template>\n${source}\n</template>`
  const { descriptor, errors } = parse(sfcSource, { filename })

  if (errors.length > 0) {
    throw new Error(errors.map(formatError).join('; '))
  }

  if (descriptor.script || descriptor.scriptSetup) {
    compileScript(descriptor, { id: filename })
  }

  if (descriptor.template) {
    const result = compileTemplate({
      filename,
      id: filename,
      source: descriptor.template.content,
    })

    if (result.errors.length > 0) {
      throw new Error(result.errors.map(formatError).join('; '))
    }

    const propErrors = findUnsupportedPrimitiveProps(result.ast, primitiveProps)
    if (propErrors.length > 0) throw new Error(propErrors.join('; '))
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
