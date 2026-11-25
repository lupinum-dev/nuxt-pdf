import { Buffer } from 'node:buffer'
import { createDecipheriv, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { defineComponent, h, type VNode } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PDF_COMPONENTS } from '../src/runtime/components'
import type { PdfFontDataUrl } from '../src/runtime/fonts'
import type { PdfDocumentProps, PdfPermissions } from '../src/runtime/primitives'
import { encryptionValues, permissionFlags } from '../src/runtime/server/engine/protection'
import { pdfRenderPlacement } from '../src/runtime/server/worker-pool'
import { NuxtPdfError, PDF_ERROR_CODES } from '../src/runtime/shared/errors'
import { installPdfCanvasGlobals, parsePdf } from '../src/test/pdf'
import { renderPreparedPdfTemplate } from '../src/test/render-template'
import { VALID_INVOICES } from './einvoice/invoices'

installPdfCanvasGlobals()

const { PdfDocument, PdfFacturX, PdfLink, PdfPage, PdfText } = PDF_COMPONENTS

const ROBOTO = {
  family: 'Roboto',
  src: `data:font/ttf;base64,${readFileSync('test/fixtures/assets/Roboto-Regular.ttf').toString('base64')}` as PdfFontDataUrl,
}

// Invented passwords. MARKER must never appear outside the encryption.
const OPEN = 'open-Kestrel-41'
const OWNER = 'owner-Heron-77'
const MARKER = 'Marker-Pw-9Zq4Xv'
const TEXT = 'Field report for Alder Valley'

/** Render a one-page document with these document props and extra children. */
const renderDocument = async (props: PdfDocumentProps, extra: VNode[] = [], page?: () => unknown) => {
  const component = defineComponent(() => () => h(PdfDocument, { title: 'Field report', language: 'en', ...props } as never, () => [
    ...extra,
    h(PdfPage, { size: 'A6', style: { fontFamily: 'Roboto', padding: 24 } }, () => page?.() ?? h(PdfText, null, () => TEXT)),
  ]))
  const password = props.protection?.openPassword
  const { bytes } = await renderPreparedPdfTemplate(component, {}, { fonts: [ROBOTO], ...(password && { password }) })
  return bytes
}

const errorOf = async (run: () => Promise<unknown>): Promise<Error> => {
  try {
    await run()
  }
  catch (error) {
    if (error instanceof Error) return error
    throw error
  }
  throw new Error('The render did not fail.')
}

/** The entries of the `/Encrypt` dictionary the trailer points to, as written. */
const encryptDictionary = (bytes: Uint8Array): string => {
  const text = Buffer.from(bytes).toString('latin1')
  const id = /trailer\s*<<[\s\S]*?\/Encrypt (\d+) 0 R/.exec(text)?.[1]
  expect(id).toBeDefined()
  const object = new RegExp(`\\n${id} 0 obj\\n(<<[\\s\\S]*?>>)\\nendobj`).exec(text)?.[1]
  expect(object).toBeDefined()
  return object!
}

const entry = (dictionary: string, key: string): string | undefined =>
  new RegExp(`/${key} ([^\\n]+)`).exec(dictionary)?.[1]

/** pdf.js's reading of the permission flags, opened with the open password. */
const pdfJsPermissions = async (bytes: Uint8Array, password: string): Promise<number[] | null> => {
  const task = getDocument({ data: Uint8Array.from(bytes), password, verbosity: 0 })
  try {
    return await (await task.promise).getPermissions()
  }
  finally {
    await task.destroy()
  }
}

