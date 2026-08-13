#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { basename, relative, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const releaseDirectory = resolve(root, 'release-artifacts')
const outputDirectory = resolve(root, '.package-preview')

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
}

const status = git('status', '--porcelain')
if (status) throw new Error(`Package preview requires a clean worktree:\n${status}`)

rmSync(outputDirectory, { force: true, recursive: true })
mkdirSync(outputDirectory)
execFileSync('pnpm', ['release:pack'], { cwd: root, stdio: 'inherit' })

const report = JSON.parse(readFileSync(resolve(releaseDirectory, 'pack-report.json'), 'utf8'))
const source = resolve(releaseDirectory, basename(report.filename))
const target = resolve(outputDirectory, basename(source))
const checksumLine = readFileSync(resolve(releaseDirectory, 'SHA256SUMS'), 'utf8')
  .split('\n')
  .find(line => line.endsWith(`  ${basename(source)}`))
if (!checksumLine) throw new Error('Release evidence does not contain the package checksum.')
const sha256 = checksumLine.split(/\s+/u)[0]
copyFileSync(source, target)
const actualSha256 = createHash('sha256').update(readFileSync(target)).digest('hex')
if (actualSha256 !== sha256) throw new Error('Preview tarball failed digest verification.')

const manifest = JSON.parse(execFileSync('tar', ['-xOf', target, 'package/package.json'], {
  cwd: root,
  encoding: 'utf8',
}))
if (manifest.name !== '@lupinum/nuxt-pdf') throw new Error('Preview tarball has the wrong package name.')

const output = [
  `directory=${relative(root, outputDirectory)}`,
  `package_name=${manifest.name}`,
  `sha256=${sha256}`,
  `tarball=${relative(root, target)}`,
].join('\n')
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${output}\n`)
console.log(output)

rmSync(releaseDirectory, { force: true, recursive: true })
const finalStatus = git('status', '--porcelain')
if (finalStatus) throw new Error(`Preview build changed tracked files:\n${finalStatus}`)
