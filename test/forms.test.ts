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

const { PdfCheckbox, PdfDocument, PdfFacturX, PdfPage, PdfRadio, PdfSelect, PdfSvg, PdfText, PdfTextField, PdfView } = PDF_COMPONENTS

const ROBOTO = {
  family: 'Roboto',
  src: `data:font/ttf;base64,${readFileSync('test/fixtures/assets/Roboto-Regular.ttf').toString('base64')}` as PdfFontDataUrl,
}
const PAGE: [number, number] = [400, 600]
const OPEN = 'open-Linden-52'

// Symbol is a standard PDF font name, but not one the font store holds.
const SYMBOL = { ...ROBOTO, family: 'Symbol' }

const ARABIC = {
  family: 'Arabic',
  src: `data:font/ttf;base64,${readFileSync('test/fixtures/fonts/international/NotoSansArabic-Subset.ttf').toString('base64')}` as PdfFontDataUrl,
}

/** Render pages built from these children (one array per page). */
const renderPages = async (pages: (() => VNode[])[], props: PdfDocumentProps = {}, extra: VNode[] = []) => {
  const component = defineComponent(() => () => h(PdfDocument, { title: 'Volunteer sign-up', language: 'en', ...props } as never, () => [
    ...extra,
    ...pages.map(children => h(PdfPage, { size: PAGE, style: { padding: 30, fontFamily: 'Roboto' } }, children)),
  ]))
  const password = props.protection?.openPassword
  const { bytes } = await renderPreparedPdfTemplate(component, {}, { fonts: [ROBOTO, ARABIC, SYMBOL], ...(password && { password }) })
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
    ['a value Helvetica cannot draw', [() => [field({ value: 'Route → north' })]], {}, [], '<PdfTextField> "value" contains "→" (U+2192), which a form field cannot draw: field text uses WinAnsi (Western European) characters.'],
    ['a line break without multiline', [() => [field({ value: 'one\ntwo' })]], {}, [], '<PdfTextField> "city" has a line break in "value"; set "multiline" or remove the line break.'],
    ['a value longer than maxLength', [() => [field({ value: 'Lindenfeld', maxLength: 4 })]], {}, [], '<PdfTextField> "city" has a "value" longer than "maxLength" (4); shorten the value or raise "maxLength".'],
    ['a rounded border', [() => [field({ style: { width: 120, height: 18, borderRadius: 4 } })]], {}, [], '<PdfTextField> "city" sets "borderRadius", but a field border is square; remove it.'],
    ['a dashed border', [() => [field({ style: { width: 120, height: 18, borderWidth: 1, borderBottomStyle: 'dashed' } })]], {}, [], '<PdfTextField> "city" sets "borderBottomStyle: dashed", but a field border is solid; remove it.'],
    ['justified text', [() => [field({ style: { width: 120, height: 18, textAlign: 'justify' } })]], {}, [], '<PdfTextField> "city" sets "textAlign: justify", which a field cannot draw; use left, center or right.'],
    ['a background with alpha', [() => [field({ style: { width: 120, height: 18, backgroundColor: '#ff000080' } })]], {}, [], '<PdfTextField> "city" sets "backgroundColor: #ff000080", but a field draws its colors without alpha; use an opaque color.'],
    ['maxLength 0', [() => [field({ maxLength: 0 })]], {}, [], '<PdfTextField> maxLength must be a positive whole number.'],
    ['a select value not in options', [() => [h(PdfSelect, { name: 'size', options: ['S', 'M'], value: 'XL', style: { width: 60, height: 18 } })]], {}, [], '<PdfSelect> "size" has a "value" that is not one of "options"; add it to "options", or set "editable" to accept any value.'],
    ['an option Helvetica cannot draw', [() => [h(PdfSelect, { name: 'size', options: ['S', '大'], style: { width: 60, height: 18 } })]], {}, [], '<PdfSelect> "options" contains "大" (U+5927), which a form field cannot draw: field text uses WinAnsi (Western European) characters.'],
    ['an option listed twice', [() => [h(PdfSelect, { name: 'size', options: ['S', 'S'], style: { width: 60, height: 18 } })]], {}, [], '<PdfSelect> "options" lists a choice twice; give each choice once.'],
    ['no options', [() => [h(PdfSelect, { name: 'size', options: [], style: { width: 60, height: 18 } })]], {}, [], '<PdfSelect> requires "options": a non-empty list of non-empty strings.'],
    ['the export value Off', [() => [h(PdfCheckbox, { name: 'agree', exportValue: 'Off', style: { width: 12, height: 12 } })]], {}, [], '<PdfCheckbox> "exportValue" must be letters, digits, "_" or "-", and not "Off" (the unchecked state).'],
    ['a field inside fixed content', [() => [h(PdfView, { fixed: true }, () => [field()])]], {}, [], '<PdfTextField> "city" is inside fixed content, which repeats on every page, but a field exists once; move it out of the fixed node.'],
    ['a field inside page-conditional content', [() => [h(PdfView, { fixed: true, pages: 'first' }, () => [field()])]], {}, [], 'A fixed node with "pages" may contain only <PdfView>, <PdfText> and page tokens; found <PdfTextField>.'],
    ['a field inside an SVG', [() => [h(PdfSvg, { width: 100, height: 100 }, () => [field()])]], {}, [], 'Invalid PDF nesting: <PdfSvg> cannot contain <PdfTextField>.'],
    ['a field in Helvetica in PDF/A', [() => [field({ style: { width: 120, height: 18, fontFamily: 'Helvetica' } })]], { conformance: 'PDF/A-3b' }, [], 'PDF/A-3b requires embedded fonts, but <PdfTextField> "city" draws its value in the standard font Helvetica, which is not embedded. Register a font in pdf.fonts (nuxt.config) and set fontFamily on the field, its page or a parent view.'],
    ['a field in a standard font face in PDF/A', [() => [field({ style: { width: 120, height: 18, fontFamily: 'Helvetica-Bold' } })]], { conformance: 'PDF/A-3b' }, [], 'PDF/A-3b requires embedded fonts, but <PdfTextField> "city" draws its value in the standard font Helvetica, which is not embedded. Register a font in pdf.fonts (nuxt.config) and set fontFamily on the field, its page or a parent view.'],
    ['a value its PDF/A font does not have', [() => [field({ value: 'CAB1é', style: { width: 120, height: 18, fontFamily: 'Arabic' } })]], { conformance: 'PDF/A-3b' }, [], 'PDF/A-3b requires embedded fonts, but <PdfTextField> "city" contains "é" (U+00E9), which its font "Arabic" does not have. Use a font that has it, or remove the character.'],
    ['a choice its PDF/A font does not have', [() => [h(PdfSelect, { name: 'size', options: ['A', 'B', 'Ü'], value: 'A', style: { width: 60, height: 18, fontFamily: 'Arabic' } })]], { conformance: 'PDF/A-3b' }, [], 'PDF/A-3b requires embedded fonts, but <PdfSelect> "size" contains "Ü" (U+00DC), which its font "Arabic" does not have. Use a font that has it, or remove the character.'],
    ['PdfFacturX', [() => [field()]], { conformance: 'PDF/A-3b' }, [h(PdfFacturX, { invoice: VALID_INVOICES['two-rates']!, profile: 'EN 16931' })], '<PdfFacturX> writes an e-invoice whose printed content must match its XML, and a form field (such as "city") lets a reader change that content. Remove the form fields, or print their values as text.'],
    ['a field without a label in PDF/UA-1', [() => [field()]], { conformance: 'PDF/UA-1' }, [], '<PdfTextField> "city" needs a "label" in a PDF/UA-1 document: PDF/UA requires an accessible name for every form field, and assistive technology reads the label as that name.'],
    ['a radio option without a label in PDF/A-3a', [() => [h(PdfRadio, { name: 'plan', value: 'basic', style: { width: 14, height: 14 } })]], { conformance: 'PDF/A-3a' }, [], '<PdfRadio> "plan" needs a "label" in a PDF/A-3a document: PDF/UA requires an accessible name for every form field, and assistive technology reads the label as that name. Give each option of a radio group its own label.'],
    ['a field inside a decorative view in PDF/UA-1', [() => [h(PdfView, { decorative: true }, () => [field({ label: 'City' })])]], { conformance: 'PDF/UA-1' }, [], '<PdfTextField> "city" is inside a decorative node, but in a PDF/UA-1 document every form field must be in the reading order. Move the field out of the decorative node.'],
    ['a field inside a figure in PDF/UA-1', [() => [h(PdfView, { tag: 'figure', alt: 'Town map' }, () => [field({ label: 'City' })])]], { conformance: 'PDF/UA-1' }, [], '<PdfTextField> "city" is not supported inside <PdfView tag="figure">: assistive technology reads the figure as its "alt", so a field inside it could not be reached. Move the field out of the figure.'],
  ])('rejects %s with a typed error', async (_case, pages, props, extra, message) => {
    const error = await errorOf(() => renderPages(pages, props, extra))

    expect(error.code).toBe(PDF_ERROR_CODES.TreeInvalid)
    expect(error.message).toContain(message)
  })
})

