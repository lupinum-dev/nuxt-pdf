import { PDF_COMPONENT_NAMES } from '../runtime/component-names'

/** The e-invoice functions a template or component may use without an import. */
export const EINVOICE_AUTO_IMPORTS = ['computeEInvoice', 'validateEInvoice', 'renderEInvoiceXml'] as const

export const generateAuthoringTypes = (
  componentsImport: string,
  definePdfImport: string,
  einvoiceImport: string,
): string => `declare global {
  const definePdf: typeof import(${JSON.stringify(definePdfImport)})['definePdf']
${EINVOICE_AUTO_IMPORTS.map(name => `  const ${name}: typeof import(${JSON.stringify(einvoiceImport)})['${name}']\n`).join('')}}

declare module 'vue' {
  interface GlobalComponents {
${PDF_COMPONENT_NAMES.map(name => `    ${name}: typeof import(${JSON.stringify(componentsImport)})['PDF_COMPONENTS']['${name}']`).join('\n')}
  }
}

export {}
`
