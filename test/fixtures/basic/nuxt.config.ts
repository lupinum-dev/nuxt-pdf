import NuxtPdf from '../../../src/module'

export default defineNuxtConfig({
  modules: [
    NuxtPdf,
  ],
  vite: {
    server: {
      hmr: false,
    },
  },
  pdf: {
    fonts: [{
      family: 'Invoice Sans',
      src: 'Roboto-Regular.ttf',
    }],
  },
})
