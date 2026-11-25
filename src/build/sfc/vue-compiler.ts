// Vue's compiler with the build's options: SFC parse, script and template compile, auto-imports.

import { type BindingMetadata, type CompilerOptions, compileScript, compileTemplate, parse, type SFCDescriptor } from '@vue/compiler-sfc'
import { readFileSync, statSync } from 'node:fs'
import { createUnimport, type Unimport } from 'unimport'
import { PDF_FUNCTION_AUTO_IMPORTS } from '../generate-authoring-types'
import { forwardSlashes } from '../../runtime/shared/paths'
import type { PdfSourceMap } from './compile'
import { normalizeCompilerError } from './errors'

// One unimport context per e-invoice module path (the Vue preset is shared).
const authoringImportContexts = new Map<string, Unimport>()

// Vue cannot detect Node's filesystem in every ESM build. Imported prop types
// need the same explicit filesystem in metadata validation and compilation.
export const compilerFileSystem = {
  fileExists: (file: string) => statSync(file, { throwIfNoEntry: false })?.isFile() ?? false,
  readFile: (file: string) => readFileSync(file, 'utf8'),
}

type CompiledCode = {
  code: string
  map: PdfSourceMap | null
}

export const COMPONENT_VARIABLE = '__nuxtPdfComponent'

export function parsePdfSfc(source: string, filename: string): SFCDescriptor {
  const result = parse(source, {
    filename,
    sourceMap: true,
  })

  if (result.errors.length > 0) {
    throw normalizeCompilerError(result.errors[0], filename)
  }

  return result.descriptor
}

export type NodeTransform = NonNullable<CompilerOptions['nodeTransforms']>[number]

export function compileComponent(
  descriptor: SFCDescriptor,
  filename: string,
  isProduction: boolean,
  sourcePositions?: (baseOffset: number) => NodeTransform,
): CompiledCode {
  if (descriptor.scriptSetup) {
    try {
      const result = compileScript(descriptor, {
        fs: compilerFileSystem,
        genDefaultAs: COMPONENT_VARIABLE,
        id: 'nuxt-pdf',
        inlineTemplate: true,
        isProd: isProduction,
        sourceMap: true,
        templateOptions: {
          // The inline template compiles the file's own AST: file offsets.
          compilerOptions: sourcePositions ? { nodeTransforms: [sourcePositions(0)] } : undefined,
          filename,
          isProd: isProduction,
          ssr: false,
          transformAssetUrls: false,
        },
      })
      return {
        code: result.content,
        map: result.map
          ? JSON.parse(JSON.stringify(result.map)) as PdfSourceMap
          : null,
      }
    }
    catch (error) {
      throw normalizeCompilerError(error, filename)
    }
  }

  let scriptCode = `const ${COMPONENT_VARIABLE} = { __name: ${JSON.stringify(componentName(filename))} }`
  let bindings: BindingMetadata | undefined

  if (descriptor.script) {
    try {
      const script = compileScript(descriptor, {
        fs: compilerFileSystem,
        genDefaultAs: COMPONENT_VARIABLE,
        id: 'nuxt-pdf',
        isProd: isProduction,
        sourceMap: true,
      })

      scriptCode = script.content
      bindings = script.bindings
    }
    catch (error) {
      throw normalizeCompilerError(error, filename)
    }
  }

  const template = compileTemplate({
    compilerOptions: {
      bindingMetadata: bindings,
      // The template content is compiled on its own: offsets start at the block.
      nodeTransforms: sourcePositions ? [sourcePositions(descriptor.template!.loc.start.offset)] : undefined,
    },
    filename,
    id: 'nuxt-pdf',
    isProd: isProduction,
    source: descriptor.template!.content,
    ssr: false,
    transformAssetUrls: false,
  })

  if (template.errors.length > 0) {
    // Compiled from the block content alone: positions start at the block.
    throw normalizeCompilerError(template.errors[0], filename, descriptor.template!)
  }

  return {
    code: [
      scriptCode,
      template.code,
      `${COMPONENT_VARIABLE}.render = render`,
    ].join('\n'),
    // The separately compiled script and template do not share one generated
    // coordinate space. Returning no map is safer than publishing a false one.
    map: null,
  }
}

export async function injectAuthoringImports(
  componentCode: string,
  filename: string,
  functionsImport: string | undefined,
): Promise<CompiledCode> {
  // Vue APIs (`computed`, `ref`) are auto-imported, as in a Nuxt app, and
  // the e-invoice and rich text functions when the build names their module.
  const key = functionsImport ?? ''
  let context = authoringImportContexts.get(key)
  if (context === undefined) {
    context = createUnimport({
      presets: ['vue'],
      imports: functionsImport === undefined ? [] : PDF_FUNCTION_AUTO_IMPORTS.map(name => ({ name, from: functionsImport })),
    })
    authoringImportContexts.set(key, context)
  }
  const result = await context.injectImports(componentCode, filename)
  return {
    code: result.s.toString(),
    map: JSON.parse(result.s.generateMap({
      hires: true,
      includeContent: true,
      source: filename,
    }).toString()) as PdfSourceMap,
  }
}

export function scriptLoader(descriptor: SFCDescriptor): 'js' | 'jsx' | 'ts' | 'tsx' {
  const languages = [descriptor.script?.lang, descriptor.scriptSetup?.lang]

  if (languages.includes('tsx')) return 'tsx'
  if (languages.includes('ts')) return 'ts'
  if (languages.includes('jsx')) return 'jsx'
  return 'js'
}

export function componentName(filename: string): string {
  const basename = forwardSlashes(filename).split('/').at(-1) ?? 'PdfComponent.vue'
  return basename.replace(/\.vue$/i, '')
}
