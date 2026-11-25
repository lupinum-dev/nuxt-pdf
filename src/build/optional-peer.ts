const MODULE_NOT_FOUND = new Set(['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'])

/**
 * Load an optional peer dependency of `@lupinum/nuxt-pdf/build`. Only a missing module
 * becomes the install hint; any other load failure keeps its own error.
 */
export async function loadOptionalPeer<T>(name: string, reason: string, load: () => T | Promise<T>): Promise<T> {
  try {
    return await load()
  }
  catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
    if (typeof code !== 'string' || !MODULE_NOT_FOUND.has(code)) throw error
    throw new Error(`@lupinum/nuxt-pdf/build needs "${name}" ${reason}. Install it: pnpm add -D ${name}`, { cause: error })
  }
}
