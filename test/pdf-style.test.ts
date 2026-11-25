import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compilePdfSfc, createPdfSfcPlugin } from '../src/build/pdf-sfc-plugin'
import { readPdfColor } from '../src/runtime/shared/color'
import { pdfStyleValueProblem } from '../src/runtime/shared/style-values'
import { renderPdfSfc } from '../src/test'

// The engine's own color pipeline: the style step passes a colour through as
// written and the painter reads it with the one colour rule.
const engineReadsColor = (value: string): boolean => readPdfColor(value) !== undefined

const classesFile = resolve('test/fixtures/pdf-classes/pdfs/class-rules.vue')
const selectorsFile = resolve('test/fixtures/pdf-classes/pdfs/class-selectors.vue')
const styleValuesFile = resolve('test/fixtures/pdf-classes/pdfs/style-values.vue')
const file = resolve('test/fixtures/pdf-sfc/styled.vue')
const importDirectory = resolve('test/fixtures/pdf-style-import')
const importer = resolve(importDirectory, 'styled.vue')

/** An SFC whose template content is on line 5 and whose CSS starts on line 8. */
const sfc = (template: string, css: string, styleTag = '<style>') => [
  '<script setup>',
  'definePdf({})',
  '</script>',
  '<template>',
  `  <PdfDocument><PdfPage>${template}</PdfPage></PdfDocument>`,
  '</template>',
  styleTag,
  css,
  '</style>',
].join('\n')

const compiledRules = async (css: string, from = file, options = {}): Promise<unknown> => {
  const { code } = await compilePdfSfc(sfc('', css), from, 'template', false, options)
  const json = /__nuxtPdfClasses = (\[.*\]);/.exec(code)?.[1]
  return json ? JSON.parse(json) : undefined
}