const RADIO_STYLE = { width: 14, height: 14, borderWidth: 1, borderColor: '#336699', backgroundColor: 'white', padding: 3, marginBottom: 6 }
const radio = (value: string, props: Record<string, unknown> = {}) =>
  h(PdfRadio, { name: 'plan', value, label: `Plan ${value}`, style: RADIO_STYLE, ...props })

// Page 1: two options of the group "plan" ("basic" on) and a checkbox.
// Page 2: the third option, inside a view.
const PLANS = [
  () => [h(PdfText, null, () => 'Plan'), radio('basic', { checked: true }), radio('plus'), h(PdfCheckbox, { name: 'invoice', style: { width: 12, height: 12 } })],
  () => [h(PdfView, { style: { padding: 6 } }, () => [radio('team')])],
]

/** The widget dictionaries of a radio group's options, by their `TU`. */
const radioWidget = (text: string, label: string): string =>
  [...text.matchAll(/\n\d+ 0 obj\n(<<(?:(?!endobj)[\s\S])*?\/Subtype \/Widget[\s\S]*?>>)\nendobj/g)]
    .map(match => match[1]!)
    .find(dictionary => dictionary.includes(`/TU (${label})`))!

describe('radio groups', () => {
  // Catches a group written as one field per option, a widget with a name of
  // its own, or a value that is not the checked option: pdf.js reads one
  // field with three widgets, on two pages.
  it('writes radios with one name as one field with a widget per option, across pages', async () => {
    const all = (await widgets(await renderPages(PLANS))).filter(widget => widget.radioButton === true)
    const objects = await open(await renderPages(PLANS), document => document.getFieldObjects())

    expect(all.map(({ fieldName, buttonValue, fieldValue, alternativeText, page }) => ({ fieldName, buttonValue, fieldValue, alternativeText, page }))).toEqual([
      { fieldName: 'plan', buttonValue: 'basic', fieldValue: 'basic', alternativeText: 'Plan basic', page: 1 },
      { fieldName: 'plan', buttonValue: 'plus', fieldValue: 'basic', alternativeText: 'Plan plus', page: 1 },
      { fieldName: 'plan', buttonValue: 'team', fieldValue: 'basic', alternativeText: 'Plan team', page: 2 },
    ])
    expect(Object.keys(objects ?? {}).toSorted()).toEqual(['invoice', 'plan'])
    // pdf.js types each field object as `Object`.
    const plan = (objects?.plan ?? []) as { type: string, exportValues?: string, kidIds?: string[] }[]
    expect(plan.map(({ type, exportValues, kidIds }) => ({ type, exportValues, kids: kidIds?.length }))).toEqual([
      // pdf.js lists the parent field (its three kids) and then each widget.
      { type: '', exportValues: undefined, kids: 3 },
      { type: 'radiobutton', exportValues: 'basic', kids: undefined },
      { type: 'radiobutton', exportValues: 'plus', kids: undefined },
      { type: 'radiobutton', exportValues: 'team', kids: undefined },
    ])
  })

  // Catches the field and widget keys a reader needs: the radio flags,
  // value names, kids without a name, one on state and Off per widget.
  it('writes a parent field with the radio flags and widgets with their own states', async () => {
    const text = latin1(await renderPages(PLANS))
    const [, parentId, parent] = [...text.matchAll(/\n(\d+) 0 obj\n(<<(?:(?!endobj)[\s\S])*?>>)\nendobj/g)]
      .find(([, , dictionary]) => dictionary!.includes('/FT /Btn') && dictionary!.includes('/Kids'))! as unknown as [string, string, string]
    const kids = /\/Kids \[([^\]]+)\]/.exec(parent)![1]!.split(' 0 R').map(id => id.trim()).filter(Boolean)

    // Radio (bit 16) and NoToggleToOff (bit 15): 32768 + 16384.
    expect(parent).toContain('/Ff 49152\n')
    expect(parent).toContain('/T (plan)\n/V /basic\n/DV /basic\n')
    expect(kids).toHaveLength(3)
    for (const [value, state] of [['basic', 'basic'], ['plus', 'Off'], ['team', 'Off']] as const) {
      const widget = radioWidget(text, `Plan ${value}`)
      expect(widget, value).not.toContain('/T (')
      expect(widget, value).toContain(`/Parent ${parentId} 0 R\n`)
      expect(widget, value).toContain(`/AS /${state}\n`)
      expect(widget, value).toMatch(new RegExp(`/AP <<\\n/N <<\\n/${value} \\d+ 0 R\\n/Off \\d+ 0 R\\n>>`))
    }
    expect(text.split('/T (plan)').length - 1).toBe(1)
    expect(text).not.toContain('ZapfDingbats')
  })

  // Catches a wrong radio look: values computed by hand. Box 14 × 14:
  // background disc radius 7, border ring radius 6.5 at width 1, dot radius
  // 3 (content box 4 … 10); control points at r × 0.5522847498.
  it('draws a radio as a ring, and a dot in its on state, from vector paths', async () => {
    const text = latin1(await renderPages(PLANS))
    const [on, off] = /\/AP <<\n\/N <<\n\/plus (\d+) 0 R\n\/Off (\d+) 0 R/.exec(radioWidget(text, 'Plan plus'))!.slice(1) as [string, string]
    const ring = [
      'q', '1 1 1 rg',
      '14 7 m', '14 10.866 10.866 14 7 14 c', '3.134 14 0 10.866 0 7 c', '0 3.134 3.134 0 7 0 c', '10.866 0 14 3.134 14 7 c', 'h',
      'f', 'Q',
      'q', '0.2 0.4 0.6 RG', '1 w',
      '13.5 7 m', '13.5 10.5899 10.5899 13.5 7 13.5 c', '3.4101 13.5 0.5 10.5899 0.5 7 c', '0.5 3.4101 3.4101 0.5 7 0.5 c', '10.5899 0.5 13.5 3.4101 13.5 7 c', 'h',
      'S', 'Q',
    ]
    const dot = [
      'q', '0 0 0 rg',
      '10 7 m', '10 8.6569 8.6569 10 7 10 c', '5.3431 10 4 8.6569 4 7 c', '4 5.3431 5.3431 4 7 4 c', '8.6569 4 10 5.3431 10 7 c', 'h',
      'f', 'Q',
    ]

    expect(stream(text, off).split('\n')).toEqual(ring)
    expect(stream(text, on).split('\n')).toEqual([...ring, ...dot])
  })

  // Catches a group a reader cannot change: pdf.js selects the option on
  // page 2, saves, and reads the new value from the saved file.
  it('can be changed and saved by a reader', async () => {
    const bytes = await renderPages(PLANS)
    const options = (await widgets(bytes)).filter(widget => widget.radioButton === true)
    const saved = await open(bytes, async (document) => {
      for (const option of options) document.annotationStorage.setValue(option.id, { value: option.buttonValue === 'team' })
      return document.saveDocument()
    })
    const after = (await widgets(saved)).filter(widget => widget.radioButton === true)

    expect(after.map(widget => widget.fieldValue)).toEqual(['team', 'team', 'team'])
    expect(latin1(saved)).toMatch(/\/AS \/team\b/)
  })

  // A group with no checked option has the value Off.
  it('writes Off as the value of a group without a checked option', async () => {
    const text = latin1(await renderPages([() => [radio('basic'), radio('plus')]]))

    expect(text).toContain('/T (plan)\n/V /Off\n/DV /Off\n')
  })

  it.each<[string, VNode[], string]>([
    ['a radio and a checkbox with one name', [radio('basic'), h(PdfCheckbox, { name: 'plan', style: { width: 12, height: 12 } })], '<PdfRadio> "plan" is also the name of a <PdfCheckbox>; only the radios of one group share a name.'],
    ['two options with one value', [radio('basic'), radio('basic')], '<PdfRadio> "plan" has the value "basic" twice; give each option of the group its own value.'],
    ['two checked options', [radio('basic', { checked: true }), radio('plus', { checked: true })], '<PdfRadio> "plan" has more than one checked option; check one option of the group at most.'],
    ['required on one option only', [radio('basic', { required: true }), radio('plus')], '<PdfRadio> "plan" sets "required" on some options only; set it on every option of the group or on none.'],
    ['readOnly on one option only', [radio('basic'), radio('plus', { readOnly: true })], '<PdfRadio> "plan" sets "readOnly" on some options only; set it on every option of the group or on none.'],
    ['the value Off', [radio('Off')], '<PdfRadio> "value" must be letters, digits, "_" or "-", and not "Off" (the unchecked state).'],
    ['no value', [h(PdfRadio, { name: 'plan', style: RADIO_STYLE } as never)], '<PdfRadio> requires "value": the value a reader exports when this option is on.'],
  ])('rejects %s with a typed error', async (_case, children, message) => {
    const error = await errorOf(() => renderPages([() => children]))

    expect(error.code).toBe(PDF_ERROR_CODES.TreeInvalid)
    expect(error.message).toContain(message)
  })
})

