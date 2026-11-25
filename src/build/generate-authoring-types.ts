import { PDF_COMPONENT_NAMES } from '../runtime/component-names'

/** The functions a template or component may use without an import (`runtime/functions.ts`). */
export const PDF_FUNCTION_AUTO_IMPORTS = ['computeEInvoice', 'validateEInvoice', 'renderEInvoiceXml', 'parseRichTextHtml', 'validateRichText'] as const

export const generateAuthoringTypes = (
  componentsImport: string,
  definePdfImport: string,
  functionsImport: string,
): string => `declare global {
  const definePdf: typeof import(${JSON.stringify(definePdfImport)})['definePdf']
${PDF_FUNCTION_AUTO_IMPORTS.map(name => `  const ${name}: typeof import(${JSON.stringify(functionsImport)})['${name}']\n`).join('')}}

declare module 'vue' {
  interface GlobalComponents {
${PDF_COMPONENT_NAMES.map(name => `    ${name}: typeof import(${JSON.stringify(componentsImport)})['PDF_COMPONENTS']['${name}']`).join('\n')}
  }
}

export {}
`
