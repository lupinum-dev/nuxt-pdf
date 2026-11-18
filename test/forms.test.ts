import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'
import { createCanvas } from '@napi-rs/canvas'
import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { defineComponent, h, type VNode } from 'vue'
import { describe, expect, it } from 'vitest'
import { PDF_COMPONENTS } from '../src/runtime/components'
import type { PdfFontDataUrl } from '../src/runtime/fonts'
import type { PdfDocumentProps } from '../src/runtime/primitives'
import { NuxtPdfError, PDF_ERROR_CODES } from '../src/runtime/shared/errors'
import { installPdfCanvasGlobals } from '../src/test/pdf'
import { renderPreparedPdfTemplate } from '../src/test/render-template'
import { VALID_INVOICES } from './einvoice/invoices'

installPdfCanvasGlobals()

const { PdfCheckbox, PdfDocument, PdfFacturX, PdfPage, PdfSelect, PdfSvg, PdfText, PdfTextField, PdfView } = PDF_COMPONENTS

const ROBOTO = {
  family: 'Roboto',
  src: `data:font/ttf;base64,${readFileSync('test/fixtures/assets/Roboto-Regular.ttf').toString('base64')}` as PdfFontDataUrl,
}
const PAGE: [number, number] = [400, 600]
const OPEN = 'open-Linden-52'

/** Render pages built from these children (one array per page). */
const renderPages = async (pages: (() => VNode[])[], props: PdfDocumentProps = {}, extra: VNode[] = []) => {
  const component = defineComponent(() => () => h(PdfDocument, { title: 'Volunteer sign-up', language: 'en', ...props } as never, () => [
    ...extra,
    ...pages.map(children => h(PdfPage, { size: PAGE, style: { padding: 30, fontFamily: 'Roboto' } }, children)),
  ]))
  const password = props.protection?.openPassword
  const { bytes } = await renderPreparedPdfTemplate(component, {}, { fonts: [ROBOTO], ...(password && { password }) })
  return bytes
}

// Page 1: a text field after Roboto text, and a checkbox inside a padded view.
// Page 2: a select inside two padded views.
const SIGN_UP = [
  () => [
    h(PdfTextField, { name: 'fullName', label: 'Full name', value: 'Ada Brightwater', maxLength: 40, required: true, style: { width: 200, height: 20 } }),
    h(PdfView, { style: { padding: 12, marginTop: 10 } }, () => [
      h(PdfCheckbox, { name: 'newsletter', label: 'Send me the newsletter', checked: true, style: { width: 12, height: 12, marginLeft: 5 } }),
    ]),
    h(PdfTextField, { name: 'notes', multiline: true, readOnly: true, value: 'Line one\nLine two', style: { width: 300, height: 60, marginTop: 8 } }),
    h(PdfCheckbox, { name: 'terms', exportValue: 'Agreed', style: { width: 12, height: 12, marginTop: 8 } }),
  ],
  () => [
    h(PdfText, null, () => 'Choose a shift'),
    h(PdfView, { style: { padding: 8 } }, () => [
      h(PdfView, { style: { paddingLeft: 10 } }, () => [
        h(PdfSelect, { name: 'shift', options: ['Morning', 'Afternoon', 'Évening'], value: 'Afternoon', style: { width: 150, height: 18 } }),
      ]),
    ]),
  ],
]

// pdf.js draws the standard font Helvetica from the font files it ships.
const STANDARD_FONTS = fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url))

const open = async <Result>(bytes: Uint8Array, read: (document: PDFDocumentProxy) => Promise<Result>, password?: string): Promise<Result> => {
  const task = getDocument({ data: Uint8Array.from(bytes), verbosity: 0, standardFontDataUrl: STANDARD_FONTS, useWorkerFetch: false, ...(password && { password }) })
  try {
    return await read(await task.promise)
  }
  finally {
    await task.destroy()
  }
}

type Widget = Record<string, unknown> & { id: string, fieldName: string, rect: number[] }

const widgets = (bytes: Uint8Array, password?: string) => open(bytes, async (document) => {
  const all: (Widget & { page: number })[] = []
  for (let number = 1; number <= document.numPages; number++) {
    const page = await document.getPage(number)
    for (const annotation of await page.getAnnotations()) {
      if (annotation.subtype === 'Widget') all.push({ ...annotation, page: number })
    }
  }
  return all
}, password)

