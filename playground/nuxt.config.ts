export default defineNuxtConfig({
  modules: ['@lupinum/nuxt-pdf'],
  css: ['~/assets/css/playground.css'],
  compatibilityDate: '2026-07-20',
  pdf: {
    fonts: [{
      family: 'Fieldnote Sans',
      src: 'Roboto-Regular.ttf',
    }],
  },
})
