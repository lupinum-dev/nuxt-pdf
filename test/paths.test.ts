import { posix, win32 } from 'node:path'
import { describe, expect, it } from 'vitest'
import { displayPath, isBareSpecifier, isLocalModule } from '../src/build/paths'

// The build's path rules with Windows inputs, which CI otherwise checks only
// on its Windows runner.
describe('build paths on Windows and POSIX', () => {
  // Catches a message that shows `C:\…` on one run and `C:/…` on another.
  it.each([
    ['C:\\Users\\dev\\app\\pdfs\\invoice.vue', 'C:/Users/dev/app/pdfs/invoice.vue'],
    ['C:/Users/dev/app/pdfs/invoice.vue', 'C:/Users/dev/app/pdfs/invoice.vue'],
    ['/home/dev/app/pdfs/invoice.vue', '/home/dev/app/pdfs/invoice.vue'],
  ])('shows %s as %s', (path, shown) => {
    expect(displayPath(path)).toBe(shown)
  })

  // Catches an absolute Windows path taken for a package (the entry point of
  // loadPdfSfc became external on Windows).
  it.each([
    ['vue', true],
    ['@lupinum/nuxt-pdf/server', true],
    ['#imports', true],
    ['node:fs', true],
    ['./components/Part.vue', false],
    ['../shared/invoice', false],
    ['/home/dev/app/pdfs/invoice.vue', false],
    ['C:\\Users\\dev\\app\\pdfs\\invoice.vue', false],
    ['C:/Users/dev/app/pdfs/invoice.vue', false],
    ['\\\\server\\share\\pdfs\\invoice.vue', false],
  ])('treats %s as bare: %s', (specifier, bare) => {
    expect(isBareSpecifier(specifier)).toBe(bare)
  })

  // Catches a helper module that is not checked, or a package that is, when
  // the bundler hands over Windows ids (with either separator).
  it.each([
    ['win32', 'C:\\app', 'C:\\app\\pdfs\\helpers\\format.ts', true, win32],
    ['win32', 'C:\\app', 'C:/app/pdfs/helpers/format.ts', true, win32],
    ['win32', 'C:\\app', 'C:/app/node_modules/pkg/index.js', false, win32],
    ['win32', 'C:\\app', 'D:\\other\\format.ts', false, win32],
    ['win32', 'C:\\app', 'C:\\app\\pdfs\\Part.vue', false, win32],
    ['win32', 'C:\\app', 'virtual:pdf?query', false, win32],
    ['posix', '/app', '/app/pdfs/helpers/format.ts', true, posix],
    ['posix', '/app', '/app/node_modules/pkg/index.js', false, posix],
    ['posix', '/app', '/elsewhere/format.ts', false, posix],
  ] as const)('%s: in %s, %s is a local module: %s', (_platform, rootDir, id, local, path) => {
    expect(isLocalModule(id, rootDir, path)).toBe(local)
  })
})
