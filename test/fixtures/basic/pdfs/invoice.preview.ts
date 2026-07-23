export const invoicePreviewSample = {
  customer: 'Ada Lovelace',
  number: 'INV-001',
  previewOnlyCanary: 'NUXT_PDF_PREVIEW_SAMPLE_CANARY_20260721_A1F49C',
  lines: [{
    description: 'PDF framework',
    id: 'framework',
    price: 'EUR 1,250.00',
  }],
}

export const invoicePreviewScenarios = {
  long: {
    customer: 'Grace Hopper',
    number: 'INV-LONG',
    previewOnlyCanary: 'NUXT_PDF_PREVIEW_SCENARIO_CANARY_20260721_B7E20D',
    lines: Array.from({ length: 12 }, (_, index) => ({
      description: `Engineering line ${index + 1}`,
      id: `line-${index + 1}`,
      price: 'EUR 100.00',
    })),
  },
}
