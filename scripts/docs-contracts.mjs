import { build } from 'esbuild'

const VUE_RESERVED_PROPS = new Set(['key', 'ref'])
const KEBAB_SEGMENT = /-([a-z])/g

const normalizePropName = key =>
  key.startsWith('data-') || key.startsWith('aria-')
    ? key
    : key.replace(KEBAB_SEGMENT, (_, letter) => letter.toUpperCase())

// The module is imported from a data: URL, which cannot resolve bare package
// names, so the packages the style compiler needs stay external under their
// resolved file URLs.
const EXTERNAL_PACKAGES = /^(?:postcss|@vue\/compiler-sfc)$/
const externalPackages = {
  name: 'external-packages',
  setup(build) {
    build.onResolve({ filter: EXTERNAL_PACKAGES }, args => ({
      external: true,
      path: import.meta.resolve(args.path),
    }))
  },
}

export async function loadPdfDocumentationContracts(repositoryRoot) {
  const result = await build({
    bundle: true,
    format: 'esm',
    platform: 'node',
    plugins: [externalPackages],
    stdin: {
      contents: `
        import { PDF_PAGE_SIZE_NAMES, PDF_PRIMITIVE_TABLE } from './src/runtime/primitives.ts'
        import { PDF_ERROR_CODES } from './src/runtime/shared/errors.ts'
        import { DEFAULT_PDF_RENDER_LIMITS } from './src/runtime/server/render-limits.ts'

        export { compilePdfStyles } from './src/build/pdf-style.ts'
        export { PDF_ERROR_CODES, PDF_PAGE_SIZE_NAMES, DEFAULT_PDF_RENDER_LIMITS }
        export const primitiveProps = Object.fromEntries(
          Object.entries(PDF_PRIMITIVE_TABLE).map(([name, spec]) => [
            name,
            Object.keys(spec.props),
          ]),
        )
      `,
      loader: 'ts',
      resolveDir: repositoryRoot,
      sourcefile: 'documentation-contracts.ts',
    },
    target: 'node22',
    write: false,
  })
  const source = result.outputFiles[0]?.text
  if (!source) throw new Error('Unable to load Nuxt PDF documentation contracts.')

  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
}

export function findUnsupportedPrimitiveProps(ast, primitiveProps) {
  const failures = []

  walkTemplate(ast, (node) => {
    const allowed = primitiveProps[node.tag]
    if (!allowed) return

    const allowedProps = new Set(allowed)
    for (const prop of node.props) {
      const name = getStaticPropName(prop)
      if (!name || VUE_RESERVED_PROPS.has(name) || allowedProps.has(name)) continue
      // The SFC compiler turns `class` into `style`, so a primitive that takes
      // a style takes a class.
      if (name === 'class' && allowedProps.has('style')) continue

      failures.push(`Unsupported prop "${name}" on <${node.tag}>.`)
    }
  })

  return failures
}

/** Static `class` names in a template that no rule of the `<style>` block defines. */
export function findUndefinedClasses(ast, definedClasses) {
  const failures = []

  walkTemplate(ast, (node) => {
    for (const prop of node.props) {
      if (prop.type !== 6 || prop.name !== 'class' || !prop.value) continue
      for (const name of prop.value.content.split(/\s+/).filter(Boolean)) {
        if (!definedClasses.has(name)) failures.push(`Undefined class "${name}" on <${node.tag}>.`)
      }
    }
  })

  return failures
}

function getStaticPropName(prop) {
  if (prop.type === 6) return normalizePropName(prop.name)
  if (prop.type !== 7 || prop.name !== 'bind') return undefined
  if (prop.arg?.type !== 4 || !prop.arg.isStatic) return undefined
  return normalizePropName(prop.arg.content)
}

function walkTemplate(node, visit) {
  if (node.type === 1) visit(node)

  for (const child of node.children ?? []) walkTemplate(child, visit)
  for (const branch of node.branches ?? []) walkTemplate(branch, visit)
}
