// @ts-check
import { createConfigForNuxt } from '@nuxt/eslint-config/flat'

// Run `npx @eslint/config-inspector` to inspect the resolved config interactively
export default createConfigForNuxt({
  features: {
    // Rules for module authors
    tooling: true,
    // Rules for formatting
    stylistic: true,
  },
  dirs: {
    src: [
      './playground',
    ],
  },
})
  .append(
    // The docs app follows the ginko-docs layer's own style conventions and
    // typechecks/builds inside its own project; keep it out of the root gates.
    { ignores: ['docs/**'] },
    {
      files: ['src/**/*.{ts,vue}'],
      ignores: ['src/runtime/server/engine/**'],
      rules: {
        'no-restricted-imports': ['error', {
          patterns: [{
            group: ['@react-pdf/*'],
            message: 'Lower React-PDF packages belong to the server engine boundary.',
          }],
        }],
      },
    },
    {
      files: ['src/runtime/components/**/*.{ts,vue}'],
      rules: {
        'no-restricted-imports': ['error', {
          patterns: [
            {
              group: ['@react-pdf/*'],
              message: 'Lower React-PDF packages belong to the server engine boundary.',
            },
            {
              group: ['../renderer', '../renderer/*', '../renderer/**'],
              message: 'Authoring components must not depend on renderer internals.',
            },
          ],
        }],
      },
    },
  )
