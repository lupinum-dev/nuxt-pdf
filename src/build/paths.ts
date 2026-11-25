import nodePath, { posix, win32 } from 'node:path'
import { forwardSlashes, isInside, type PlatformPath } from '../runtime/shared/paths'

// Path rules of the build that must hold on Windows too. Each takes the path
// implementation, so a unit test can run it with `path.win32` on any system.
// The rules the server runtime shares live in `runtime/shared/paths.ts`.

/**
 * `file` relative to the project root, with forward slashes: how a message
 * names a project file (`pdfs/invoice.vue`).
 */
export const projectPath = (rootDir: string, file: string): string =>
  forwardSlashes(nodePath.relative(rootDir, file)) || forwardSlashes(file)

/** A file system error for a path that does not exist. */
export const isMissingFile = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT'

/**
 * A bare import specifier (`vue`, `@scope/pkg`, `#imports`, `node:fs`): not
 * relative and not an absolute path on either platform. `C:\app\x.vue`,
 * `C:/app/x.vue` and `\\server\share\x.vue` are paths, not packages.
 */
export const isBareSpecifier = (specifier: string): boolean =>
  !specifier.startsWith('.') && !posix.isAbsolute(specifier) && !win32.isAbsolute(specifier)

/** A project module the bundler transforms: not virtual, not a package, not a PDF file. */
export const isLocalModule = (id: string, rootDir: string, path: PlatformPath = nodePath): boolean =>
  path.isAbsolute(id)
  && !id.includes('?')
  && !id.endsWith('.vue')
  && !forwardSlashes(id).includes('/node_modules/')
  && isInside(rootDir, id, path)