const byName = async (bytes: Uint8Array, password?: string) =>
  Object.fromEntries((await widgets(bytes, password)).map(widget => [widget.fieldName, widget]))

const errorOf = async (run: () => Promise<unknown>): Promise<NuxtPdfError> => {
  try {
    await run()
  }
  catch (error) {
    if (error instanceof NuxtPdfError) return error
    throw error
  }
  throw new Error('The render did not fail.')
}

const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1')

/** The raw stream bytes of object `id`. */
const rawStream = (text: string, id: string): Buffer => {
  const match = new RegExp(`\\n${id} 0 obj\\n<<[\\s\\S]*?>>\\nstream\\n`).exec(text)!
  const start = match.index + match[0].length
  return Buffer.from(text.slice(start, text.indexOf('\\nendstream', start)), 'latin1')
}
const stream = (text: string, id: string): string => inflateSync(rawStream(text, id)).toString('latin1')

/** The widget dictionary of the field `name`. */
const widgetDict = (text: string, name: string): string =>
  [...text.matchAll(/\n\d+ 0 obj\n(<<(?:(?!endobj)[\s\S])*?\/Subtype \/Widget[\s\S]*?>>)\nendobj/g)]
    .map(match => match[1]!)
    .find(dictionary => dictionary.includes(`/T (${name})`))!

/** The normal appearance stream of a text or choice field. */
const appearanceOf = (text: string, name: string): string =>
  stream(text, /\/AP <<\n\/N (\d+) 0 R/.exec(widgetDict(text, name))![1]!)

/** Page 1 at 2 pixels per point; `dark(left, top, right, bottom)` lists the dark pixels in that box (points, from the top left). */
const raster = (bytes: Uint8Array, password?: string) => open(bytes, async (document) => {
  const page = await document.getPage(1)
  const viewport = page.getViewport({ scale: 2 })
  const canvas = createCanvas(viewport.width, viewport.height)
  await page.render({ canvas: null, canvasContext: canvas.getContext('2d') as unknown as CanvasRenderingContext2D, viewport, background: '#ffffff' }).promise
  const { data, width } = canvas.getContext('2d').getImageData(0, 0, viewport.width, viewport.height)
  return (left: number, top: number, right: number, bottom: number) => {
    const found: [number, number][] = []
    for (let y = Math.round(top * 2); y < Math.round(bottom * 2); y++) {
      for (let x = Math.round(left * 2); x < Math.round(right * 2); x++) {
        const index = (y * width + x) * 4
        if (data[index]! + data[index + 1]! + data[index + 2]! < 300) found.push([x / 2, y / 2])
      }
    }
    return found
  }
}, password)

