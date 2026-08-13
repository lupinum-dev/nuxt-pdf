#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const generatedDirectory = resolve(root, 'docs/.nuxt')
const generatedTsconfig = resolve(generatedDirectory, 'tsconfig.json')

function run(command, args, cwd = root) {
  execFileSync(command, args, { cwd, stdio: 'inherit' })
}

rmSync(generatedDirectory, { recursive: true, force: true })
run('pnpm', ['build'])
run('pnpm', ['--dir', 'docs', 'prepare'])

if (!existsSync(generatedTsconfig)) {
  throw new Error('Nuxt prepare did not create docs/.nuxt/tsconfig.json.')
}

run('pnpm', ['--dir', 'docs', 'build'])
