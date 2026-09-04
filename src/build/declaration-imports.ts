import { readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import ts from 'typescript'

/** Make Vue's declarations resolve in ordinary NodeNext TypeScript consumers. */
export async function normalizeDeclarationImports(directory: string): Promise<void> {
  for (const file of await readdir(directory, { recursive: true })) {
    if (!/\.d\.[cm]?ts$/.test(file)) continue
    const path = join(directory, file)
    const source = ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true)
    const transformed = ts.transform(source, [(context) => {
      const visit: ts.Visitor = (node) => {
        if (ts.isStringLiteral(node) && node.text.startsWith('.')) {
          const parent = node.parent
          const isImport = ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)
            || (ts.isLiteralTypeNode(parent) && ts.isImportTypeNode(parent.parent))
          if (isImport && !node.text.endsWith('.json')) {
            const module = ts.resolveModuleName(node.text, path, { moduleResolution: ts.ModuleResolutionKind.Bundler }, ts.sys).resolvedModule
            if (!module) throw new Error(`Cannot resolve emitted declaration import ${JSON.stringify(node.text)} from ${path}. Use a relative TypeScript source file inside rootDir.`)
            const target = relative(dirname(path), module.resolvedFileName).replaceAll('\\', '/').replace(/\.d\.([cm]?)ts$/, '.$1js')
            return ts.factory.createStringLiteral(target.startsWith('.') ? target : `./${target}`)
          }
        }
        return ts.visitEachChild(node, visit, context)
      }
      return node => ts.visitNode(node, visit) as ts.SourceFile
    }])
    try {
      await writeFile(path, ts.createPrinter().printFile(transformed.transformed[0]!))
    }
    finally {
      transformed.dispose()
    }
  }
}