describe('PdfDocument protection', () => {
  afterEach(() => {
    pdfRenderPlacement.inProcess = false
    vi.restoreAllMocks()
  })

  // Catches a PDF that opens without the password, or one the passwords do
  // not open (a wrong U/UE or O/OE value, or wrongly encrypted content).
  it('needs the open password, and opens with the open or the owner password', async () => {
    const bytes = await renderDocument({ protection: { openPassword: OPEN, ownerPassword: OWNER } })

    await expect(parsePdf(bytes)).rejects.toMatchObject({ name: 'PasswordException', code: 1 })
    await expect(parsePdf(bytes, { password: 'not-the-password' })).rejects.toMatchObject({ name: 'PasswordException', code: 2 })
    expect((await parsePdf(bytes, { password: OPEN })).pages[0]?.text).toBe(TEXT)
    expect((await parsePdf(bytes, { password: OWNER })).pages[0]?.text).toBe(TEXT)
  })

  // Catches an owner-only PDF that asks for a password to open.
  it('opens without a password when only ownerPassword is set', async () => {
    const bytes = await renderDocument({ protection: { ownerPassword: OWNER, allow: { copying: false } } })

    expect((await parsePdf(bytes)).pages[0]?.text).toBe(TEXT)
    expect((await parsePdf(bytes, { password: OWNER })).pages[0]?.text).toBe(TEXT)
  })

  // Catches a weaker cipher (RC4, AES-128 or AES-256 revision 5) or a missing
  // extension declaration. Revision 6 is AES-256 with the iterated password
  // hash of ISO 32000-2 (Algorithm 2.B).
  it('writes AES-256, revision 6, PDF 1.7 with Adobe extension level 8', async () => {
    const bytes = await renderDocument({ protection: { openPassword: OPEN } })
    const dictionary = encryptDictionary(bytes)
    const text = Buffer.from(bytes).toString('latin1')

    expect(text.startsWith('%PDF-1.7\n')).toBe(true)
    expect(text).toMatch(/\/Extensions <<\n\/ADBE <<\n\/BaseVersion \/1\.7\n\/ExtensionLevel 8\n>>\n>>/)
    expect(entry(dictionary, 'Filter')).toBe('/Standard')
    expect(entry(dictionary, 'V')).toBe('5')
    expect(entry(dictionary, 'R')).toBe('6')
    expect(entry(dictionary, 'Length')).toBe('256')
    expect(entry(dictionary, 'CFM')).toBe('/AESV3')
    expect(entry(dictionary, 'StmF')).toBe('/StdCF')
    expect(entry(dictionary, 'StrF')).toBe('/StdCF')
    expect(entry(dictionary, 'P')).toBe('-4')
  })

  // Catches a permission that maps to the wrong bit. pdf.js reads /P on its own.
  it.each<[string, PdfPermissions | undefined, number, number[]]>([
    ['everything (default)', undefined, -4, [4, 8, 16, 32, 256, 512, 1024, 2048]],
    ['no printing, no copying', { printing: 'none', copying: false }, -2072, [8, 32, 256, 512, 1024]],
    ['low-quality printing', { printing: 'low' }, -2052, [4, 8, 16, 32, 256, 512, 1024]],
    ['read and print only', { changing: false, annotating: false, fillingForms: false, assembling: false }, -1324, [4, 16, 512, 2048]],
    ['nothing', { printing: 'none', copying: false, changing: false, annotating: false, fillingForms: false, extractingForAccessibility: false, assembling: false }, -3904, []],
  ])('writes /P for %s', async (_case, allow, flags, pdfJsFlags) => {
    const bytes = await renderDocument({ protection: { openPassword: OPEN, ...(allow && { allow }) } })

    expect(permissionFlags(allow)).toBe(flags)
    expect(entry(encryptDictionary(bytes), 'P')).toBe(String(flags))
    expect((await pdfJsPermissions(bytes, OPEN))?.toSorted((a, b) => a - b)).toEqual(pdfJsFlags)
  })

  // Catches a /Perms value with the wrong layout, which Acrobat treats as a
  // tampered permission set (ISO 32000-2, Algorithm 10). pdf.js does not check it.
  it('writes /Perms as the encrypted permission flags', () => {
    const fileKey = randomBytes(32)
    const { perms } = encryptionValues(fileKey, Buffer.from(OPEN), Buffer.from(OWNER), -2072)
    const decipher = createDecipheriv('aes-256-ecb', fileKey, null).setAutoPadding(false)
    const plain = Buffer.concat([decipher.update(perms), decipher.final()])

    expect(plain.subarray(0, 12).toString('hex')).toBe(`${Buffer.from([0xE8, 0xF7, 0xFF, 0xFF]).toString('hex')}ffffffff${Buffer.from('Tadb').toString('hex')}`)
  })

  // Catches salts or IVs derived from the document (so equal documents give
  // equal bytes): the bytes differ on every render, the content does not.
  // It cannot see a fixed file key alone; that would need the key derivation
  // in the test.
  it('writes different bytes on every render, with the same content', async () => {
    const props: PdfDocumentProps = { creationDate: new Date(Date.UTC(2026, 0, 31)), protection: { openPassword: OPEN } }
    const [first, second] = [await renderDocument(props), await renderDocument(props)]

    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(false)
    const text = async (bytes: Uint8Array) => (await parsePdf(bytes, { password: OPEN })).pages.map(page => page.textRuns.map(({ fontName: _, ...run }) => run))
    expect(await text(first)).toEqual(await text(second))
  })

  // Catches a password written into the PDF in readable form, and metadata
  // written without encryption.
  it('writes neither the passwords nor the metadata in readable form', async () => {
    const bytes = Buffer.from(await renderDocument({ subject: 'Alder Valley survey', protection: { openPassword: MARKER, ownerPassword: OWNER } }))

    for (const needle of [MARKER, OWNER, 'Alder Valley survey', 'Field report']) {
      expect(bytes.includes(Buffer.from(needle, 'latin1'))).toBe(false)
      expect(bytes.includes(Buffer.from(needle, 'utf16le'))).toBe(false)
    }
  })

  // PDF/UA-1 permits encryption when assistive technology may read the content.
  it('protects a PDF/UA-1 document', async () => {
    const bytes = await renderDocument({ conformance: 'PDF/UA-1', protection: { openPassword: OPEN, allow: { copying: false } } })

    expect((await parsePdf(bytes, { password: OPEN })).pages[0]?.text).toBe(TEXT)
  })

  // pdfkit left the keys of the destination name tree unencrypted, so a
  // reader decrypted them into other names and no internal link resolved.
  it('resolves an internal link in a protected document', async () => {
    const bytes = await renderDocument({ protection: { openPassword: OPEN } }, [], () => [
      h(PdfLink, { href: '#findings' }, () => 'To the findings'),
      h(PdfText, { id: 'findings', break: true }, () => 'Findings'),
    ])

    expect((await parsePdf(bytes, { password: OPEN })).links.map(link => link.destination)).toEqual(['findings'])
    const task = getDocument({ data: Uint8Array.from(bytes), password: OPEN, verbosity: 0 })
    try {
      const document = await task.promise
      const destination = await document.getDestination('findings') as [{ num: number, gen: number }] | null
      expect(destination).not.toBeNull()
      expect(await document.getPageIndex(destination![0])).toBe(1)
    }
    finally {
      await task.destroy()
    }
  })

  // Catches an invalid or conflicting protection that renders anyway, and a
  // message that names the password.
  it.each<[string, PdfDocumentProps, VNode[], string]>([
    ['PDF/A', { conformance: 'PDF/A-3b', protection: { openPassword: MARKER } }, [], '<PdfDocument> claims PDF/A-3b, which must not be encrypted; remove "protection" or the PDF/A level from "conformance".'],
    ['PdfFacturX', { protection: { openPassword: MARKER } }, [h(PdfFacturX, { invoice: VALID_INVOICES['two-rates']!, profile: 'EN 16931' })], '<PdfFacturX> writes a PDF/A-3 file, which must not be encrypted; remove "protection" from <PdfDocument>, or send the e-invoice unprotected.'],
    ['PDF/UA without accessibility extraction', { conformance: 'PDF/UA-1', protection: { openPassword: MARKER, allow: { extractingForAccessibility: false } } }, [], '<PdfDocument> claims PDF/UA-1, which requires that assistive technology can read the content; remove "protection.allow.extractingForAccessibility" or set it to true.'],
    ['another pdfVersion', { pdfVersion: '1.4', protection: { openPassword: MARKER } }, [], '<PdfDocument> "protection" writes PDF 1.7 with AES-256; remove "pdfVersion" or set it to "1.7".'],
    ['no password', { protection: { allow: {} } as never }, [], '<PdfDocument> "protection" requires "openPassword", "ownerPassword" or both.'],
    ['an empty password', { protection: { openPassword: '' } }, [], '<PdfDocument> "protection.openPassword" must not be empty.'],
    ['equal passwords', { protection: { openPassword: MARKER, ownerPassword: MARKER } }, [], '<PdfDocument> "protection.openPassword" and "protection.ownerPassword" are the same, so whoever opens the PDF gets every permission; use different passwords, or give only "openPassword".'],
    ['a password with a control character', { protection: { openPassword: `${MARKER}\n` } }, [], '<PdfDocument> "protection.openPassword" must not contain control, format or private-use characters, or spaces other than U+0020.'],
    ['a password with a no-break space', { protection: { ownerPassword: `${MARKER}\u00A0x` } }, [], '<PdfDocument> "protection.ownerPassword" must not contain control, format or private-use characters, or spaces other than U+0020.'],
    ['a password NFKC changes', { protection: { openPassword: `${MARKER}\uFB01` } }, [], '<PdfDocument> "protection.openPassword" must not change under Unicode NFKC normalization.'],
    ['a password over 127 bytes', { protection: { openPassword: `${MARKER}${'ä'.repeat(60)}` } }, [], '<PdfDocument> "protection.openPassword" must be at most 127 bytes in UTF-8.'],
    ['a number as password', { protection: { openPassword: 4711 as never } }, [], '<PdfDocument> "protection.openPassword" must be a string.'],
    ['an unknown key', { protection: { openPassword: MARKER, userPassword: MARKER } as never }, [], '<PdfDocument> "protection" has the unknown key "userPassword"; use "openPassword", "ownerPassword" and "allow".'],
    ['an unknown permission', { protection: { openPassword: MARKER, allow: { printingHigh: true } as never } }, [], '<PdfDocument> "protection.allow" has the unknown permission "printingHigh"; use "printing", "copying", "changing", "annotating", "fillingForms", "extractingForAccessibility" or "assembling".'],
    // D23: an unknown key is cut at 40 characters like every echoed value.
    ['a long unknown key', { protection: { openPassword: MARKER, ['k'.repeat(50)]: true } as never }, [], `<PdfDocument> "protection" has the unknown key "${'k'.repeat(37)}..."; use "openPassword", "ownerPassword" and "allow".`],
    ['a long unknown permission', { protection: { openPassword: MARKER, allow: { ['p'.repeat(50)]: true } as never } }, [], `<PdfDocument> "protection.allow" has the unknown permission "${'p'.repeat(37)}..."; use "printing", "copying", "changing", "annotating", "fillingForms", "extractingForAccessibility" or "assembling".`],
    ['an unknown printing level', { protection: { openPassword: MARKER, allow: { printing: 'medium' as never } } }, [], '<PdfDocument> "protection.allow.printing" must be "none", "low" or "high".'],
    ['fillingForms off with annotating on', { protection: { openPassword: MARKER, allow: { fillingForms: false } } }, [], '<PdfDocument> "protection.allow.fillingForms" is false, but "annotating" also permits filling forms; set "annotating" to false too.'],
    ['protection that is not an object', { protection: MARKER as never }, [], '<PdfDocument> "protection" must be an object with "openPassword", "ownerPassword" or both, and optional "allow".'],
  ])('rejects %s with a typed error that does not name the password', async (_case, props, extra, message) => {
    const error = await errorOf(() => renderDocument(props, extra))

    expect(error).toBeInstanceOf(NuxtPdfError)
    expect((error as NuxtPdfError).code).toBe(PDF_ERROR_CODES.TreeInvalid)
    expect(error.message).toContain(message)
    expect(`${error.message}\n${error.stack}`).not.toContain(MARKER)
  })

  // Catches a password in the error, its cause chain or a log line of a
  // render that fails after the protected tree was built, on the worker path
  // and on the in-process path.
  it.each([false, true])('keeps the passwords out of errors and logs of a failing render (in-process: %s)', async (inProcess) => {
    pdfRenderPlacement.inProcess = inProcess
    const logged: unknown[] = []
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logged.push(...args)
      })
    }
    const failures = [
      // A template error while the tree is mounted.
      await errorOf(() => renderDocument({ protection: { openPassword: MARKER, ownerPassword: `${MARKER}-owner` } }, [], () => {
        throw new Error('The report data is missing.')
      })),
      // An engine error after the tree reached the writer: an image with
      // bytes no decoder accepts.
      await errorOf(() => renderDocument({ protection: { openPassword: MARKER } }, [], () =>
        h(PDF_COMPONENTS.PdfImage, { src: Uint8Array.from([0x89, 0x50, 0x4E, 0x47, 1, 2, 3]) }))),
    ]

    const seen: string[] = []
    const collect = (value: unknown, depth = 0): void => {
      if (depth > 5 || value === undefined || value === null) return
      if (value instanceof Error) {
        seen.push(value.message, value.stack ?? '', JSON.stringify(value))
        collect(value.cause, depth + 1)
        return
      }
      seen.push(typeof value === 'string' ? value : JSON.stringify(value) ?? String(value))
    }
    for (const failure of failures) collect(failure)
    for (const line of logged) collect(line)

    expect(failures.every(failure => failure instanceof NuxtPdfError)).toBe(true)
    expect(seen.join('\n')).not.toContain(MARKER)
  })
})
