export default defineNuxtConfig({
  modules: ['@lupinum/nuxt-pdf'],
  css: ['~/assets/css/playground.css'],
  compatibilityDate: '2026-07-20',
  pdf: {
    fonts: [
      // Legacy single-weight family kept for the existing invoice/tests.
      { family: 'Fieldnote Sans', src: 'Roboto-Regular.ttf' },

      // Inter — the workhorse grotesque. Weights carry hierarchy.
      { family: 'Inter', src: 'Inter-400.ttf', fontWeight: 400 },
      { family: 'Inter', src: 'Inter-500.ttf', fontWeight: 500 },
      { family: 'Inter', src: 'Inter-600.ttf', fontWeight: 600 },
      { family: 'Inter', src: 'Inter-700.ttf', fontWeight: 700 },
      { family: 'Inter', src: 'Inter-800.ttf', fontWeight: 800 },

      // Lora — the book serif, with a true italic.
      { family: 'Lora', src: 'Lora-400.ttf', fontWeight: 400 },
      { family: 'Lora', src: 'Lora-400-italic.ttf', fontWeight: 400, fontStyle: 'italic' },
      { family: 'Lora', src: 'Lora-600.ttf', fontWeight: 600 },
      { family: 'Lora', src: 'Lora-700.ttf', fontWeight: 700 },
    ],
  },
})
