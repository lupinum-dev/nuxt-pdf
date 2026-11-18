import nodePath, { posix, win32 } from 'node:path'

/** `node:path`, `path.posix` or `path.win32`. */
type PlatformPath = typeof posix

// Path rules of the build that must hold on Windows too. Each takes the path
// implementation, so a unit test can run it with `path.win32` on any system.

/**
 * The one form of a file path in a message a developer reads: forward
 * slashes, also on Windows (`C:/app/pdfs/invoice.vue:2:1`), as Vite and Nuxt
 * print module ids and as `PdfSourcePosition.file` is written.
 */
export const displayPath = (path: string): string => path.replaceAll('\\', '/')

/**
 * A bare import specifier (`vue`, `@scope/pkg`, `#imports`, `node:fs`): not
 * relative and not an absolute path on either platform. `C:\app\x.vue`,
 * `C:/app/x.vue` and `\\server\share\x.vue` are paths, not packages.
 */
export const isBareSpecifier = (specifier: string): boolean =>
  !specifier.startsWith('.') && !posix.isAbsolute(specifier) && !win32.isAbsolute(specifier)

/** `file` is inside `directory`. On Windows a file on another drive has an absolute relative path. */
export const isInside = (directory: string, file: string, path: PlatformPath = nodePath): boolean => {
  const fromDirectory = path.relative(directory, file)
  return !fromDirectory.startsWith('..') && !path.isAbsolute(fromDirectory)
}

/** A project module the bundler transforms: not virtual, not a package, not a PDF file. */
export const isLocalModule = (id: string, rootDir: string, path: PlatformPath = nodePath): boolean =>
  path.isAbsolute(id)
  && !id.includes('?')
  && !id.endsWith('.vue')
  && !displayPath(id).includes('/node_modules/')
  && isInside(rootDir, id, path)
