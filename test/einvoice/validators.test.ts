import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { renderEInvoiceXml, validateEInvoice } from '../../src/runtime/einvoice'
import type { EInvoice, EInvoiceProfile } from '../../src/runtime/einvoice'
import { writeEInvoiceXml } from '../../src/runtime/einvoice/cii'
import { GENERATED_SEED, generatedInvoices } from './generate'
import { forXRechnung, VALID_INVOICES } from './invoices'
import { renderInvoicePdf } from './render-pdf'
import { RULE_CASES } from './rule-cases'

// `pnpm test:einvoice` checks Java and the validator files, then sets these;
// `pnpm test` skips this file.
const MUSTANG_JAR = process.env.NUXT_PDF_MUSTANG_JAR
const KOSIT_JAR = process.env.NUXT_PDF_KOSIT_JAR
const XRECHNUNG_CONFIG_DIR = process.env.NUXT_PDF_XRECHNUNG_CONFIG_DIR

interface ValidatorMessage {
  /** The rule id (`BR-CO-15`, `FX-SCH-A-000173`) or `XSD <code>` for a schema error. */
  rule: string
  message: string
}

interface ValidationResult {
  valid: boolean
  errors: ValidatorMessage[]
  warnings: ValidatorMessage[]
}

const decodeXml = (text: string): string => text
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>')
  .replaceAll('&quot;', '"')
  .replaceAll('&apos;', '\'')
  .replaceAll('&amp;', '&')

const messagesOf = (report: string, kind: 'error' | 'warning'): ValidatorMessage[] =>
  [...report.matchAll(new RegExp(`<${kind}\\b([^>]*)>([\\s\\S]*?)</${kind}>`, 'g'))].map(([, attributes, body]) => {
    const message = decodeXml(body!).trim()
    const rule = /\[ID ([^\]]+)\]/.exec(message)?.[1]
      ?? /schema validation fails.*?(cvc-[\w.-]+)/.exec(message)?.[1]?.replace(/^/, 'XSD ')
      // PDF and XMP errors carry only a numeric type.
      ?? /\btype="(\d+)"/.exec(attributes!)?.[1]?.replace(/^/, 'type ')
      ?? 'unknown'
    return { rule, message }
  })

/**
 * Parse Mustang's XML report. Each part (`<pdf>`, `<xml>`) has its own
 * `<summary status>`, and the report one more. A file is valid only when every
 * summary says so: for a PDF whose XMP is wrong, Mustang 2.26.0 writes
 * `invalid` for the PDF part but `valid` for the report, and exits with 0.
 * Errors carry the rule id in `[ID …]`, schema errors the Xerces code
 * (`cvc-complex-type.2.4.a`), PDF errors a numeric `type`.
 */
const parseMustangReport = (report: string): ValidationResult => {
  const statuses = [...report.matchAll(/<summary status="([^"]+)"/g)].map(match => match[1])
  if (statuses.length === 0) throw new Error(`Mustang wrote no summary:\n${report.slice(0, 2000)}`)
  return {
    valid: statuses.every(status => status === 'valid'),
    errors: messagesOf(report, 'error'),
    warnings: messagesOf(report, 'warning'),
  }
}

const runMustang = (jar: string, directory: string, file: string): Promise<string> => new Promise((resolve, reject) => {
  execFile(
    'java',
    ['-Xmx512m', '-jar', jar, '--action', 'validate', '--source', file, '--no-notices', '--disable-file-logging'],
    { cwd: directory, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 120_000 },
    // Mustang exits non-zero for an invalid file; the report is still on stdout.
    (error, stdout) => {
      if (stdout.includes('<summary status=')) resolve(stdout)
      else reject(error ?? new Error(`Mustang wrote no report for ${file}.`))
    },
  )
})

/** The file name of a document: bytes are a PDF, text is XML. */
const fileOf = (name: string, data: string | Uint8Array): string => `${name}.${typeof data === 'string' ? 'xml' : 'pdf'}`

/**
 * Validate XML documents and hybrid PDFs with Mustang as Factur-X / ZUGFeRD.
 * One JVM per file (the CLI validates one source per start), at most two at a
 * time.
 */
