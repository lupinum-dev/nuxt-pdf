import { readdir } from 'node:fs/promises'
import { isAbsolute, join, posix, relative, resolve } from 'node:path'

const EXCLUDED_ROOT_DIRECTORIES = new Set(['assets', 'components', 'fonts'])

export type PdfTemplateLayer = {
  /** Absolute or relative Nuxt layer root. Earlier entries have precedence. */
  rootDir: string
  name?: string
}

export type PdfTemplateCandidate = {
  filePath: string
  relativePath: string
  layerIndex: number
  layerName?: string
}

export type PdfTemplate = {
  key: string
  filePath: string
  relativePath: string
  layerIndex: number
  layerName: string
}

export type PdfImageFile = {
  filePath: string
  key: string
  rootDir: string
  layerIndex: number
}

export type PdfWatchAction = 'ignore' | 'refresh' | 'restart'

const PDF_STRUCTURE_EVENTS = new Set(['add', 'addDir', 'unlink', 'unlinkDir'])

const normalizePathForIgnore = (path: string): string => path.replaceAll('\\', '/')

export const classifyPdfWatchEvent = (
  event: string,
  absolutePath: string,
  layers: readonly PdfTemplateLayer[],
  isIgnored?: (path: string) => boolean,
): PdfWatchAction => {
  if (isIgnored?.(normalizePathForIgnore(absolutePath))) return 'ignore'

  for (const layer of layers) {
    const pdfsDir = join(resolve(layer.rootDir), 'pdfs')
    const pathWithinPdfs = relative(pdfsDir, absolutePath)
    if (
      pathWithinPdfs.startsWith('..')
      || isAbsolute(pathWithinPdfs)
    ) {
      continue
    }

    if (PDF_STRUCTURE_EVENTS.has(event)) return 'restart'
    if (event !== 'change') return 'ignore'

    const [rootDirectory] = pathWithinPdfs.split(/[\\/]/)
    return rootDirectory === 'assets' || rootDirectory === 'fonts'
      ? 'restart'
      : 'refresh'
  }

  return 'ignore'
}

