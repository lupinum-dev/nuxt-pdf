import { defineNuxtPlugin } from '#app'
import { PDF_COMPONENT_NAMES } from '../component-names'
import { createPdfStub } from './pdf-stub'

// Development only (see module.ts): every global `Pdf*` name resolves to a
// stub that fails with an actionable error outside pdfs/.
export default defineNuxtPlugin({
  name: 'nuxt-pdf:component-stubs',
  setup(nuxtApp) {
    for (const name of PDF_COMPONENT_NAMES) {
      nuxtApp.vueApp.component(name, createPdfStub(name))
    }
  },
})