// One field of each kind, in a PDF/A-3b document whose page font is Roboto.
const ARCHIVED = [() => [
  h(PdfTextField, { name: 'fullName', label: 'Full name', value: 'Ada', style: { width: 200, height: 20 } }),
  h(PdfCheckbox, { name: 'terms', label: 'Terms', checked: true, style: { width: 12, height: 12, borderWidth: 1 } }),
  radio('basic', { checked: true }),
  radio('plus'),
  h(PdfSelect, { name: 'shift', label: 'Shift', options: ['Morning', 'Évening'], value: 'Évening', style: { width: 150, height: 18 } }),
]]
const PDF_A = { conformance: 'PDF/A-3b' } as const

/** Object `id`'s dictionary. */
const objectDict = (text: string, id: string): string =>
  new RegExp(`\\n${id} 0 obj\\n(<<[\\s\\S]*?>>)\\n(?:endobj|stream)`).exec(text)![1]!

describe('form fields in PDF/A', () => {
  // Catches a field font that is not embedded (Helvetica left in), a font a
  // reader cannot use to draw a typed value (a subset, no WinAnsi encoding),
  // or widths that are not the font's. Expected numbers from Roboto Regular:
  // 2048 units per em, ascent 1900, descent -500, cap height 1456, bbox
  // -1509 -555 2352 2163, "A" 1336 wide, the missing glyph 908.
  it('embeds the registered font whole as a WinAnsi TrueType font and names it in DA and DR', async () => {
    const text = latin1(await renderPages(ARCHIVED, PDF_A))
    const acroForm = objectDict(text, /\/AcroForm (\d+) 0 R/.exec(text)![1]!)
    const fontId = /\/FF1 (\d+) 0 R/.exec(acroForm)![1]!
    const font = objectDict(text, fontId)
    const descriptor = objectDict(text, /\/FontDescriptor (\d+) 0 R/.exec(font)![1]!)
    const fileId = /\/FontFile2 (\d+) 0 R/.exec(descriptor)![1]!
    const widths = /\/Widths \[([^\]]+)\]/.exec(font)![1]!.trim().split(/\s+/).map(Number)

    expect(text).not.toContain('Helvetica')
    expect(acroForm).toContain('/DA (/FF1 10 Tf 0 g)')
    expect(acroForm).not.toContain('NeedAppearances')
    expect(font).toContain('/Subtype /TrueType\n/BaseFont /Roboto-Regular\n/FirstChar 32\n/LastChar 255\n')
    expect(font).toContain('/Encoding /WinAnsiEncoding\n')
    expect(widths).toHaveLength(224)
    // "A" is code 65: 1336 × 1000 / 2048 = 652.3; code 0x81 has no glyph: 908 → 443.4.
    expect([widths[65 - 32], widths[0x81 - 32]]).toEqual([652, 443])
    expect(descriptor).toContain('/FontName /Roboto-Regular\n/Flags 32\n/FontBBox [-737 -271 1148 1056]\n/ItalicAngle 0\n/Ascent 928\n/Descent -244\n/CapHeight 711\n')
    expect(objectDict(text, fileId)).toContain('/Length1 171676\n')
    expect(inflateSync(rawStream(text, fileId)).equals(readFileSync('test/fixtures/assets/Roboto-Regular.ttf'))).toBe(true)
    for (const name of ['fullName', 'shift']) expect(widgetDict(text, name), name).toContain('/DA (/FF1 10 Tf 0 0 0 rg)')
  })

  // Catches an appearance still drawn in Helvetica metrics or resources:
  // baseline 2 + (16 − 9.2773 − 2.4414) / 2 + 2.4414 = 6.582 for Roboto at 10.
  it('draws the value in the embedded font with its metrics', async () => {
    const text = latin1(await renderPages(ARCHIVED, PDF_A))
    const apId = /\/AP <<\n\/N (\d+) 0 R/.exec(widgetDict(text, 'fullName'))![1]!

    expect(objectDict(text, apId)).toMatch(/\/Resources <<\n\/Font <<\n\/FF1 \d+ 0 R/)
    expect(stream(text, apId).split('\n')).toEqual(['/Tx BMC', 'q', '2 2 196 16 re W n', 'BT', '/FF1 10 Tf', '0 0 0 rg', '1 0 0 1 2 6.582 Tm (Ada) Tj', 'ET', 'Q', 'EMC'])
  })

  // Catches a form a reader cannot fill in PDF/A, or that it fills with a
  // font of its own: pdf.js types a value with letters the old value did not
  // have, draws it again from DA, and the saved file names only FF1.
  it('can be filled and saved by a reader, which draws the new value in the embedded font', async () => {
    const bytes = await renderPages(ARCHIVED, PDF_A)
    const before = await byName(bytes)
    const saved = await open(bytes, async (document) => {
      document.annotationStorage.setValue(before.fullName!.id, { value: 'Zoë Quill' })
      return document.saveDocument()
    })
    const update = latin1(saved).slice(bytes.length)

    expect((await byName(saved)).fullName!.fieldValue).toBe('Zoë Quill')
    expect(update).toContain('/FF1 10 Tf')
    expect(update).not.toContain('Helvetica')
  })

  // Catches an application font rejected for a standard PDF font name that
  // the font store does not hold: the field must embed it.
  it('embeds an application font registered as Symbol', async () => {
    const text = latin1(await renderPages([() => [
      h(PdfTextField, { name: 'city', label: 'City', value: 'Ada', style: { width: 120, height: 18, fontFamily: 'Symbol' } }),
    ]], PDF_A))

    expect(widgetDict(text, 'city')).toContain('/DA (/FF1 10 Tf 0 0 0 rg)')
    expect(text).not.toContain('Helvetica')
  })

  // The writer of the PDF/A path must not change documents without PDF/A.
  it('keeps Helvetica without a PDF/A level', async () => {
    const text = latin1(await renderPages(ARCHIVED))

    expect(text).toContain('/BaseFont /Helvetica')
    expect(text).not.toContain('/FF1')
  })
})

