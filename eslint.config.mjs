// @ts-check
import { createConfigForNuxt } from '@nuxt/eslint-config/flat'

const lowerReactPdfRestriction = {
  group: ['@react-pdf/*'],
  message: 'Lower React-PDF packages belong to the server engine boundary.',
}

const runtimeFacadeRestrictions = [
  {
    group: [
      '../renderer/*',
      '../renderer/**',
      '../../renderer/*',
      '../../renderer/**',
    ],
    message: 'Import the renderer facade instead of its private files.',
  },
  {
    group: [
      '../components/*',
      '../components/**',
      '../../components/*',
      '../../components/**',
    ],
    message: 'Import the components facade instead of its private files.',
  },
]

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
          patterns: [lowerReactPdfRestriction],
        }],
      },
    },
    {
      files: ['src/runtime/**/*.{ts,vue}'],
      rules: {
        'no-restricted-imports': ['error', {
          patterns: [
            lowerReactPdfRestriction,
            ...runtimeFacadeRestrictions,
          ],
        }],
      },
    },
    {
      files: ['src/runtime/server/engine/**/*.{ts,vue}'],
      rules: {
        'no-restricted-imports': ['error', {
          patterns: runtimeFacadeRestrictions,
        }],
      },
    },
    {
      files: ['src/runtime/components/**/*.{ts,vue}'],
      rules: {
        'no-restricted-imports': ['error', {
          patterns: [
            lowerReactPdfRestriction,
            {
              group: ['../renderer', '../renderer/*', '../renderer/**'],
              message: 'Authoring components must not depend on renderer internals.',
            },
          ],
        }],
      },
    },
    {
      files: ['playground/**/*.{ts,vue}'],
      rules: {
        'no-restricted-imports': ['error', {
          patterns: [{
            group: ['**/src/**'],
            message: 'Playground examples must use consumer-supported package and Nuxt APIs.',
          }],
        }],
      },
    },
  )
