import NuxtPdf from '../../../src/module'

export default defineNuxtConfig({
  extends: ['./layers/base'],
  modules: [NuxtPdf],
  vite: {
    server: {
      hmr: false,
    },
  },
})