const validateAll = async (jar: string, directory: string, documents: Readonly<Record<string, string | Uint8Array>>): Promise<Record<string, ValidationResult>> => {
  const names = Object.keys(documents)
  await Promise.all(names.map(name => writeFile(join(directory, fileOf(name, documents[name]!)), documents[name]!)))
  const results: Record<string, ValidationResult> = {}
  const queue = [...names]
  const worker = async (): Promise<void> => {
    for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
      results[name] = parseMustangReport(await runMustang(jar, directory, fileOf(name, documents[name]!)))
    }
  }
  await Promise.all([worker(), worker()])
  return results
}

interface KositResult {
  accepted: boolean
  /** Rule ids of the messages with level error. */
  errors: string[]
  warnings: string[]
}

/** Parse a KoSIT `<name>-report.xml`: the accept or reject verdict and the rule ids by level. */
const parseKositReport = (report: string): KositResult => {
  const messages = [...report.matchAll(/<rep:message\b([^>]*)>/g)].map(([, attributes]) => ({
    level: /\blevel="([^"]+)"/.exec(attributes!)?.[1],
    code: /\bcode="([^"]+)"/.exec(attributes!)?.[1] ?? 'unknown',
  }))
  const accepted = /<rep:accept\b/.test(report)
  if (!accepted && !/<rep:reject\b/.test(report)) throw new Error(`KoSIT wrote no verdict:\n${report.slice(0, 2000)}`)
  return {
    accepted,
    errors: messages.filter(message => message.level === 'error').map(message => message.code),
    warnings: messages.filter(message => message.level === 'warning').map(message => message.code),
  }
}

/**
 * Validate XML documents with the KoSIT validator and the XRechnung
 * configuration, all in one JVM. KoSIT writes `<name>-report.xml` for each
 * file into the output folder.
 */
const validateAllWithKosit = async (jar: string, config: string, directory: string, documents: Readonly<Record<string, string>>): Promise<Record<string, KositResult>> => {
  const input = join(directory, 'kosit-in')
  const output = join(directory, 'kosit-out')
  await mkdir(input)
  await mkdir(output)
  const names = Object.keys(documents)
  await Promise.all(names.map(name => writeFile(join(input, `${name}.xml`), documents[name]!)))
  await new Promise<void>((resolve, reject) => {
    execFile(
      'java',
      ['-Xmx512m', '-jar', jar, '-s', join(config, 'scenarios.xml'), '-r', config, '-o', output, ...names.map(name => join(input, `${name}.xml`))],
      { cwd: directory, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 600_000 },
      // KoSIT exits non-zero when a file is rejected; the reports are still written.
      error => (error && error.killed ? reject(error) : resolve()),
    )
  })
  const results: Record<string, KositResult> = {}
  for (const name of names) results[name] = parseKositReport(await readFile(join(output, `${name}-report.xml`), 'utf8'))
  return results
}

const render = (name: string): string => renderEInvoiceXml(VALID_INVOICES[name]!, { profile: 'EN 16931' })

/** Replace exactly one occurrence, so a fault cannot silently miss its target. */
const replaceOnce = (xml: string, search: string | RegExp, replacement: string): string => {
  const count = typeof search === 'string' ? xml.split(search).length - 1 : [...xml.matchAll(new RegExp(search, 'g'))].length
  if (count !== 1) throw new Error(`Expected one match for ${String(search)}, found ${count}.`)
  return xml.replace(search, replacement)
}

/**
 * Faults put into valid XML. Each must make Mustang report invalid with the
 * named rule; this proves the harness can fail.
 */
