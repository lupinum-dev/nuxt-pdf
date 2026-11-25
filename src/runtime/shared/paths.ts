import nodePath, { type posix } from 'node:path'

// Path rules the build and the server runtime share. Each takes the path
// implementation, so a unit test can run it with `path.win32` on any system.

/** `node:path`, `path.posix` or `path.win32`. */
export type PlatformPath = typeof posix

/**
 * A path with forward slashes, also on Windows (`C:/app/pdfs/invoice.vue`):
 * the one form of a path in a message a developer reads (as Vite and Nuxt
 * print module ids and as `PdfSourcePosition.file` is written), in a
 * generated import and in an ignore or prefix match.
 */
export const forwardSlashes = (path: string): string => path.replaceAll('\\', '/')

/** A relative path that leaves its directory: a `..` step, or another drive on Windows. */
const leaves = (fromDirectory: string, path: PlatformPath): boolean =>
  fromDirectory === '..' || fromDirectory.startsWith(`..${path.sep}`) || path.isAbsolute(fromDirectory)

/**
 * `file` is `directory` or inside it. Only a `..` step leaves: a folder named
 * `..shared` is inside. On Windows a file on another drive has an absolute
 * relative path.
 */
export const isInside = (directory: string, file: string, path: PlatformPath = nodePath): boolean =>
  !leaves(path.relative(directory, file), path)

/** `file` is inside `directory` and is not `directory` itself: a file under a root. */
export const isStrictlyInside = (directory: string, file: string, path: PlatformPath = nodePath): boolean => {
  const fromDirectory = path.relative(directory, file)
  return fromDirectory !== '' && !leaves(fromDirectory, path)
}
