import { PDF_STUB_NAMES } from '../runtime/components/stubs'

export const generateAuthoringTypes = (
  componentsImport: string,
  composablesImport: string,
  definePdfImport: string,
): string => `declare global {
  const definePdf: typeof import(${JSON.stringify(definePdfImport)})['definePdf']
  const usePdfPageNumbers: typeof import(${JSON.stringify(composablesImport)})['usePdfPageNumbers']
}

declare module 'vue' {
  interface GlobalComponents {
${PDF_STUB_NAMES.map(name => `    ${name}: typeof import(${JSON.stringify(componentsImport)})['${name}']`).join('\n')}
  }
}

export {}
`