const FAULTS: Readonly<Record<string, { rule: string, xml: () => string }>> = {
  // BT-112 must equal BT-109 + BT-110.
  'wrong-grand-total': {
    rule: 'BR-CO-15',
    xml: () => replaceOnce(render('two-rates'), /<ram:GrandTotalAmount>[\d.]+</, '<ram:GrandTotalAmount>9999.99<'),
  },
  // BT-1 is mandatory.
  'missing-invoice-number': {
    rule: 'BR-02',
    xml: () => replaceOnce(render('one-line'), '    <ram:ID>INV-0001</ram:ID>\n', ''),
  },
  // BT-116 of the 7 % group must equal the sum of its line net amounts.
  'breakdown-does-not-match-lines': {
    rule: 'BR-S-08',
    xml: () => replaceOnce(render('two-rates'), '<ram:BasisAmount>561.60</ram:BasisAmount>', '<ram:BasisAmount>561.70</ram:BasisAmount>'),
  },
  // The buyer must follow the seller (XSD sequence).
  'element-out-of-order': {
    rule: 'XSD cvc-complex-type.2.4.a',
    xml: () => {
      const xml = render('one-line')
      const seller = /( *<ram:SellerTradeParty>[\s\S]*?<\/ram:SellerTradeParty>\n)/.exec(xml)![1]!
      const buyer = /( *<ram:BuyerTradeParty>[\s\S]*?<\/ram:BuyerTradeParty>\n)/.exec(xml)![1]!
      return replaceOnce(xml, `${seller}${buyer}`, `${buyer}${seller}`)
    },
  },
  // BT-106 must equal the sum of BT-131.
  'line-total-does-not-match': {
    rule: 'BR-CO-10',
    xml: () => replaceOnce(render('two-rates'), '<ram:LineTotalAmount>1700.00</ram:LineTotalAmount>', '<ram:LineTotalAmount>1700.01</ram:LineTotalAmount>'),
  },
  // An exempt (E) breakdown needs a reason text or code.
  'exempt-without-reason': {
    rule: 'BR-E-10',
    xml: () => replaceOnce(render('exempt'), /\n *<ram:ExemptionReason>[^<]*<\/ram:ExemptionReason>/, ''),
  },
}

const FACTUR_X_PROFILES = ['MINIMUM', 'BASIC WL', 'BASIC', 'EN 16931'] as const satisfies readonly EInvoiceProfile[]
const slug = (profile: EInvoiceProfile): string => profile.toLowerCase().replace(' ', '-')

/**
 * Every fixture in every Factur-X profile that can carry it. The only
 * combination left out is a rounding amount in BASIC and BASIC WL, which
 * validate.test.ts checks is reported as BR-CO-16.
 */
const MATRIX = FACTUR_X_PROFILES.flatMap(profile => Object.keys(VALID_INVOICES)
  .filter(name => validateEInvoice(VALID_INVOICES[name]!, { profile }).length === 0)
  .map(name => ({ key: `${slug(profile)}-${name}`, profile, name })))

const GENERATED = generatedInvoices()
const CROSS_CHECKS = RULE_CASES.filter(entry => entry.validator !== undefined)
const crossCheckKey = (index: number): string => `cross-${index}-${CROSS_CHECKS[index]!.rule}`
const describeInvoice = (index: number, invoice: EInvoice): string =>
  `generated invoice ${index} of seed ${GENERATED_SEED}:\n${JSON.stringify(invoice, null, 2)}`

/** Every profile `PdfFacturX` accepts with `invoice`; XRECHNUNG gets the XRechnung fields. */
const PDF_PROFILES = ['MINIMUM', 'BASIC WL', 'BASIC', 'EN 16931', 'XRECHNUNG'] as const satisfies readonly EInvoiceProfile[]
const PDF_INVOICE = VALID_INVOICES['two-rates']!
const pdfInvoiceFor = (profile: EInvoiceProfile): EInvoice => profile === 'XRECHNUNG' ? forXRechnung(PDF_INVOICE) : PDF_INVOICE

/** Replace every occurrence of an ASCII string of the same length in PDF bytes, so the offsets stay valid. */
const patchPdf = (bytes: Uint8Array, search: string, replacement: string, count: number): Uint8Array => {
  if (search.length !== replacement.length) throw new Error('A PDF patch must keep the length.')
  const text = Buffer.from(bytes).toString('latin1')
  const found = text.split(search).length - 1
  if (found !== count) throw new Error(`Expected ${count} matches for ${search}, found ${found}.`)
  return new Uint8Array(Buffer.from(text.replaceAll(search, replacement), 'latin1'))
}