describe('PDF <style> blocks', () => {
  // Catches a shorthand expanded to the wrong sides or corners, a unit that is
  // dropped (the engine reads `line-height: 14` as 14 × font size), and
  // keyword or color values that are not normalized to what the engine reads.
  it.each([
    ['margin: 1pt 2pt 3pt', { marginTop: '1pt', marginRight: '2pt', marginBottom: '3pt', marginLeft: '2pt' }],
    ['margin: 0 auto', { marginTop: 0, marginRight: 'auto', marginBottom: 0, marginLeft: 'auto' }],
    ['padding: 4mm', { paddingTop: '4mm', paddingRight: '4mm', paddingBottom: '4mm', paddingLeft: '4mm' }],
    ['padding-vertical: 5%', { paddingTop: '5%', paddingBottom: '5%' }],
    ['margin-horizontal: 5', { marginRight: 5, marginLeft: 5 }],
    ['border-width: 1pt 2pt', { borderTopWidth: '1pt', borderRightWidth: '2pt', borderBottomWidth: '1pt', borderLeftWidth: '2pt' }],
    ['border-radius: 1pt 2pt 3pt 4pt', { borderTopLeftRadius: '1pt', borderTopRightRadius: '2pt', borderBottomRightRadius: '3pt', borderBottomLeftRadius: '4pt' }],
    ['border-top: dashed 2pt red', { borderTopWidth: '2pt', borderTopStyle: 'dashed', borderTopColor: 'red' }],
    // Without a style the engine paints solid; the shorthand writes it out so
    // it also resets the style of an earlier rule.
    ['border-bottom: navy 2pt', { borderBottomWidth: '2pt', borderBottomStyle: 'solid', borderBottomColor: 'navy' }],
    // A row gap, then a column gap, as a style object takes them.
    ['gap: 4pt 8mm', { gap: '4pt 8mm' }],
    ['gap: 4', { gap: 4 }],
    // The columns shorthand to its longhands; normal stays for the style step.
    ['columns: 2 120pt', { columnCount: 2, columnWidth: '120pt' }],
    ['columns: 30mm 3', { columnCount: 3, columnWidth: '30mm' }],
    ['columns: 0', { columnWidth: 0 }],
    ['column-gap: normal', { columnGap: 'normal' }],
    // column-rule takes the parts of border and writes the three rule keys.
    ['column-rule: 1pt dashed #CCCCCC', { columnRuleWidth: '1pt', columnRuleStyle: 'dashed', columnRuleColor: '#CCCCCC' }],
    ['column-rule: navy 0.5mm', { columnRuleWidth: '0.5mm', columnRuleStyle: 'solid', columnRuleColor: 'navy' }],
    ['column-rule-width: 2pt', { columnRuleWidth: '2pt' }],
    ['flex: 2', { flexGrow: 2, flexShrink: 1, flexBasis: 0 }],
    ['flex: none', { flexGrow: 0, flexShrink: 0, flexBasis: 'auto' }],
    ['flex: 1 0 30%', { flexGrow: 1, flexShrink: 0, flexBasis: '30%' }],
    ['line-height: 14pt', { lineHeight: '14pt' }],
    ['font-family: "Open Sans"', { fontFamily: 'Open Sans' }],
    ['font-weight: Bold', { fontWeight: 'bold' }],
    ['font-weight: 600', { fontWeight: 600 }],
    ['text-decoration: underline   line-through', { textDecoration: 'underline line-through' }],
    ['transform: rotate(45deg) scale( 2 ,3 )', { transform: 'rotate(45deg) scale(2, 3)' }],
    ['color: Navy', { color: 'Navy' }],
    ['background-color: rgba(0, 0, 0, 0.5)', { backgroundColor: 'rgba(0, 0, 0, 0.5)' }],
    ['color: #ff000080', { color: '#ff000080' }],
    // One colour rule: a border takes alpha like any other colour.
    ['border-top-color: #f008', { borderTopColor: '#f008' }],
    ['border-bottom: 1pt solid rgba(0, 0, 0, 0.5)', { borderBottomWidth: '1pt', borderBottomStyle: 'solid', borderBottomColor: 'rgba(0, 0, 0, 0.5)' }],
  ])('compiles "%s", and the render-time check accepts the result', async (declaration, style) => {
    await expect(compiledRules(`.x { ${declaration} }`)).resolves.toEqual([[['x'], style]])
    // One set of value rules: what the build writes passes the render check.
    expect(Object.entries(style).map(([key, value]) => pdfStyleValueProblem(key, value))).toEqual(Object.keys(style).map(() => undefined))
  })

  // Catches a variable that is not substituted (in a longhand, inside a
  // shorthand, through another variable), an earlier :root declaration that
  // wins over a later one, and a :root rule that leaks into the output.
  it.each([
    ['a longhand', ':root { --gap: 12pt }\n.x { margin-top: var(--gap) }', '.x { margin-top: 12pt }'],
    ['a shorthand', ':root { --muted: #8A938C; --gap: 12pt }\n.x { padding: var(--gap) 0; border-bottom: 1pt solid var(--muted) }', '.x { padding: 12pt 0; border-bottom: 1pt solid #8A938C }'],
    ['a variable that uses another', ':root { --base: #1A2620; --ink: var(--base) }\n.x { color: var(--ink) }', '.x { color: #1A2620 }'],
    ['a later declaration', ':root { --ink: red }\n.x { color: var(--ink) }\n:root { --ink: blue }', '.x { color: blue }'],
  ])('substitutes variables in %s like literal values', async (_case, withVariables, literal) => {
    await expect(compiledRules(withVariables)).resolves.toEqual(await compiledRules(literal))
  })

  it('keeps every rule, its class list and the source order', async () => {
    await expect(compiledRules('.a, .b { color: red }\n/* note */\n.a { color: blue }')).resolves.toEqual([
      [['a', 'b'], { color: 'red' }],
      [['a'], { color: 'blue' }],
    ])
  })

  // One case per rejection kind, each with the position the author must fix.
  it.each([
    ['style attribute', sfc('', '.a {}', '<style scoped>'), 'styled.vue:7:15 <style scoped> is not supported in PDF components.'],
    ['CSS syntax', sfc('', '.a { color: red'), 'styled.vue:8:1 Invalid CSS: Unclosed block.'],
    ['selector', sfc('', '.a { color: red }\n.b > .c { color: red }'), 'styled.vue:9:1 Child combinator ">" is not supported in PDF styles; found ".b > .c". Use class selectors: .a, .a.b or .a .b.'],
    ['at-rule', sfc('', '@font-face { font-family: X }'), 'styled.vue:8:1 @font-face is not supported in PDF styles. Register fonts with pdf.fonts.'],
    ['nested rule', sfc('', '.a {\n  .b { color: red }\n}'), 'styled.vue:9:3 Nested rules are not supported in PDF styles.'],
    ['declaration outside a rule', sfc('', 'color: red;'), 'styled.vue:8:1 Declarations must be inside a class rule in PDF styles.'],
    ['unknown property', sfc('', '.a { background: red }'), 'styled.vue:8:6 Unsupported PDF style property "background". Use background-color.'],
    ['camelCase property', sfc('', '.a { fontSize: 1pt }'), 'styled.vue:8:6 Unsupported PDF style property "fontSize". Use kebab-case "font-size".'],
    ['invalid value', sfc('', '.a { color: bleu }'), 'styled.vue:8:13 Invalid value "bleu" for "color": expected a hex color'],
    ['value on the line after its property', sfc('', '.a {\n  color:\n    bleu;\n}'), 'styled.vue:10:5 Invalid value "bleu" for "color"'],
    ['!important', sfc('', '.a { color: red !important }'), 'styled.vue:8:6 !important is not supported in PDF styles'],
    ['undefined static class', sfc('<PdfText class="a missing">x</PdfText>', '.a {}'), 'styled.vue:5:43 Class "missing" is not defined in the <style> block of this file.'],
    ['undefined literal in :class', sfc('<PdfText :class="{ missing: true }">x</PdfText>', '.a {}'), 'styled.vue:5:34 Class "missing" is not defined in the <style> block of this file.'],
    ['unknown variable', sfc('', '.a { color: var(--x) }'), 'styled.vue:8:13 Unknown variable "--x". Declare it in :root { --x: … }.'],
    ['var() with a fallback', sfc('', ':root { --ink: red }\n.a { color: var(--ink, red) }'), 'styled.vue:9:13 var() takes one variable name, for example var(--ink).'],
    ['variable cycle', sfc('', ':root {\n  --a: var(--b);\n  --b: var(--a);\n}'), 'styled.vue:10:8 Variable "--a" refers to itself.'],
    ['variable outside :root', sfc('', '.a { --ink: red }'), 'styled.vue:8:6 Declare variables in a :root rule.'],
    ['property in :root', sfc('', ':root { color: red }'), 'styled.vue:8:9 :root holds variables only (--name: value).'],
    ['invalid value through a variable', sfc('', ':root { --c: bleu }\n.a { color: var(--c) }'), 'styled.vue:9:13 Invalid value "bleu" for "color": expected a hex color'],
    ['class on a primitive without style', sfc('<PdfSvg><PdfRect class="a" width="1" height="1" /></PdfSvg>', '.a {}'), 'styled.vue:5:42 <PdfRect> has no style, so it cannot take a class.'],
  ])('rejects %s with its position', async (_kind, source, message) => {
    await expect(compilePdfSfc(source, file, 'template')).rejects.toThrow(message)
  })

  // Catches values the engine would misread or ignore silently.
  it.each([
    ['margin: 1pt 2pt 3pt 4pt 5pt', 'expected one to four values'],
    ['flex: 1 2', 'expected a number, auto, none, or grow shrink basis'],
    ['border: 1pt solid', 'expected a width, a color and optionally a style, in any order'],
    ['column-rule: 1pt solid', 'expected a width, a color and optionally a style, in any order'],
    ['column-rule: none', 'expected a width, a color and optionally a style'],
    ['column-rule-style: double', 'expected one of solid, dashed, dotted'],
    ['font-family: Inter, sans-serif', 'expected one font family name'],
    ['gap: 1pt 2pt 3pt', 'expected one or two values, each a number of points or a length'],
    ['columns: 1.5', 'expected a whole number of columns, a column width such as 120pt, or both'],
    ['columns: 2 3', 'expected a whole number of columns'],
    ['columns: 2 120pt 3', 'expected a whole number of columns'],
    ['font-weight: 1001', 'expected a number or a weight name'],
    ['transform: skew(10)', 'expected rotate(), scale(), translate() or skew() operations, or their X and Y forms'],
    ['object-position: right 10pt bottom 4pt', 'expected one or two parts, each a length, a percentage, or left, center, right, top or bottom'],
    ['text-transform: upperfirst', 'expected one of none, capitalize, lowercase, uppercase. "upperfirst" is not CSS; "capitalize" sets the first letter of every word in upper case'],
    ['text-align: middle', 'expected one of left, right, center, justify'],
  ])('rejects "%s"', async (declaration, message) => {
    await expect(compiledRules(`.x { ${declaration} }`)).rejects.toThrow(message)
  })

  // Catches a value the engine reads that the compiler drops or misspells:
  // the transforms beyond rotate, scale and translate, the keywords of
  // object-position (written as the percentages the painter reads), static
  // positioning and align-content.
  it('compiles the engine forms that are CSS', async () => {
    await expect(compiledRules('.x { transform: skewX(10deg) translateX(4) scaleY(2); object-position: top left; position: static; align-content: space-between }')).resolves.toEqual([
      [['x'], { transform: 'skewX(10deg) translateX(4) scaleY(2)', objectPosition: '0% 0%', position: 'static', alignContent: 'space-between' }],
    ])
  })

  // Catches em dropped or refused on the keys that take it: the spacing
  // keys, their shorthands, the gaps and width (PDF_EM_STYLE_KEYS).
  it('compiles em lengths on the spacing keys and width', async () => {
    await expect(compiledRules('.x { margin: 1em 2pt; padding-left: 0.5em; gap: 1em 2em; column-gap: 1em; width: 3em }')).resolves.toEqual([
      [['x'], { marginTop: '1em', marginRight: '2pt', marginBottom: '1em', marginLeft: '2pt', paddingLeft: '0.5em', gap: '1em 2em', columnGap: '1em', width: '3em' }],
    ])
  })

  // Catches a color that compiles but that the engine cannot read: the engine
  // paints such a color black. Every form is checked against the engine's own
  // parser, so an engine update that drops a form fails here.
  it.each([
    '#abc', '#abcd', '#aabbcc', '#aabbcc80', 'navy', 'rgb(1, 2, 3)', 'rgba(1, 2, 3, 0.5)', 'rgb(1 2 3)',
    'rgb(1 2 3 / 50%)', 'rgb(10%, 20%, 30%)', 'rgb(10% 20% 30% / 0.5)', 'rgba(1, 2, 3)', 'RGB(1, 2, 3)',
    'hsl(120, 50%, 50%)', 'hsla(120, 50%, 50%, 0.5)', 'hsl(120deg 50% 50%)', 'hsl(120 50% 50% / 0.5)', 'hsl(-1.5, 1%, 1%)',
    'transparent', 'rebeccapurple', 'hwb(120 20% 30%)', 'hwb(120, 20%, 30%, 0.5)',
  ])('accepts the color %s, which the engine reads', async (color) => {
    expect(engineReadsColor(color)).toBe(true)
    await expect(compiledRules(`.x { color: ${color} }`)).resolves.toEqual([[['x'], { color }]])
    expect(pdfStyleValueProblem('color', color)).toBeUndefined()
  })

  // Catches a channel half way between two whole values rounded down (the
  // stylesheet package's float arithmetic gave 229, #E599A6).
  it('reads an hsl() channel on a half step as the higher value', () => {
    expect(readPdfColor('hsl(350, 60%, 75%)')).toEqual({ rgb: [230, 153, 166], alpha: 1 })
  })

  it.each([
    'hsl(120, 50, 50)', 'hsl(120 50 50)', 'rgb(10%, 2, 3)', 'rgb(1deg, 2, 3)', 'hsl(120, 50%, 50%, 50%)',
    'hsla(1rad,1%,1%)', 'hsl(120 50% 50% / 50%)', 'rgb(1, 2)', '#abcde',
    // No hue (read as NaN before), a hue run into the saturation.
    'hwb( 20% 30%)', 'hsl(12050%, 50%)',
  ])('rejects the color %s, which the engine paints black', async (color) => {
    expect(engineReadsColor(color)).toBe(false)
    await expect(compiledRules(`.x { color: ${color} }`)).rejects.toThrow(`Invalid value "${color}" for "color"`)
    expect(pdfStyleValueProblem('color', color)).toBeDefined()
  })

  // Catches a negative size, padding or border width and an opacity outside
  // 0 to 1 that the compiler wrote and the engine drew (V4); `:style` and
  // v-bind() values take the same rule at render time (test/renderer.test.ts).
  it.each([
    ['font-size: -4pt', 'Invalid value "-4pt" for "font-size": expected a value above 0.'],
    ['line-height: 0', 'Invalid value "0" for "line-height": expected a value above 0.'],
    ['padding: 4pt -2pt', 'Invalid value "4pt -2pt" for "padding": expected a value of 0 or more.'],
    ['border: -1pt solid red', 'Invalid value "-1pt solid red" for "border": expected a value of 0 or more.'],
    ['column-rule: -1pt solid red', 'Invalid value "-1pt solid red" for "column-rule": expected a value of 0 or more.'],
    ['opacity: 1.5', 'Invalid value "1.5" for "opacity": expected a number from 0 to 1.'],
    ['flex: 1 -1 0', 'Invalid value "1 -1 0" for "flex": expected a value of 0 or more.'],
    ['max-lines: 0', 'Invalid value "0" for "max-lines": expected a whole number of 1 or more.'],
  ])('rejects "%s" by the sign rule', async (declaration, message) => {
    await expect(compiledRules(`.x { ${declaration} }`)).rejects.toThrow(message)
  })

  // Catches a percentage font size that the compiler rejects or rewrites.
  it('compiles a percentage font size', async () => {
    await expect(compiledRules('.x { font-size: 70% }')).resolves.toEqual([[['x'], { fontSize: '70%' }]])
  })

  it('compiles negative margins, insets and letter spacing', async () => {
    await expect(compiledRules('.x { margin-top: -4pt; left: -2pt; letter-spacing: -0.5pt }')).resolves.toEqual([[['x'], { marginTop: '-4pt', left: '-2pt', letterSpacing: '-0.5pt' }]])
  })

  // Catches var() replaced inside a string, a long chain that overflows the
  // call stack, and a doubling chain that builds a huge string.
  it('keeps var() in a quoted string literal', async () => {
    await expect(compiledRules(':root { --f: Inter }\n.x { font-family: "var(--f)" }')).resolves.toEqual([[['x'], { fontFamily: 'var(--f)' }]])
  })

  it('resolves a chain of 5000 variables, each declared before the one it uses', async () => {
    const count = 5000
    const declarations = Array.from({ length: count }, (_, index) => `--v${index}: ${index === count - 1 ? 'red' : `var(--v${index + 1})`};`)
    await expect(compiledRules(`:root { ${declarations.join(' ')} }\n.x { color: var(--v0) }`)).resolves.toEqual([[['x'], { color: 'red' }]])
  })

  it('rejects a variable that resolves to more than 10000 characters', async () => {
    const declarations = Array.from({ length: 20 }, (_, index) => index === 0 ? '--v0: 1pt;' : `--v${index}: var(--v${index - 1}) var(--v${index - 1});`)
    await expect(compilePdfSfc(sfc('', `:root {\n${declarations.join('\n')}\n}`), file, 'template')).rejects.toThrow(
      /styled\.vue:\d+:\d+ This value is longer than 10000 characters after var\(\) substitution/,
    )
  })

  // Catches the style block and style objects disagreeing about a length unit.
  it.each(['12pt', '12px', '1in', '4mm', '1cm', '2rem', '10vh', '10vw'])('compiles the length %s', async (length) => {
    const { code } = await compilePdfSfc(sfc('', `.a { margin-top: ${length} }`), file, 'template')
    expect(code).toContain(`"marginTop": "${length}"`)
  })

  // Catches browser-only syntax that compiled into a value the engine misreads.
  it.each([
    ['.a { font-size: 1.2em }', 'styled.vue:8:17 The unit "em" is not supported in PDF styles ("1.2em" for "font-size"). Supported units: pt, px, in, mm, cm, rem, vh, vw and %.'],
    ['.a { padding: 4pt 2ch }', 'The unit "ch" is not supported'],
    [':root { --size: 2em }\n.a { height: var(--size) }', 'The unit "em" is not supported'],
    ['.a { padding: 1em 2ex }', 'styled.vue:8:15 The unit "ex" is not supported in PDF styles ("1em 2ex" for "padding"). Supported units: pt, px, in, mm, cm, rem, vh, vw, em and %.'],
  ])('rejects "%s" with a hint', async (css, message) => {
    await expect(compilePdfSfc(sfc('', css), file, 'template')).rejects.toThrow(message)
  })

  // Catches a class that is silently dropped on an element that renders
  // nothing, a valid non-ASCII class name that fails, and an error column
  // that is off by one for an unquoted value.
  // The template text starts in column 25 of line 5.
  it.each([
    ['<template v-for="i in 2" :key="i" class="a"><PdfText>x</PdfText></template>', 'class=', 'A class on <template> is not applied: <template> renders no element. Put the class on the PDF component inside the <template>.'],
    ['<template v-if="true" :class="{ a: true }"><PdfText>x</PdfText></template>', ':class', 'A class on <template> is not applied'],
    ['<PdfView><slot class="a" /></PdfView>', 'class=', 'A class on <slot> is not applied: a slot renders no element.'],
    ['<PdfText class=zz>x</PdfText>', 'zz', 'Class "zz" is not defined'],
  ])('rejects the class in %s with its position', async (template, at, message) => {
    await expect(compilePdfSfc(sfc(template, '.a {}'), file, 'template')).rejects.toThrow(`styled.vue:5:${25 + template.indexOf(at)} ${message}`)
  })

  it('compiles a class name with non-ASCII letters', async () => {
    const { code } = await compilePdfSfc(sfc('<PdfText class="größe">x</PdfText>', '.größe { font-size: 20pt }'), file, 'template')
    expect(code).toContain('$nuxtPdfClass("größe")')
    expect(code).toContain('[[["größe"], { "fontSize": "20pt" }]]')
  })

  // Catches classes applied in attribute order instead of stylesheet order,
  // classes winning over `style`, classes resolved in the wrong file for a
  // local component or for slot content, and a dynamic class that is ignored.
  it('applies classes in stylesheet order, with style last, in the file that wrote them', async () => {
    const { parsed } = await renderPdfSfc(classesFile, { big: true })
    const fontSize = (text: string) => parsed.pages[0]!.textRuns.find(run => run.text === text)?.fontSize

    expect({
      StylesheetOrder: fontSize('StylesheetOrder'),
      StyleWins: fontSize('StyleWins'),
      DynamicObject: fontSize('DynamicObject'),
      BadgeOwn: fontSize('BadgeOwn'),
      BadgePassed: fontSize('BadgePassed'),
      SlotContent: fontSize('SlotContent'),
    }).toEqual({
      StylesheetOrder: 24,
      StyleWins: 30,
      DynamicObject: 24,
      BadgeOwn: 13,
      BadgePassed: 24,
      SlotContent: 24,
    })
  }, 30_000)

  it('rejects a dynamic class that the file does not define', async () => {
    await expect(renderPdfSfc(classesFile, { big: false, extra: 'nope' })).rejects.toMatchObject({
      code: 'PDF_TREE_INVALID',
      message: expect.stringContaining('Unknown PDF class "nope" in <class-rules>. Define .nope in the <style> block of that file.'),
    })
  }, 30_000)

  // Catches a selector kind that compiles into a rule that never matches (or
  // matches too much) instead of failing with what works.
  it.each([
    ['PdfText .a', 'Type selector "PdfText"'],
    ['.a + .b', 'Sibling combinator "+"'],
    ['.a ~ .b', 'Sibling combinator "~"'],
    ['.a:first-child', 'Pseudo-class ":first-child"'],
    ['.a::before', 'Pseudo-element "::before"'],
    ['.a[title]', 'Attribute selector'],
    ['#total', 'Id selector'],
    ['.a *', 'Universal selector "*"'],
  ])('rejects the selector "%s"', async (selector, kind) => {
    await expect(compiledRules(`${selector} { color: red }`)).rejects.toThrow(
      `styled.vue:8:1 ${kind} is not supported in PDF styles; found "${selector}". Use class selectors: .a, .a.b or .a .b.`,
    )
  })

  it('stores compound and descendant selectors with their classes', async () => {
    await expect(compiledRules('.ledger .row.total  .cell, .a { color: red }')).resolves.toEqual([
      [['ledger row.total cell', 'a'], { color: 'red' }],
    ])
  })

  // Catches a bound part that lands on the wrong longhand, a duplicate
  // expression that gets a second index, a later static declaration that
  // does not replace a bound one, and a variable whose v-bind() is lost.
  it.each([
    ['color: v-bind(accent)', {}, { color: 0 }],
    ['padding: 4pt v-bind(gutter)', { paddingTop: '4pt', paddingBottom: '4pt' }, { paddingRight: 0, paddingLeft: 0 }],
    ['border-bottom: 1pt solid v-bind("theme.rule")', { borderBottomWidth: '1pt', borderBottomStyle: 'solid' }, { borderBottomColor: 0 }],
    ['border-top: v-bind(width) red', { borderTopStyle: 'solid', borderTopColor: 'red' }, { borderTopWidth: 0 }],
    ['flex: v-bind(grow) 1 0', { flexShrink: 1, flexBasis: 0 }, { flexGrow: 0 }],
    ['color: v-bind(accent); border-color: v-bind( accent )', {}, { color: 0, borderTopColor: 0, borderRightColor: 0, borderBottomColor: 0, borderLeftColor: 0 }],
    ['color: v-bind(accent); color: red', { color: 'red' }, undefined],
  ])('compiles the bound declaration "%s"', async (declarations, style, bound) => {
    await expect(compiledRules(`.x { ${declarations} }`)).resolves.toEqual([bound ? [['x'], style, bound] : [['x'], style]])
  })

  it('binds through a :root variable and passes a getter of the values to the template', async () => {
    const source = sfc('<PdfText class="x">x</PdfText>', ':root { --ink: v-bind(\'tokens.ink\') }\n.x { color: var(--ink); border-bottom: 1pt solid var(--ink) }')
    const { code } = await compilePdfSfc(source, file, 'template')
    expect(code).toContain('"color": 0')
    expect(code).toContain('"borderBottomColor": 0')
    expect(code).toMatch(/\$nuxtPdfClass\("x", void 0, void 0, \(\) => \[_ctx\.tokens\.ink\]\)/)
  })

  it.each([
    ['.a { border: v-bind(rule) }', 'styled.vue:8:14 v-bind() in "border" needs the other parts written out, such as "1pt solid v-bind(color)". Or use the longhands border-width, border-style and border-color.'],
    ['.a { border-top: v-bind(w) solid v-bind(c) }', 'v-bind() in "border-top" needs the other parts written out'],
    ['.a { flex: v-bind(n) }', 'v-bind() in "flex" needs three parts (grow shrink basis)'],
    ['.a { margin-top: v-bind(gap)pt }', 'styled.vue:8:18 v-bind() must be a whole value. Put the unit into the bound value, such as \'12pt\'.'],
    ['.a { transform: rotate(v-bind(angle)) }', 'v-bind() must be a whole value.'],
    ['.a { color: red v-bind(x) }', 'v-bind() must be a whole value.'],
    ['.a { gap: v-bind(row) 4pt }', 'styled.vue:8:11 v-bind() must be a whole value.'],
    ['.a { color: v-bind(a b) }', 'styled.vue:8:13 v-bind() takes one JavaScript expression, such as v-bind(accent) or v-bind(\'theme.ink\'); found "v-bind(a b)".'],
    [':root { --c: v-bind() }', 'styled.vue:8:14 v-bind() takes one JavaScript expression'],
    // R1-3: two expressions in quotes would shift every later binding by one.
    ['.a { font-size: v-bind(\'a), (b\'); color: v-bind(c) }', 'styled.vue:8:17 v-bind() takes one JavaScript expression, such as v-bind(accent) or v-bind(\'theme.ink\'); found "v-bind(\'a), (b\')".'],
    // R1-4: TypeScript syntax in a file whose script is plain JavaScript.
    ['.a { font-size: v-bind(\'size as number\') }', 'styled.vue:8:17 v-bind(\'size as number\') uses TypeScript syntax, but the <script> of this file is JavaScript. Write a JavaScript expression, or add lang="ts" to the <script> block.'],
  ])('rejects the bound value in "%s"', async (css, message) => {
    await expect(compilePdfSfc(sfc('', css), file, 'template')).rejects.toThrow(message)
  })

  // Catches a v-bind() or an ancestor class read inside a v-for or slot scope
  // that redeclares its name: it would read the loop value without an error.
  // The template text starts in column 25 of line 5.
  it.each([
    [
      '<PdfView v-for="accent in [1]" :key="accent"><PdfText class="a">x</PdfText></PdfView>',
      '.a { color: v-bind(accent) }',
      'v-bind(accent) in the <style> block reads "accent", but the v-for alias "accent" hides it on this element. Rename the v-for alias.',
    ],
    [
      '<PdfView v-for="row in rows" :key="row.id" :class="row.kind"><PdfView v-for="row in row.items" :key="row"><PdfText class="cell">x</PdfText></PdfView></PdfView>',
      '.total .cell { color: red }',
      'The class of an enclosing element reads "row", but the v-for alias "row" hides it on this element',
    ],
    [
      '<PdfView :class="kind"><Wrap v-slot="{ kind }"><PdfText class="cell">x</PdfText></Wrap></PdfView>',
      '.total .cell { color: red }',
      'The class of an enclosing element reads "kind", but the slot prop "kind" hides it on this element',
    ],
  ])('rejects a hidden name in %s', async (template, css, message) => {
    const at = template.lastIndexOf('class=')
    await expect(compilePdfSfc(sfc(template, css), file, 'template')).rejects.toThrow(`styled.vue:5:${25 + at} ${message}`)
  })

  // Catches selectors applied by attribute order instead of specificity, a
  // descendant step that needs a direct parent or ignores a dynamic or v-for
  // ancestor class, a compound that matches one of its classes, and bound
  // values that are not read from the script, a :root variable or a prop.
  it('applies compound, descendant and bound rules by specificity, then order', async () => {
    const fontSizes = async (props: { kind: 'total' | 'subtotal', size?: number }) => {
      const { parsed } = await renderPdfSfc(selectorsFile, props)
      return Object.fromEntries(parsed.pages[0]!.textRuns.filter(run => run.text.trim()).map(run => [run.text, run.fontSize]))
    }
    expect(await fontSizes({ kind: 'total', size: 13 })).toEqual({
      DynamicAncestor: 20,
      DeepDescendant: 20,
      NoAncestor: 9,
      Compound: 16,
      CompoundNeedsBoth: 10,
      BoundFromScript: 22,
      BoundThroughRoot: 17,
      BoundFromProp: 13,
    })
    // A dynamic ancestor class that no longer matches, and a missing bound
    // value that leaves the key out.
    expect(await fontSizes({ kind: 'subtotal' })).toMatchObject({ DynamicAncestor: 9, BoundFromProp: 10 })
  }, 30_000)

  // R1-1 and R1-2: catches a bound or :style value that renders without an
  // error although the same value fails the build (the text disappears, a
  // border paints a wrong color), and a non-string value that crashed the
  // engine with an internal PDF_LAYOUT_ERROR.
  it.each([
    [selectorsFile, { kind: 'total', size: 'banana' }, 'v-bind(props.size) for "font-size" gave "banana": expected a number of points, a length such as 12pt, or a percentage.'],
    [selectorsFile, { kind: 'total', size: '1.2em' }, 'v-bind(props.size) for "font-size" gave "1.2em": expected a number of points'],
    [selectorsFile, { kind: 'total', size: false }, 'v-bind(props.size) for "font-size" gave false: expected a number of points'],
    [selectorsFile, { kind: 'total', size: { a: 1 } }, 'v-bind(props.size) for "font-size" gave an object: expected a number of points'],
    [styleValuesFile, { style: { fontSize: 'banana' } }, ':style value "banana" for "fontSize" is invalid: expected a number of points, a length such as 12pt, or a percentage.'],
    [styleValuesFile, { style: { color: 'bleu' } }, ':style value "bleu" for "color" is invalid: expected a hex color'],
    [styleValuesFile, { style: { borderTopColor: 'currentColor' } }, ':style value "currentColor" for "borderTopColor" is invalid: expected a hex color'],
    [styleValuesFile, { style: { color: false } }, ':style value false for "color" is invalid: expected a hex color'],
  ])('rejects an invalid render-time style value (%#)', async (template, props, message) => {
    await expect(renderPdfSfc(template, props)).rejects.toMatchObject({
      code: 'PDF_TREE_INVALID',
      message: expect.stringContaining(message),
    })
  }, 30_000)

  // D1: catches a render-time check that rejects a value the engine reads
  // correctly. Each row rendered like its canonical form before the check
  // existed (raster comparison, D16).
  it.each([
    // Colors: the one colour rule (shared/color.ts), checked against the engine below.
    ['backgroundColor', 'transparent'], ['backgroundColor', 'Transparent'], ['backgroundColor', 'rebeccapurple'],
    ['backgroundColor', 'hwb(120 20% 30%)'], ['backgroundColor', 'hwb(120, 20%, 30%)'], ['backgroundColor', 'hwb(120 20% 30% 0.5)'],
    ['backgroundColor', ' #336699 '], ['backgroundColor', 'rgb(1e2, 0, 0)'], ['backgroundColor', 'rgb(255 0, 0)'],
    ['backgroundColor', 'hsl(120, 50%, 50%, 5e-1)'], ['color', 'transparent'], ['color', 'RED'], ['color', 'hwb(120 0% 0%)'],
    ['textDecorationColor', 'transparent'], ['textDecorationColor', 'rebeccapurple'],
    ['borderColor', ' #ff0000'], ['borderColor', '#F00'], ['borderColor', 'rgba(255, 0, 0, 1)'], ['borderTopColor', 'hsl(0, 100%, 50%)'],
    // Border colors with alpha, names in any case, rebeccapurple and hwb() (refused before the one colour rule).
    ['borderColor', 'transparent'], ['borderTopColor', '#ff000080'], ['borderTopColor', 'RED'], ['borderColor', 'rebeccapurple'], ['borderColor', 'hwb(0 0% 0%)'],
    // auto: Yoga reads it (min and max sizes: as their default).
    ['width', 'auto'], ['height', 'auto'], ['minWidth', 'auto'], ['minHeight', 'auto'], ['maxWidth', 'auto'], ['maxHeight', 'auto'],
    ['top', 'auto'], ['right', 'auto'], ['bottom', 'auto'], ['left', 'auto'],
    // Strings that reach Yoga, which reads them with parseFloat as points.
    ['width', '+12'], ['width', '1e2'], ['width', '12.'], ['width', '12PT'], ['width', '1.5e1pt'], ['width', ' 12'], ['width', '12 '],
    ['width', ' 50%'], ['width', '+50%'], ['top', '+10'], ['flexBasis', '+40'],
    // Box shorthands: 1 to 4 parts for margin and padding, 1 to 2 for the axes.
    ['margin', '20 40'], ['margin', '4pt 8pt'], ['margin', '1 12 3 24'], ['margin', '1 12 3'], ['margin', '10 auto'],
    ['margin', '5% 10mm'], ['margin', '5 -4'], ['margin', '5\t10'], ['margin', ' 5 10 '], ['margin', '+12'], ['margin', '1e1'],
    ['margin', '1.5e1pt'], ['margin', '+5%'], ['marginHorizontal', '10 20'], ['marginVertical', '10 auto'], ['marginTop', 'auto'],
    ['padding', '10pt 30pt'], ['padding', '1 12 3 24'], ['padding', '+5'], ['paddingHorizontal', '10 20'],
    ['gap', '4 8'], ['gap', '5pt 10pt'], ['gap', '+4'],
    // columns: a count, a width or both; columnGap normal is 1em.
    ['columns', '2'], ['columns', '120pt'], ['columns', '2 120pt'], ['columns', '120pt 2'], ['columnGap', 'normal'],
    ['columnRuleWidth', '0.5mm'], ['columnRuleWidth', '0'], ['columnRuleStyle', 'dotted'], ['columnRuleColor', '#ff000080'],
    // Transforms that the pinned parser applies correctly.
    ['transform', 'translate(10px, 20px)'], ['transform', 'translate(10pt, 20pt)'], ['transform', 'translate(30)'],
    ['transform', 'translateX(30px)'], ['transform', 'translateY(30)'], ['transform', 'scaleX(2)'], ['transform', 'scaleY(2)'],
    ['transform', 'scale(2 1)'], ['transform', 'rotate(45)'], ['transform', 'rotate(0.785398rad)'], ['transform', 'skew(10deg, 5deg)'],
    ['transform', 'skew(10deg)'], ['transform', 'skewX(0.2rad)'], ['transform', 'skewY(10deg)'],
    ['transform', 'translate(10, 0) translate(0, 10) translate(5, 5) translate(5, 5)'], ['transform', 'translate(10, 0),translate(0, 10)'],
    ['transform', 'translate(10, 0)translate(0, 10)'], ['transform', 'translate( 10 , 20 )'],
    // flex: the engine's own shorthand.
    ['flex', '1 1 auto'], ['flex', '1 0 0'], ['flex', '1 0 30%'], ['flex', '1 1 40mm'], ['flex', '1 1'], ['flex', '2'],
    ['flex', 'auto'], ['flex', 'none'], ['flex', 'initial'],
    // Numbers read with parseFloat.
    ['opacity', '+0.5'], ['opacity', '5e-1'], ['opacity', ' 0.5 '], ['opacity', '.5'], ['flexGrow', '1e0'],
    // Keywords the engine implements, and weight names in any case.
    ['objectFit', 'fill'], ['objectFit', 'none'], ['objectFit', 'scale-down'], ['position', 'static'],
    ['fontWeight', 'Bold'], ['fontWeight', 'BOLD'],
  ])('accepts every style value that the engine reads: %s %j', (key, value) => {
    if (/Color$|^color$/.test(key)) expect(engineReadsColor(value)).toBe(true)
    expect(pdfStyleValueProblem(key, value)).toBeUndefined()
  })

  // D1: catches an engine form applied too widely. Each row rendered wrong,
  // was dropped or crashed before the check existed.
  it.each([
    ['backgroundColor', 'hsl(120 50% 50% / 50%)', 'expected a hex color'],
    ['backgroundColor', 'currentColor', 'expected a hex color'],
    ['borderColor', 'currentColor', 'expected a hex color'],
    ['width', ' 12px', 'expected a number of points, a length such as 12pt, or a percentage'],
    ['width', '12mm ', 'a percentage'], ['width', '12MM', 'a percentage'], ['width', '10vmin', 'a percentage'],
    ['width', '5e1%', 'a percentage'], ['width', '12abc', 'a percentage'], ['width', ' auto', 'a percentage'],
    ['fontSize', '+20', 'expected a number of points, a length such as 12pt, or a percentage'], ['fontSize', '20PT', 'a length'], ['fontSize', ' 20pt', 'a length'],
    ['letterSpacing', '+2', 'a length'],
    ['margin', '12PT', 'a percentage or auto'], ['margin', '12.', 'auto'], ['margin', '1.5e1mm', 'auto'], ['margin', '5PX', 'auto'],
    ['margin', '1 2 3 4 5', 'auto'], ['margin', '5, 10', 'auto'], ['marginTop', '10 20', 'auto'], ['margin', '5 10', 'auto'],
    ['padding', '10 auto', 'or a percentage'], ['paddingTop', 'auto', 'or a percentage'],
    ['gap', '4\t8', 'a length'], ['gap', '4  8', 'a length'], ['gap', '4 8 12', 'a length'], ['gap', 'auto', 'a length'],
    // A percentage gap: in a column, pagination broke after every child.
    ['gap', '5%', 'a length'], ['gap', '4 5%', 'a length'],
    ['borderRadius', '4 8', 'a length'], ['borderWidth', '1 2', 'a length'],
    // A column count that is not whole and 1 or more, two counts, or a negative width.
    ['columns', 2.5, 'a whole number of columns'], ['columns', 0, 'a whole number of columns'], ['columns', '2 3', 'a whole number of columns'],
    ['columns', '-120pt', 'a whole number of columns'], ['columnGap', 'auto', 'or normal'],
    // A rule width is a length, as a border width: no percentage, no em.
    ['columnRuleWidth', '10%', 'a length'], ['columnRuleWidth', '1em', 'a length'],
    ['columnRuleStyle', 'none', 'expected one of solid, dashed, dotted'],
    ['transform', 'translate(10mm, 0)', 'expected rotate(), scale(), translate() or skew() operations, or their X and Y forms'],
    ['transform', 'translate(50%, 0)', 'operations'], ['transform', 'rotate(0.125turn)', 'operations'],
    ['transform', 'matrix(2, 0, 0, 2, 0, 0)', 'operations'], ['transform', 'rotate(45, 10, 10)', 'operations'],
    ['transform', 'ROTATE(45deg)', 'operations'], ['transform', 'translate(10  20)', 'operations'],
    ['transform', 'translate(1, 2) , scale(2)', 'operations'], ['transform', 'none', 'operations'],
    ['flex', '1 30pt', 'expected a number'], ['flex', '1  1 40pt', 'a number'], ['flex', '1\t1', 'a number'],
    ['lineHeight', 'normal', 'expected a number, a length or a percentage'], ['opacity', '50%', 'expected a number'],
    ['borderStyle', 'none', 'expected one of solid, dashed, dotted'], ['textDecoration', 'underline solid', 'expected one of none'],
    ['textAlign', 'Center', 'expected one of left'], ['fontStyle', 'Italic', 'expected one of normal'],
    ['fontSize', Number.NaN, 'a length'],
    // object-position: what CSS rejects, and the forms with edge offsets,
    // which the painter has no place for.
    ['objectPosition', 'top 10pt', 'expected one or two parts'], ['objectPosition', '10pt left', 'one or two parts'],
    ['objectPosition', 'left right', 'one or two parts'], ['objectPosition', 'right 10pt bottom 4pt', 'one or two parts'],
    ['objectPosition', '10px 20px 30px', 'one or two parts'], ['objectPosition', 'Left', 'one or two parts'],
    // upperfirst is not CSS; the hint names capitalize and the difference.
    ['textTransform', 'upperfirst', 'one of none, capitalize, lowercase, uppercase. "upperfirst" is not CSS; "capitalize" sets the first letter of every word in upper case, so to raise only the first letter of the text, write it in upper case'],
  ])('rejects a style value that the engine misreads: %s %j', (key, value, message) => {
    expect(pdfStyleValueProblem(key, value)).toContain(message.replace(/^expected /, ''))
  })

  // D1: the wider render-time forms reach the engine through :style and
  // v-bind() and render.
  it('renders engine forms from :style and v-bind()', async () => {
    const style = { margin: '4 8', width: 'auto', backgroundColor: 'transparent', transform: 'translateX(10px)', fontWeight: 'Bold', flex: '1 1 auto' }
    await expect(renderPdfSfc(styleValuesFile, { style })).resolves.toBeDefined()
    await expect(renderPdfSfc(selectorsFile, { kind: 'total', size: '+12' })).rejects.toMatchObject({ code: 'PDF_TREE_INVALID' })
    await expect(renderPdfSfc(styleValuesFile, { style: { borderColor: 'transparent' } })).resolves.toBeDefined()
  }, 30_000)

  // Catches imported rules placed after the importing file's rules, an
  // imported :root variable that wins over the importer's, a nested import
  // that is lost, and a file imported twice that is applied twice.
  it.each([
    ['a relative path', '@import \'./theme.css\';', {}],
    ['an alias', '@import \'~/theme.css\';', { alias: { '~': importDirectory } }],
    ['a file imported twice', '@import \'./diamond.css\';\n@import \'./theme.css\';', {}],
  ])('imports a .css file through %s, before the rules of the importing file', async (_case, imports, options) => {
    await expect(compiledRules(`${imports}\n:root { --ink: #445566 }\n.title { color: navy }`, importer, options)).resolves.toEqual([
      [['title'], { fontSize: '20pt', color: '#445566' }],
      [['muted'], { color: '#8A938C' }],
      [['title'], { color: 'navy' }],
    ])
  })

  // R1-5: catches a file imported twice that counts at its first place. A
  // browser applies it at its last place, so red wins here.
  it('applies a file imported twice at its last place, like a browser', async () => {
    await expect(compiledRules('@import \'./order-blue.css\';\n@import \'./order-red.css\';', importer)).resolves.toEqual([
      [['x'], { color: 'blue' }],
      [['x'], { color: 'red' }],
    ])
  })

  it.each([
    ['url()', '@import url(./theme.css);', 'styled.vue:8:1 @import takes a local path in quotes, such as @import \'./theme.css\'.'],
    ['a URL', '@import \'https://example.com/theme.css\';', '@import takes a local path in quotes, such as @import \'./theme.css\'. URLs are not loaded.'],
    ['a media query', '@import \'./theme.css\' print;', '@import takes only a path in PDF styles'],
    ['an import after a rule', '.a { color: red }\n@import \'./theme.css\';', 'styled.vue:9:1 @import must come before every rule of the style block.'],
    ['a file that is not .css', '@import \'./theme.scss\';', '@import reads .css files only; found "./theme.scss".'],
    ['a bare path', '@import \'theme.css\';', '@import takes a path relative to this file or one that starts with an alias'],
    ['a missing file', '@import \'./missing.css\';', '@import cannot find "./missing.css" (resolved to test/fixtures/pdf-style-import/missing.css).'],
    ['a cycle', '@import \'./cycle-a.css\';', 'cycle-b.css:1:1 @import "./cycle-a.css" imports itself through test/fixtures/pdf-style-import/cycle-a.css → test/fixtures/pdf-style-import/cycle-b.css → test/fixtures/pdf-style-import/cycle-a.css.'],
    ['an error inside the imported file', '@import \'./bad.css\';', 'test/fixtures/pdf-style-import/bad.css:2:10 Invalid value "bleu" for "color"'],
    ['v-bind() in the imported file', '@import \'./bound.css\';', 'bound.css:1:13 v-bind() is not allowed in an imported file'],
    // R1-7: a NUL byte made Node throw a TypeError without a position.
    ['a NUL byte in the path', '@import \'./a\u0000.css\';', 'styled.vue:8:1 @import cannot read "./a\\u0000.css": a path cannot hold control characters.'],
  ])('rejects %s in @import with its position', async (_case, css, message) => {
    await expect(compilePdfSfc(sfc('', css), importer, 'template')).rejects.toThrow(message)
  })

  it('rejects an @import that leaves the project directory', async () => {
    const project = resolve(importDirectory, 'project')
    await expect(compilePdfSfc(sfc('', '@import \'../shared.css\';'), resolve(project, 'styled.vue'), 'template', false, { rootDir: project }))
      .rejects.toThrow('styled.vue:8:1 @import "../shared.css" leaves the project directory.')
  })

  it('reads an @import from a project folder whose name starts with two dots', async () => {
    const project = resolve(importDirectory, 'project')
    await expect(compilePdfSfc(sfc('', '@import \'./..shared/theme.css\';'), resolve(project, 'styled.vue'), 'template', false, { rootDir: project }))
      .resolves.toBeDefined()
  })

  // Catches an imported file that the dev watcher does not know, so an edit
  // to the house style would not rebuild the template in `nuxt dev`.
  it('registers every imported file with the bundler watcher', async () => {
    const template = resolve(importDirectory, 'style-importer.vue')
    const plugin = createPdfSfcPlugin({ files: new Map([[template, 'template']]) })
    const watched: string[] = []
    await plugin.load.call({ addWatchFile: file => watched.push(file) }, plugin.resolveId(template)!)
    expect(watched).toEqual([template, resolve(importDirectory, 'theme.css'), resolve(importDirectory, 'tokens.css')])
  })

  // R1-6: catches a missing import target that is not watched, so creating
  // the file after the error would not rebuild the template in `nuxt dev`.
  it('registers a missing imported file with the bundler watcher', async () => {
    const template = resolve(importDirectory, 'missing-importer.vue')
    const plugin = createPdfSfcPlugin({ files: new Map([[template, 'template']]), onCompileError: () => {} })
    const watched: string[] = []
    await plugin.load.call({ addWatchFile: file => watched.push(file) }, plugin.resolveId(template)!)
    expect(watched).toEqual([template, resolve(importDirectory, 'later.css')])
  })
})