/** A structure element as pdf.js reports it, with its marked content and the widgets it references (OBJR). */
type StructNode = { role: string, alt?: string, children: (StructNode | string)[] }

/**
 * The structure tree of each page, read with pdf.js. Marked content reads
 * `content`; a widget reads its field name, and a radio widget also its
 * option (`plan=basic`), from the annotation the OBJR names.
 */
const structTrees = (bytes: Uint8Array) => open(bytes, async (document) => {
  const pages: StructNode[] = []
  for (let number = 1; number <= document.numPages; number += 1) {
    const page = await document.getPage(number)
    const names = new Map((await page.getAnnotations() as Widget[]).map(widget =>
      [`pdfjs_internal_id_${widget.id}`, typeof widget.buttonValue === 'string' ? `${widget.fieldName}=${widget.buttonValue}` : widget.fieldName]))
    const reduce = (node: unknown): StructNode | string => {
      const record = node as Record<string, unknown>
      if (record.type === 'content') return 'content'
      if (record.type === 'annotation') return names.get(String(record.id)) ?? `unknown ${String(record.id)}`
      return { role: String(record.role), ...(typeof record.alt === 'string' && { alt: record.alt }), children: Array.isArray(record.children) ? record.children.map(reduce) : [] }
    }
    pages.push(reduce(await page.getStructTree()) as StructNode)
  }
  return pages
})