describe('form fields', () => {
  // Catches a field written with the wrong type, name, value, choices or
  // flags: pdf.js reads each one back.
  it('writes each field kind with its value, choices and flags', async () => {
    const fields = await byName(await renderPages(SIGN_UP))

    expect(fields.fullName).toMatchObject({ fieldType: 'Tx', fieldValue: 'Ada Brightwater', alternativeText: 'Full name', maxLen: 40, required: true, readOnly: false, multiLine: false })
    expect(fields.notes).toMatchObject({ fieldType: 'Tx', fieldValue: 'Line one\nLine two', multiLine: true, readOnly: true, required: false })
    expect(fields.newsletter).toMatchObject({ fieldType: 'Btn', checkBox: true, fieldValue: 'Yes', exportValue: 'Yes', alternativeText: 'Send me the newsletter' })
    expect(fields.terms).toMatchObject({ fieldType: 'Btn', checkBox: true, fieldValue: 'Off', exportValue: 'Agreed' })
    expect(fields.shift).toMatchObject({ fieldType: 'Ch', combo: true, fieldValue: ['Afternoon'] })
    expect((fields.shift!.options as { displayValue: string }[]).map(option => option.displayValue)).toEqual(['Morning', 'Afternoon', 'Évening'])
  })

  // Catches a widget drawn away from its laid-out box, in nested views with
  // padding and on page 2 (rect in PDF coordinates, y up from the bottom).
  it('places each widget on its laid-out box', async () => {
    const fields = await byName(await renderPages(SIGN_UP))
    const expected: Record<string, [number, number[]]> = {
      fullName: [1, [30, 550, 230, 570]],
      newsletter: [1, [47, 516, 59, 528]],
      // Below the view: 60 + 12 + 12 + 12 = 96, then 8 margin.
      notes: [1, [30, 436, 330, 496]],
      terms: [1, [30, 416, 42, 428]],
      // Page 2: below one line of 18 pt Roboto (18 × 2400 / 2048 = 21.09375)
      // and the outer view's padding: top 30 + 21.09375 + 8 = 59.09375.
      shift: [2, [48, 522.90625, 198, 540.90625]],
    }

    for (const [name, [page, rect]] of Object.entries(expected)) {
      expect(fields[name]!.page, name).toBe(page)
      fields[name]!.rect.forEach((value, index) => expect(value, `${name} rect[${index}]`).toBeCloseTo(rect[index]!, 2))
    }
  })

  // Catches a field that splits at a page end: it moves to the next page whole.
  it('moves a field that does not fit to the next page whole', async () => {
    const bytes = await renderPages([() => [
      h(PdfView, { style: { height: 520 } }),
      h(PdfTextField, { name: 'comment', multiline: true, style: { width: 200, height: 40 } }),
    ]])
    const [comment, ...rest] = await widgets(bytes)

    expect(rest).toEqual([])
    expect(comment).toMatchObject({ page: 2, rect: [30, 530, 230, 570] })
  })

  // Catches two fields that share one name (a reader would merge them).
  it('writes one field per name', async () => {
    const objects = await open(await renderPages(SIGN_UP), document => document.getFieldObjects())

    expect(Object.keys(objects ?? {}).toSorted()).toEqual(['fullName', 'newsletter', 'notes', 'shift', 'terms'])
    expect(Object.values(objects ?? {}).every(list => list.length === 1)).toBe(true)
  })

  // Catches a form a reader cannot fill: pdf.js fills it, saves it, and
  // reads the new values from the saved file.
  it('can be filled and saved by a reader', async () => {
    const bytes = await renderPages(SIGN_UP)
    const before = await byName(bytes)
    const saved = await open(bytes, async (document) => {
      document.annotationStorage.setValue(before.fullName!.id, { value: 'Ilse Marlow' })
      document.annotationStorage.setValue(before.terms!.id, { value: true })
      document.annotationStorage.setValue(before.shift!.id, { value: 'Morning' })
      return document.saveDocument()
    })
    const after = await byName(saved)

    expect(after.fullName!.fieldValue).toBe('Ilse Marlow')
    expect(after.terms!.fieldValue).toBe('Agreed')
    expect(after.shift!.fieldValue).toEqual(['Morning'])
    expect(after.newsletter!.fieldValue).toBe('Yes')
  })

  // Catches the engine's defects (a checkbox value written as a text string,
  // a field font that is the subset painted before it, duplicate names,
  // lowercase copies of keys) and a reader left to draw the fields.
  it('writes checkbox values as names, Helvetica with a size in each field, and its own appearances', async () => {
    const text = latin1(await renderPages(SIGN_UP))
    const acroForm = /\/AcroForm (\d+) 0 R/.exec(text)?.[1]
    const acroFormDict = new RegExp(`\\n${acroForm} 0 obj\\n(<<[\\s\\S]*?>>)\\nendobj`).exec(text)?.[1] ?? ''
    const fontId = /\/DA \(\/(\w+) 10 Tf 0 g\)/.exec(acroFormDict)?.[1]
    const fontRef = new RegExp(`/${fontId} (\\d+) 0 R`).exec(acroFormDict)?.[1]
    const widgetDicts = [...text.matchAll(/\n\d+ 0 obj\n(<<(?:(?!endobj)[\s\S])*?\/Subtype \/Widget[\s\S]*?>>)\nendobj/g)].map(match => match[1]!)

    expect(new RegExp(`\\n${fontRef} 0 obj\\n<<[\\s\\S]*?/BaseFont /Helvetica\\n`).test(text)).toBe(true)
    expect(text).not.toContain('NeedAppearances')
    expect(text).not.toContain('ZapfDingbats')
    expect(text).toContain('/V /Yes\n')
    expect(text).toContain('/DV /Off\n')
    expect(text).not.toMatch(/\/V \(\/Yes\)/)
    expect(widgetDicts).toHaveLength(5)
    for (const dictionary of widgetDicts) {
      expect(dictionary).toMatch(/\n\/AP <<\n\/N /)
      expect(dictionary.match(/^\/(\w+)/gm)!.filter(key => /^\/[a-z]/.test(key))).toEqual([])
    }
    for (const name of ['fullName', 'notes', 'shift']) {
      expect(widgetDict(text, name), name).toContain(`/DA (/${fontId} 10 Tf 0 0 0 rg)`)
    }
    for (const name of ['newsletter', 'terms']) {
      expect(widgetDict(text, name), name).not.toContain('/DA ')
    }
    for (const name of ['fullName', 'newsletter', 'notes', 'terms', 'shift']) {
      expect(text.split(`/T (${name})`).length - 1, name).toBe(1)
    }
  })

  // Catches a wrong appearance: frame, marked content, clip, font size,
  // colour, baseline and string escaping, against values computed by hand
  // from the Helvetica metrics (ascender 718, descender -207, per 1000).
  it('draws a text field value in Helvetica at its size, clipped, with escaped WinAnsi bytes', async () => {
    const text = latin1(await renderPages([() => [
      h(PdfTextField, { name: 'title', value: 'Kl(a)mmer \\ äöüß €', style: { width: 200, height: 24, fontSize: 12, color: '#1f3a5f', backgroundColor: '#fdf6e3', borderWidth: 1, borderColor: '#336699', padding: 3 } }),
    ]]))

    // Content box: border 1 + padding 3 = 4 on each side, 192 × 16.
    // Baseline: 4 + (16 − 12 × 0.718 − 12 × 0.207) / 2 + 12 × 0.207 = 8.934.
    expect(appearanceOf(text, 'title')).toBe([
      'q',
      '0.9922 0.9647 0.8902 rg',
      '0 0 200 24 re f',
      '0.2 0.4 0.6 rg',
      '0 23 200 1 re f',
      '199 0 1 24 re f',
      '0 0 200 1 re f',
      '0 0 1 24 re f',
      'Q',
      '/Tx BMC',
      'q',
      '4 4 192 16 re W n',
      'BT',
      '/F1 12 Tf',
      '0.1216 0.2275 0.3725 rg',
      String.raw`1 0 0 1 4 8.934 Tm (Kl\(a\)mmer \\ \344\366\374\337 \200) Tj`,
      'ET',
      'Q',
      'EMC',
    ].join('\n'))
    expect(widgetDict(text, 'title')).toContain('/MK <<\n/BG [0.992157 0.964706 0.890196]\n/BC [0.2 0.4 0.6]\n>>\n/BS <<\n/W 1\n/S /S\n>>\n/DA (/F1 12 Tf 0.1216 0.2275 0.3725 rg)')
  })

  // Catches `textAlign` ignored in the appearance or in `/Q`. "Ada" is
  // 667 + 556 + 556 = 1779 units, 17.79 pt at 10 pt; the content box is
  // 2 … 118 (default padding 2).
  it.each([
    ['left', 2, undefined],
    ['center', 51.105, 1],
    ['right', 100.21, 2],
  ] as const)('aligns the value %s', async (textAlign, x, quadding) => {
    const text = latin1(await renderPages([() => [
      h(PdfTextField, { name: 'first', value: 'Ada', style: { width: 120, height: 18, textAlign } }),
    ]]))

    expect(appearanceOf(text, 'first')).toContain(`\n1 0 0 1 ${x} 6.445 Tm (Ada) Tj\n`)
    if (quadding === undefined) expect(widgetDict(text, 'first')).not.toContain('/Q ')
    else expect(widgetDict(text, 'first')).toContain(`/Q ${quadding}\n`)
  })

  // Catches a multi-line value drawn as one line, a lost line break, or
  // lines broken with the wrong widths. Content box 2 … 98 (96 wide):
  // "One two three four" is 82.82 pt, adding " five" makes 101.16 pt.
  // First baseline 58 − 7.18; leading (718 + 231 + 207) / 1000 × 10.
  it('breaks a multi-line value at the box width and at its own line breaks', async () => {
    const text = latin1(await renderPages([() => [
      h(PdfTextField, { name: 'notes', multiline: true, value: 'One two three four five\nSix', style: { width: 100, height: 60 } }),
    ]]))

    expect(appearanceOf(text, 'notes').split('\n').filter(line => line.endsWith('Tj'))).toEqual([
      '1 0 0 1 2 50.82 Tm (One two three four) Tj',
      '1 0 0 1 2 39.26 Tm (five) Tj',
      '1 0 0 1 2 27.7 Tm (Six) Tj',
    ])
  })

  // Catches a field with no value that draws text, and the defaults (10 pt
  // black, padding 2), and a field that does not inherit size and colour
  // the way text does.
  it('draws an empty value as empty marked content and inherits size and colour', async () => {
    const text = latin1(await renderPages([() => [
      h(PdfTextField, { name: 'empty', style: { width: 120, height: 18 } }),
      h(PdfView, { style: { fontSize: 14, color: '#aa0000' } }, () => [
        h(PdfSelect, { name: 'size', options: ['S', 'M'], value: 'M', style: { width: 60, height: 22 } }),
      ]),
    ]]))

    expect(appearanceOf(text, 'empty')).toBe('/Tx BMC\nEMC')
    expect(widgetDict(text, 'empty')).toContain('/DA (/F1 10 Tf 0 0 0 rg)')
    // 2 + (18 − 14 × 0.925) / 2 + 14 × 0.207 = 7.423.
    expect(appearanceOf(text, 'size')).toContain('\n/F1 14 Tf\n0.6667 0 0 rg\n1 0 0 1 2 7.423 Tm (M) Tj\n')
    expect(widgetDict(text, 'size')).toContain('/DA (/F1 14 Tf 0.6667 0 0 rg)')
  })

  // Catches a checkbox without an Off state, extra states, the engine's
  // ZapfDingbats glyphs, or a mark in the unchecked box.
  it('draws a checkbox as an empty Off state and a cross in its export state', async () => {
    const text = latin1(await renderPages(SIGN_UP))
    const states = (name: string) => /\/AP <<\n\/N <<\n((?:\/\w+ \d+ 0 R\n)+)>>/.exec(widgetDict(text, name))![1]!
      .trim().split('\n').map(line => line.split(' ') as [string, string])

    expect(states('newsletter').map(([state]) => state)).toEqual(['/Yes', '/Off'])
    expect(states('terms').map(([state]) => state)).toEqual(['/Agreed', '/Off'])
    const [[, on], [, off]] = states('terms') as [[string, string], [string, string]]
    // Content box 2 … 10; line width 8 × 0.15; ends inset by half of it.
    expect(stream(text, on)).toBe('q\n0 0 0 RG\n1.2 w 1 J\n2.6 2.6 m 9.4 9.4 l\n2.6 9.4 m 9.4 2.6 l\nS\nQ')
    expect(stream(text, off)).toBe('')
  })

  // Catches appearances that a reader does not draw, or draws in the wrong
  // place: pdf.js paints them from the appearance streams (no value in its
  // storage, no NeedAppearances), measured in pixels at 2 px per point.
  it('is drawn by a reader from its appearance streams', async () => {
    const draw = await raster(await renderPages([() => [
      h(PdfTextField, { name: 'centred', value: 'HH', style: { width: 200, height: 30, fontSize: 20, textAlign: 'center' } }),
      h(PdfTextField, { name: 'long', value: 'A value much wider than its small box', style: { width: 80, height: 18, marginTop: 10 } }),
      h(PdfView, { style: { flexDirection: 'row', marginTop: 10 } }, () => [
        h(PdfCheckbox, { name: 'on', checked: true, style: { width: 14, height: 14 } }),
        h(PdfCheckbox, { name: 'off', style: { width: 14, height: 14, marginLeft: 10 } }),
      ]),
    ]]))
    const span = (pixels: [number, number][], axis: 0 | 1) => [Math.min(...pixels.map(pixel => pixel[axis])), Math.max(...pixels.map(pixel => pixel[axis]))]

    // "HH": 2 × 722 units = 28.88 pt advance, centred in 30 … 230; its ink
    // is 28.88 − 2 × 79 / 50 = 25.72 pt wide (side bearings 79 units), cap
    // height 718 → 14.36 pt; baseline 60 − (2 + (26 − 18.5) / 2 + 4.14) = 50.11.
    const centred = draw(30, 30, 230, 60)
    const [left, right] = span(centred, 0)
    const [top, bottom] = span(centred, 1)
    expect((left! + right!) / 2).toBeCloseTo(130, 0)
    expect(right! - left!).toBeGreaterThan(24.5)
    expect(right! - left!).toBeLessThan(27)
    expect(bottom! - top!).toBeGreaterThan(12.5)
    expect(bottom! - top!).toBeLessThan(15.5)
    // The lowest dark pixel row ends half a point below its top.
    expect(Math.abs(bottom! + 0.5 - 50.11)).toBeLessThan(1)
    // The long value is drawn and clipped at its content box (30 + 80 − 2).
    expect(draw(32, 70, 108, 88).length).toBeGreaterThan(0)
    expect(draw(108, 70, 200, 88)).toEqual([])
    // A cross in the checked box, nothing in the unchecked one.
    expect(draw(34, 102, 40, 108).length).toBeGreaterThan(0)
    expect(draw(54, 98, 68, 112)).toEqual([])
  })

  // Catches a border or background painted twice: on the page and in the
  // appearance (a reader that hides the field would still show the frame).
  it('paints the frame of a field only in its appearance', async () => {
    const text = latin1(await renderPages([() => [
      h(PdfTextField, { name: 'framed', style: { width: 120, height: 18, borderWidth: 1, borderColor: '#336699', backgroundColor: '#eeeeee' } }),
    ]]))
    const contents = /\/Type \/Page\n[\s\S]*?\/Contents (\d+) 0 R/.exec(text)![1]!

    expect(stream(text, contents)).not.toMatch(/ re\n| re f/)
    expect(appearanceOf(text, 'framed')).toContain('0 0 120 18 re f')
  })

  // Catches a form that a protected PDF breaks, and the form permissions:
  // the appearance streams are encrypted like every stream, and a reader
  // with the password draws them.
  it('works in a protected PDF, with the form permissions in /P', async () => {
    const bytes = await renderPages(SIGN_UP, { protection: { openPassword: OPEN, allow: { fillingForms: false, annotating: false } } })
    const fields = await byName(bytes, OPEN)
    const text = latin1(bytes)
    // Field names are encrypted strings; fullName is the first field.
    const fullName = /\/AP <<\n\/N (\d+) 0 R/.exec(text)![1]!

    expect(fields.fullName!.fieldValue).toBe('Ada Brightwater')
    expect(fields.newsletter!.fieldValue).toBe('Yes')
    expect(text).toMatch(/\/P -292\n/)
    expect(() => inflateSync(rawStream(text, fullName))).toThrow()
    expect((await raster(bytes, OPEN))(32, 32, 228, 48).length).toBeGreaterThan(0)
  })

  // A document without fields keeps its bytes: no AcroForm, no Helvetica.
  it('writes no AcroForm without fields', async () => {
    const text = latin1(await renderPages([() => [h(PdfText, null, () => 'No form here')]]))

    expect(text).not.toContain('/AcroForm')
    expect(text).not.toContain('/BaseFont /Helvetica')
  })

  const field = (props: Record<string, unknown> = {}) =>
    h(PdfTextField, { name: 'city', style: { width: 120, height: 18 }, ...props })

  // Catches a field the engine would write wrongly, or that a reader cannot
  // show, rendered without an error.
  it.each<[string, (() => VNode[])[], PdfDocumentProps, VNode[], string]>([
    ['two fields with one name', [() => [field(), h(PdfCheckbox, { name: 'city', style: { width: 12, height: 12 } })]], {}, [], '<PdfTextField> "city" is the name of another form field too; give each field its own name.'],
    ['a name with a period', [() => [field({ name: 'address.city' })]], {}, [], '<PdfTextField> requires "name": a non-empty field name without a period or control characters.'],
    ['a missing name', [() => [h(PdfTextField, { style: { width: 120, height: 18 } } as never)]], {}, [], '<PdfTextField> requires "name": the field name a reader exports with the value.'],
    ['a missing width', [() => [field({ style: { height: 18 } })]], {}, [], '<PdfTextField> "city" needs a "width" in its style: a field is a box of fixed size.'],
    ['a missing height', [() => [field({ style: { width: 120 } })]], {}, [], '<PdfTextField> "city" needs a "height" in its style: a field is a box of fixed size.'],
    ['a value Helvetica cannot draw', [() => [field({ value: 'Route → north' })]], {}, [], '<PdfTextField> "value" contains "→" (U+2192), which the field font Helvetica cannot draw; use WinAnsi (Western European) characters.'],
    ['a line break without multiline', [() => [field({ value: 'one\ntwo' })]], {}, [], '<PdfTextField> "city" has a line break in "value"; set "multiline" or remove the line break.'],
    ['a value longer than maxLength', [() => [field({ value: 'Lindenfeld', maxLength: 4 })]], {}, [], '<PdfTextField> "city" has a "value" longer than "maxLength" (4); shorten the value or raise "maxLength".'],
    ['a rounded border', [() => [field({ style: { width: 120, height: 18, borderRadius: 4 } })]], {}, [], '<PdfTextField> "city" sets "borderRadius", but a field border is square; remove it.'],
    ['a dashed border', [() => [field({ style: { width: 120, height: 18, borderWidth: 1, borderBottomStyle: 'dashed' } })]], {}, [], '<PdfTextField> "city" sets "borderBottomStyle: dashed", but a field border is solid; remove it.'],
    ['justified text', [() => [field({ style: { width: 120, height: 18, textAlign: 'justify' } })]], {}, [], '<PdfTextField> "city" sets "textAlign: justify", which a field cannot draw; use left, center or right.'],
    ['maxLength 0', [() => [field({ maxLength: 0 })]], {}, [], '<PdfTextField> maxLength must be a positive whole number.'],
    ['a select value not in options', [() => [h(PdfSelect, { name: 'size', options: ['S', 'M'], value: 'XL', style: { width: 60, height: 18 } })]], {}, [], '<PdfSelect> "size" has a "value" that is not one of "options"; add it to "options", or set "editable" to accept any value.'],
    ['an option Helvetica cannot draw', [() => [h(PdfSelect, { name: 'size', options: ['S', '大'], style: { width: 60, height: 18 } })]], {}, [], '<PdfSelect> "options" contains "大" (U+5927), which the field font Helvetica cannot draw; use WinAnsi (Western European) characters.'],
    ['an option listed twice', [() => [h(PdfSelect, { name: 'size', options: ['S', 'S'], style: { width: 60, height: 18 } })]], {}, [], '<PdfSelect> "options" lists a choice twice; give each choice once.'],
    ['no options', [() => [h(PdfSelect, { name: 'size', options: [], style: { width: 60, height: 18 } })]], {}, [], '<PdfSelect> requires "options": a non-empty list of non-empty strings.'],
    ['the export value Off', [() => [h(PdfCheckbox, { name: 'agree', exportValue: 'Off', style: { width: 12, height: 12 } })]], {}, [], '<PdfCheckbox> "exportValue" must be letters, digits, "_" or "-", and not "Off" (the unchecked state).'],
    ['a field inside fixed content', [() => [h(PdfView, { fixed: true }, () => [field()])]], {}, [], '<PdfTextField> "city" is inside fixed content, which repeats on every page, but a field exists once; move it out of the fixed node.'],
    ['a field inside page-conditional content', [() => [h(PdfView, { fixed: true, pages: 'first' }, () => [field()])]], {}, [], 'A fixed node with "pages" may contain only <PdfView>, <PdfText> and page tokens; found <PdfTextField>.'],
    ['a field inside an SVG', [() => [h(PdfSvg, { width: 100, height: 100 }, () => [field()])]], {}, [], 'Invalid PDF nesting: <PdfSvg> cannot contain <PdfTextField>.'],
    ['PDF/A', [() => [field()]], { conformance: 'PDF/A-3b' }, [], '<PdfDocument> claims PDF/A-3b, which needs an embedded font in every form field; Nuxt PDF draws form fields in the standard font Helvetica for now. Remove the form fields (such as "city"), or remove the claim from "conformance".'],
    ['PdfFacturX', [() => [field()]], {}, [h(PdfFacturX, { invoice: VALID_INVOICES['two-rates']!, profile: 'EN 16931' })], '<PdfDocument> claims PDF/A-3b, which needs an embedded font in every form field; Nuxt PDF draws form fields in the standard font Helvetica for now. Remove the form fields (such as "city"), or remove the claim (PdfFacturX implies PDF/A-3b).'],
    ['PDF/UA-1', [() => [field()]], { conformance: 'PDF/UA-1' }, [], '<PdfDocument> claims PDF/UA-1, which needs a structure element for every form field; Nuxt PDF does not tag form fields yet. Remove the form fields (such as "city"), or remove the claim from "conformance".'],
    ['PDF/A-3a', [() => [field()]], { conformance: 'PDF/A-3a' }, [], '<PdfDocument> claims PDF/A-3a, which needs a structure element for every form field; Nuxt PDF does not tag form fields yet. Remove the form fields (such as "city"), or remove the claim from "conformance".'],
  ])('rejects %s with a typed error', async (_case, pages, props, extra, message) => {
    const error = await errorOf(() => renderPages(pages, props, extra))

    expect(error.code).toBe(PDF_ERROR_CODES.TreeInvalid)
    expect(error.message).toContain(message)
  })
})
