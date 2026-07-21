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

      // Semantic brand aliases used by the Lupinum invoice. Applications with
      // a GT Pressura license can map these same aliases to their licensed
      // files without changing the template.
      { family: 'Lupinum Sans', src: 'Geist-Light.otf', fontWeight: 300 },
      { family: 'Lupinum Sans', src: 'Geist-Medium.otf', fontWeight: 500 },
      { family: 'Lupinum Sans', src: 'Geist-Bold.otf', fontWeight: 700 },
      { family: 'Lupinum Mono', src: 'GeistMono-Regular.otf', fontWeight: 400 },
      { family: 'Lupinum Mono', src: 'GeistMono-SemiBold.otf', fontWeight: 600 },
      { family: 'Lupinum Mono', src: 'GeistMono-Bold.otf', fontWeight: 700 },
    ],
  },
})
