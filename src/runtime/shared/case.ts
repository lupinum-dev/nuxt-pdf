// Case conversion of prop and style names, for the renderer and the build.
// Only a lowercase letter after a hyphen starts a word: `data-1` stays as
// written. Template tags follow Vue's own `camelize` instead, which also
// takes digits and `_` (see build/sfc/template-ast.ts).

/** `stroke-width` is `strokeWidth`. */
export const camelCase = (name: string): string =>
  name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())

/** `strokeWidth` is `stroke-width`. */
export const kebabCase = (name: string): string =>
  name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)
