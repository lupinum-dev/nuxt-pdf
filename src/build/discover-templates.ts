import { readdir } from 'node:fs/promises'
import { isAbsolute, join, posix, resolve } from 'node:path'

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
  canonicalKey: string
  propertyKey: string
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

export const canonicalKeyFromRelativePath = (
  relativePath: string,
): string | null => {
  const normalized = normalizeRelativePath(relativePath)
  const [rootDirectory] = normalized.split('/')

  if (rootDirectory && EXCLUDED_ROOT_DIRECTORIES.has(rootDirectory)) {
    return null
  }

  if (!normalized.endsWith('.vue')) return null

  const canonicalKey = normalized.slice(0, -'.vue'.length)
  if (canonicalKey === '') {
    throw new TypeError(`Invalid PDF template path: "${relativePath}".`)
  }

  return canonicalKey
}

export const propertyKeyFromCanonicalKey = (canonicalKey: string): string => {
  const words = canonicalKey.split(/[^a-z0-9]+/i).filter(Boolean)

  if (words.length === 0) {
    throw new TypeError(
      `PDF template key "${canonicalKey}" cannot become a property name.`,
    )
  }

  const [first, ...rest] = words
  const camelKey = `${first![0]!.toLowerCase()}${first!.slice(1)}${rest
    .map(word => `${word[0]!.toUpperCase()}${word.slice(1)}`)
    .join('')}`

  return /^\d/.test(camelKey) ? `_${camelKey}` : camelKey
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
  const templatesByCanonicalKey = new Map<string, PdfTemplate>()
  const keysWithinLayers = new Map<string, PdfTemplate>()

  for (const candidate of [...candidates].sort(candidateOrder)) {
    if (!Number.isInteger(candidate.layerIndex) || candidate.layerIndex < 0) {
      throw new TypeError('PDF template layerIndex must be a non-negative integer.')
    }

    const relativePath = normalizeRelativePath(candidate.relativePath)
    const canonicalKey = canonicalKeyFromRelativePath(relativePath)
    if (canonicalKey == null) continue

    if (
      !isAbsolute(candidate.filePath)
      && !/^[a-z]:[\\/]/i.test(candidate.filePath)
    ) {
      throw new TypeError(
        `PDF template filePath must be absolute: "${candidate.filePath}".`,
      )
    }

    const template: PdfTemplate = {
      canonicalKey,
      propertyKey: propertyKeyFromCanonicalKey(canonicalKey),
      filePath: candidate.filePath,
      relativePath,
      layerIndex: candidate.layerIndex,
      layerName: candidate.layerName ?? `layer-${candidate.layerIndex}`,
    }
    const layerKey = `${candidate.layerIndex}\0${canonicalKey}`
    const duplicate = keysWithinLayers.get(layerKey)

    if (duplicate) {
      throw new TypeError(
        `PDF template collision for "${canonicalKey}" in ${template.layerName}: "${duplicate.filePath}" and "${template.filePath}".`,
      )
    }

    keysWithinLayers.set(layerKey, template)

    // Layers are supplied from highest to lowest precedence. A matching
    // canonical key in a later layer is deliberately overridden.
    if (!templatesByCanonicalKey.has(canonicalKey)) {
      templatesByCanonicalKey.set(canonicalKey, template)
    }
  }

  const templates = [...templatesByCanonicalKey.values()].sort((left, right) =>
    compareText(left.canonicalKey, right.canonicalKey),
  )
  const templatesByPropertyKey = new Map<string, PdfTemplate>()

  for (const template of templates) {
    const duplicate = templatesByPropertyKey.get(template.propertyKey)

    if (duplicate && duplicate.canonicalKey !== template.canonicalKey) {
      throw new TypeError(
        `PDF template property collision for "${template.propertyKey}": "${duplicate.canonicalKey}" (${duplicate.filePath}) and "${template.canonicalKey}" (${template.filePath}).`,
      )
    }

    templatesByPropertyKey.set(template.propertyKey, template)
  }

  return templates
}

type FindFilesOptions = {
  excludedRootDirectories?: ReadonlySet<string>
  include: (filename: string) => boolean
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
): Promise<PdfTemplate[]> => {
  const candidates: PdfTemplateCandidate[] = []

  for (const [layerIndex, layer] of layers.entries()) {
    const rootDir = resolve(layer.rootDir)
    const pdfsDir = join(rootDir, 'pdfs')
    const files = await findFiles(pdfsDir, VUE_FILES)

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
): Promise<string[]> => {
  const files = new Set<string>()

  for (const layer of layers) {
    const directory = join(resolve(layer.rootDir), 'pdfs', 'components')

    for (const relativePath of await findFiles(directory, PDF_COMPONENT_FILES)) {
      files.add(join(directory, ...relativePath.split('/')))
    }
  }

  return [...files].sort(compareText)
}

export const discoverPdfImageFiles = async (
  layers: readonly PdfTemplateLayer[],
): Promise<PdfImageFile[]> => {
  const files = new Map<string, PdfImageFile>()

  for (const [layerIndex, layer] of layers.entries()) {
    const rootDir = join(resolve(layer.rootDir), 'pdfs', 'assets')

    for (const key of await findFiles(rootDir, PDF_IMAGE_FILES)) {
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