/** The elements below `Document` on each page. */
const documentsOf = (pages: StructNode[]) => pages.map(page => (page.children[0] as StructNode).children)

describe('form fields in tagged PDF', () => {
  const UA = { conformance: 'PDF/UA-1' } as const
  const P = { role: 'P', children: ['content'] }
  const form = (widget: string, alt: string) => ({ role: 'Form', alt, children: [widget] })
  // Page 1: a heading, a text field, a checkbox and two radio options inside
  // a section. Page 2: the third radio option and a select between texts.
  const TAGGED_FORM = [
    () => [
      h(PdfText, { tag: 'h1' }, () => 'Volunteer sign-up'),
      h(PdfTextField, { name: 'fullName', label: 'Full name', value: 'Ada', style: { width: 200, height: 20 } }),
      h(PdfCheckbox, { name: 'newsletter', label: 'Send me the newsletter', style: { width: 12, height: 12, marginTop: 6 } }),
      h(PdfView, { tag: 'section' }, () => [
        h(PdfText, null, () => 'Plan'),
        radio('basic', { checked: true }),
        radio('plus'),
      ]),
    ],
    () => [
      radio('team'),
      h(PdfText, null, () => 'Choose a shift'),
      h(PdfSelect, { name: 'shift', label: 'Shift', options: ['Morning', 'Evening'], value: 'Morning', style: { width: 150, height: 18 } }),
      h(PdfText, null, () => 'Thank you'),
    ],
  ]

  // Catches a widget outside the structure tree, a Form element that holds
  // no reference to its widget or another field's, a radio option without an
  // element of its own, a Form element without the label as `Alt` (veraPDF
  // PDF/UA-1 7.18.1-3 for a radio group), and Form elements out of reading
  // order.
  it('references each widget from a Form element, in reading order', async () => {
    const pages = await structTrees(await renderPages(TAGGED_FORM, UA))

    expect(documentsOf(pages)).toEqual([
      [
        { role: 'H1', children: ['content'] },
        form('fullName', 'Full name'),
        form('newsletter', 'Send me the newsletter'),
        { role: 'Sect', children: [P, form('plan=basic', 'Plan basic'), form('plan=plus', 'Plan plus')] },
      ],
      [form('plan=team', 'Plan team'), P, form('shift', 'Shift'), P],
    ])
  })

  // Catches a widget without its parent tree key or label, a page without
  // tab order by structure, a key on the radio parent (a field, not a widget),
  // and a link description written on a widget.
  it('gives each widget its parent tree key and label, and each page structure tab order', async () => {
    const bytes = await renderPages(TAGGED_FORM, UA)
    const text = latin1(bytes)
    const parent = objectDict(text, /\n(\d+) 0 obj\n<<\n\/FT \/Btn\n\/Ff 49152/.exec(text)![1]!)

    // Keys 4 and 7 are the marked content of page 1 and page 2.
    expect((await widgets(bytes)).map(widget => [widget.fieldName, widget.buttonValue ?? null, widget.alternativeText, widget.structParent])).toEqual([
      ['fullName', null, 'Full name', 0],
      ['newsletter', null, 'Send me the newsletter', 1],
      ['plan', 'basic', 'Plan basic', 2],
      ['plan', 'plus', 'Plan plus', 3],
      ['plan', 'team', 'Plan team', 5],
      ['shift', null, 'Shift', 6],
    ])
    expect(text.match(/\/Type \/Page\n[\s\S]*?>>\nendobj/g)!.map(page => /\/Tabs \/S\n/.test(page))).toEqual([true, true])
    expect(text.match(/\/S \/Form\n/g)).toHaveLength(6)
    expect(parent).not.toContain('/StructParent')
    const widgetObjects = text.match(/\n\d+ 0 obj\n<<\n[\s\S]*?>>\nendobj/g)!.filter(object => object.includes('/Subtype /Widget'))
    expect(widgetObjects.map(object => object.includes('/Contents'))).toEqual([false, false, false, false, false, false])
  })

  // Catches the standard font Helvetica left in the fields of a PDF/UA-1
  // document, which veraPDF rejects (7.21.4.1-1) like PDF/A.
  it('draws text and choice fields in the embedded field font in a PDF/UA-1 document', async () => {
    const text = latin1(await renderPages(TAGGED_FORM, UA))

    expect(text).not.toContain('Helvetica')
    expect(text.match(/\/DA \(\/FF1 10 Tf[^)]*\)/g)).toEqual(['/DA (/FF1 10 Tf 0 0 0 rg)', '/DA (/FF1 10 Tf 0 0 0 rg)', '/DA (/FF1 10 Tf 0 g)'])
  })

  // Catches Form elements placed by position on the page instead of by the
  // document tree: the row is reversed, so the text is drawn left of the field.
  it('places a Form element where its field is in the document tree, not where it is drawn', async () => {
    const pages = await structTrees(await renderPages([() => [
      h(PdfText, null, () => 'Before'),
      h(PdfView, { style: { flexDirection: 'row-reverse', gap: 10 } }, () => [
        h(PdfTextField, { name: 'city', label: 'City', style: { width: 120, height: 18 } }),
        h(PdfText, null, () => 'Drawn left, read after the field'),
      ]),
      h(PdfView, { style: { padding: 8 } }, () => [h(PdfCheckbox, { name: 'agree', label: 'I agree', style: { width: 12, height: 12 } })]),
      h(PdfText, null, () => 'After'),
    ]], UA))

    expect(documentsOf(pages)).toEqual([[P, form('city', 'City'), P, form('agree', 'I agree'), P]])
  })
})