const compareText = (left: string, right: string): number => {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

const normalizeRelativePath = (value: string): string => {
  const slashPath = value.replaceAll('\\', '/')

  if (
    isAbsolute(value)
    || slashPath.startsWith('/')
    || /^[a-z]:\//i.test(slashPath)
    || slashPath.split('/').includes('..')
  ) {
    throw new TypeError(`PDF template path must stay inside pdfs/: "${value}".`)
  }

  const normalized = posix.normalize(slashPath).replace(/^\.\//, '')

  if (normalized === '.' || normalized === '') {
    throw new TypeError('PDF template path cannot be empty.')
  }

  return normalized
}

export const templateKeyFromRelativePath = (
  relativePath: string,
): string | null => {
  const normalized = normalizeRelativePath(relativePath)
  const [rootDirectory] = normalized.split('/')

  if (rootDirectory && EXCLUDED_ROOT_DIRECTORIES.has(rootDirectory)) {
    return null
  }

  if (!normalized.endsWith('.vue')) return null

  const key = normalized.slice(0, -'.vue'.length)
  if (key === '') {
    throw new TypeError(`Invalid PDF template path: "${relativePath}".`)
  }

  return key
}

const candidateOrder = (
  left: PdfTemplateCandidate,
  right: PdfTemplateCandidate,
): number => left.layerIndex - right.layerIndex
  || compareText(left.relativePath, right.relativePath)
  || compareText(left.filePath, right.filePath)

export const normalizePdfTemplateCandidates = (
  candidates: readonly PdfTemplateCandidate[],
): PdfTemplate[] => {
  const templatesByKey = new Map<string, PdfTemplate>()
  const keysWithinLayers = new Map<string, PdfTemplate>()

  for (const candidate of [...candidates].sort(candidateOrder)) {
    if (!Number.isInteger(candidate.layerIndex) || candidate.layerIndex < 0) {
      throw new TypeError('PDF template layerIndex must be a non-negative integer.')
    }

    const relativePath = normalizeRelativePath(candidate.relativePath)
    const key = templateKeyFromRelativePath(relativePath)
    if (key == null) continue

    if (
      !isAbsolute(candidate.filePath)
      && !/^[a-z]:[\\/]/i.test(candidate.filePath)
    ) {
      throw new TypeError(
        `PDF template filePath must be absolute: "${candidate.filePath}".`,
      )
    }

    const template: PdfTemplate = {
      key,
      filePath: candidate.filePath,
      relativePath,
      layerIndex: candidate.layerIndex,
      layerName: candidate.layerName ?? `layer-${candidate.layerIndex}`,
    }
    const layerKey = `${candidate.layerIndex}\0${key}`
    const duplicate = keysWithinLayers.get(layerKey)

    if (duplicate) {
      throw new TypeError(
        `PDF template collision for "${key}" in ${template.layerName}: "${duplicate.filePath}" and "${template.filePath}".`,
      )
    }

    keysWithinLayers.set(layerKey, template)

    // Layers are supplied from highest to lowest precedence. A matching
    // key in a later layer is deliberately overridden.
    if (!templatesByKey.has(key)) {
      templatesByKey.set(key, template)
    }
  }

  return [...templatesByKey.values()].sort((left, right) =>
    compareText(left.key, right.key),
  )
}

type FindFilesOptions = {
  excludedRootDirectories?: ReadonlySet<string>
  include: (filename: string) => boolean
  isIgnored?: (absolutePath: string) => boolean
}

const findFiles = async (
  directory: string,
  options: FindFilesOptions,
  relativeDirectory = '',
): Promise<string[]> => {
  let entries

  try {
    entries = await readdir(directory, { withFileTypes: true })
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }

  entries.sort((left, right) => compareText(left.name, right.name))

  const files: string[] = []

  for (const entry of entries) {
    const absolutePath = join(directory, entry.name)
    const relativePath = relativeDirectory
      ? posix.join(relativeDirectory, entry.name)
      : entry.name

    if (
      relativeDirectory === ''
      && entry.isDirectory()
      && options.excludedRootDirectories?.has(entry.name)
    ) {
      continue
    }

    if (options.isIgnored?.(normalizePathForIgnore(absolutePath))) continue

    if (entry.isDirectory()) {
      files.push(...await findFiles(
        join(directory, entry.name),
        options,
        relativePath,
      ))
    }
    else if (entry.isFile() && options.include(entry.name)) {
      files.push(relativePath)
    }
  }

  return files
}

const VUE_FILES: FindFilesOptions = {
  excludedRootDirectories: EXCLUDED_ROOT_DIRECTORIES,
  include: filename => filename.endsWith('.vue'),
}

const PDF_COMPONENT_FILES: FindFilesOptions = {
  include: filename => filename.endsWith('.vue'),
}

const PDF_IMAGE_FILES: FindFilesOptions = {
  include: filename => /\.(?:jpe?g|png)$/i.test(filename),
}

export const discoverPdfTemplates = async (
  layers: readonly PdfTemplateLayer[],
  isIgnored?: (absolutePath: string) => boolean,
): Promise<PdfTemplate[]> => {
  const candidates: PdfTemplateCandidate[] = []

  for (const [layerIndex, layer] of layers.entries()) {
    const rootDir = resolve(layer.rootDir)
    const pdfsDir = join(rootDir, 'pdfs')
    const files = await findFiles(pdfsDir, { ...VUE_FILES, isIgnored })

    for (const relativePath of files) {
      candidates.push({
        filePath: join(pdfsDir, ...relativePath.split('/')),
        relativePath,
        layerIndex,
        layerName: layer.name,
      })
    }
  }

  return normalizePdfTemplateCandidates(candidates)
}

export const discoverPdfComponentFiles = async (
  layers: readonly PdfTemplateLayer[],
  isIgnored?: (absolutePath: string) => boolean,
): Promise<string[]> => {
  const files = new Set<string>()

  for (const layer of layers) {
    const directory = join(resolve(layer.rootDir), 'pdfs', 'components')

    for (const relativePath of await findFiles(directory, {
      ...PDF_COMPONENT_FILES,
      isIgnored,
    })) {
      files.add(join(directory, ...relativePath.split('/')))
    }
  }

  return [...files].sort(compareText)
}

export const discoverPdfImageFiles = async (
  layers: readonly PdfTemplateLayer[],
  isIgnored?: (absolutePath: string) => boolean,
): Promise<PdfImageFile[]> => {
  const files = new Map<string, PdfImageFile>()

  for (const [layerIndex, layer] of layers.entries()) {
    const rootDir = join(resolve(layer.rootDir), 'pdfs', 'assets')

    for (const key of await findFiles(rootDir, {
      ...PDF_IMAGE_FILES,
      isIgnored,
    })) {
      if (!files.has(key)) {
        files.set(key, {
          filePath: join(rootDir, ...key.split('/')),
          key,
          rootDir,
          layerIndex,
        })
      }
    }
  }

  return [...files.values()].sort((left, right) => compareText(left.key, right.key))
}
