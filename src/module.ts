import { defineNuxtModule } from '@nuxt/kit'

export type ModuleOptions = Record<string, never>

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'nuxt-pdf',
    configKey: 'pdf',
  },
  defaults: {},
  setup() {},
})