/**
 * Faults put into the valid EN 16931 PDF. Mustang must report each one;
 * `rule` is the Mustang error type. (Mustang does not compare the XMP
 * profile with the XML profile: a valid level of another profile passes, so
 * that fault uses a level that does not exist. `PdfFacturX` itself rejects a
 * profile that does not match the XML.)
 */
const PDF_FAULTS: Readonly<Record<string, { rule: string, pdf: (valid: Uint8Array) => Uint8Array }>> = {
  'xmp-names-no-profile': { rule: 'type 12', pdf: valid => patchPdf(valid, '>EN 16931<', '>COMFORT!<', 1) },
  'xml-not-embedded': { rule: 'type 19', pdf: valid => patchPdf(valid, 'factur-x.xml', 'factur-y.xml', 4) },
  'claims-pdf-a-2': { rule: 'type 23', pdf: valid => patchPdf(valid, '<pdfaid:part>3</pdfaid:part>', '<pdfaid:part>2</pdfaid:part>', 1) },
}

describe.runIf(MUSTANG_JAR !== undefined && KOSIT_JAR !== undefined && XRECHNUNG_CONFIG_DIR !== undefined)('the official validators accept the XML', () => {
  let directory = ''
  let mustang: Record<string, ValidationResult> = {}
  let kosit: Record<string, KositResult> = {}

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'nuxt-pdf-einvoice-'))
    const xrechnung: Record<string, string> = {}
    for (const [name, invoice] of Object.entries(VALID_INVOICES)) xrechnung[`xr-${name}`] = renderEInvoiceXml(forXRechnung(invoice), { profile: 'XRECHNUNG' })
    for (const [index, invoice] of GENERATED.entries()) xrechnung[`gen-${index}`] = renderEInvoiceXml(invoice, { profile: 'XRECHNUNG' })
    CROSS_CHECKS.forEach((entry, index) => {
      if (entry.validator === 'kosit') xrechnung[crossCheckKey(index)] = writeEInvoiceXml(entry.invoice, entry.profile)
    })
    // KoSIT first, then Mustang: at most two JVMs at a time.
    kosit = await validateAllWithKosit(KOSIT_JAR!, XRECHNUNG_CONFIG_DIR!, directory, xrechnung)

    const facturX: Record<string, string> = {}
    for (const { key, profile, name } of MATRIX) facturX[key] = renderEInvoiceXml(VALID_INVOICES[name]!, { profile })
    for (const [index, invoice] of GENERATED.entries()) facturX[`gen-${index}`] = renderEInvoiceXml(invoice, { profile: 'EN 16931' })
    for (const [name, fault] of Object.entries(FAULTS)) facturX[`fault-${name}`] = fault.xml()
    CROSS_CHECKS.forEach((entry, index) => {
      if (entry.validator === 'mustang') facturX[crossCheckKey(index)] = writeEInvoiceXml(entry.invoice, entry.profile)
    })
    const pdfs: Record<string, Uint8Array> = {}
    for (const profile of PDF_PROFILES) pdfs[`pdf-${slug(profile)}`] = await renderInvoicePdf(pdfInvoiceFor(profile), profile)
    // The XML supplied by the author, the way before `invoice` existed.
    pdfs['pdf-xml-prop'] = await renderInvoicePdf(PDF_INVOICE, 'EN 16931', { xml: renderEInvoiceXml(PDF_INVOICE, { profile: 'EN 16931' }) })
    for (const [name, fault] of Object.entries(PDF_FAULTS)) pdfs[`pdf-fault-${name}`] = fault.pdf(pdfs['pdf-en-16931']!)
    mustang = await validateAll(MUSTANG_JAR!, directory, { ...facturX, ...pdfs })
  }, 900_000)

  afterAll(async () => {
    if (directory) await rm(directory, { recursive: true, force: true })
  })

  // Catches XML a profile's XSD or Schematron rejects: each fixture passes
  // Mustang in every Factur-X profile that can carry it.
  it.each(MATRIX.map(entry => [entry.key, entry] as const))('%s passes Mustang', (key, { name, profile }) => {
    const result = mustang[key]!
    // The XSD requires ApplicableHeaderTradeDelivery even without delivery
    // data, and the PEPPOL rule R008 in the BASIC and EN 16931 Schematron
    // warns about every empty element. That warning, and only that one, is
    // expected there for an invoice without delivery.
    const expectedWarnings = VALID_INVOICES[name]!.delivery === undefined && (profile === 'BASIC' || profile === 'EN 16931') ? ['PEPPOL-EN16931-R008'] : []
    expect({ valid: result.valid, errors: result.errors, warnings: [...new Set(result.warnings.map(warning => warning.rule))] })
      .toEqual({ valid: true, errors: [], warnings: expectedWarnings })
  })

  // Catches XML that misses an XRechnung requirement or breaks a BR-DE rule.
  it.each(Object.keys(VALID_INVOICES))('%s with the XRechnung fields is accepted by KoSIT as XRECHNUNG', (name) => {
    const result = kosit[`xr-${name}`]!
    expect({ accepted: result.accepted, errors: result.errors }).toEqual({ accepted: true, errors: [] })
  })

  // Catches combinations the fixtures do not cover: generated invoices must
  // be valid EN 16931 in Mustang and accepted XRechnung in KoSIT.
  it('accepts every generated invoice in Mustang as EN 16931 and in KoSIT as XRECHNUNG', () => {
    const failures = GENERATED.flatMap((invoice, index) => {
      const fx = mustang[`gen-${index}`]!
      const xr = kosit[`gen-${index}`]!
      const fxErrors = fx.errors.map(error => error.rule)
      return fx.valid && xr.accepted && xr.errors.length === 0
        ? []
        : [`Mustang ${fx.valid ? 'valid' : 'invalid'} [${fxErrors.join(', ')}], KoSIT ${xr.accepted ? 'accepted' : 'rejected'} [${xr.errors.join(', ')}] for ${describeInvoice(index, invoice)}`]
    })
    expect(failures).toEqual([])
  })

  // Catches a hybrid PDF that is not valid as a whole: PDF/A-3, the XMP
  // Factur-X extension, the embedded file and its XML, for every profile the
  // component writes from invoice data and for XML the author supplies.
  it.each([...PDF_PROFILES.map(profile => `pdf-${slug(profile)}`), 'pdf-xml-prop'])('%s is a valid Factur-X PDF in Mustang', (key) => {
    const result = mustang[key]!
    expect({ valid: result.valid, errors: result.errors }).toEqual({ valid: true, errors: [] })
  })

  // Catches a PDF-level check the harness cannot see.
  it.each(Object.keys(PDF_FAULTS))('the PDF fault %s is reported invalid', (name) => {
    const result = mustang[`pdf-fault-${name}`]!
    expect(result.valid).toBe(false)
    expect(result.errors.map(error => error.rule)).toContain(PDF_FAULTS[name]!.rule)
  })

  // Catches a harness that cannot fail: each fault put into valid XML is
  // reported invalid with its rule.
  it.each(Object.keys(FAULTS))('the fault %s is reported invalid with its rule', (name) => {
    const result = mustang[`fault-${name}`]!
    expect(result.valid).toBe(false)
    expect(result.errors.map(error => error.rule)).toContain(FAULTS[name]!.rule)
  })

  // Catches a rule id or a check that does not match the standard: the
  // same invoice, written without the check, is rejected by the official
  // validator with the rule validateEInvoice reports.
  it.each(CROSS_CHECKS.map((entry, index) => [entry.rule, entry.validator!, index] as const))('%s is also rejected by %s', (rule, validator, index) => {
    const key = crossCheckKey(index)
    if (validator === 'mustang') {
      expect(mustang[key]!.valid).toBe(false)
      expect(mustang[key]!.errors.map(error => error.rule)).toContain(rule)
    }
    else {
      expect(kosit[key]!.accepted).toBe(false)
      expect(kosit[key]!.errors).toContain(rule)
    }
  })
})
