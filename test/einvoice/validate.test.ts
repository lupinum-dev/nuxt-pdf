import { describe, expect, it } from 'vitest'
import { renderEInvoiceXml, validateEInvoice } from '../../src/runtime/einvoice'
import type { EInvoiceProfile } from '../../src/runtime/einvoice'
import { NuxtPdfError, PDF_ERROR_CODES } from '../../src/runtime/shared/errors'
import { generatedInvoices } from './generate'
import { forXRechnung, VALID_INVOICES } from './invoices'
import { RULE_CASES } from './rule-cases'

const PROFILES: readonly EInvoiceProfile[] = ['MINIMUM', 'BASIC WL', 'BASIC', 'EN 16931', 'XRECHNUNG']

describe('validateEInvoice', () => {
  // Catches a rule that is never reported, or reported at another field: the
  // smallest change that breaks the rule must give that rule at that path.
  it.each(RULE_CASES.map(entry => [entry.rule, entry.path, entry] as const))('reports %s at %s', (_rule, _path, entry) => {
    const issues = validateEInvoice(entry.invoice, { profile: entry.profile })
    expect(issues).toContainEqual(expect.objectContaining({ rule: entry.rule, path: entry.path }))
    for (const issue of issues) expect(issue.message.length).toBeGreaterThan(20)
  })

  // Catches false positives: a check that rejects a valid invoice. Only the
  // rounding amount, which BASIC and BASIC WL cannot carry, is reported.
  it('reports nothing for the valid invoices in the Factur-X profiles', () => {
    const reported = PROFILES.filter(profile => profile !== 'XRECHNUNG').flatMap(profile =>
      Object.entries(VALID_INVOICES).flatMap(([name, invoice]) =>
        validateEInvoice(invoice, { profile }).map(issue => `${profile} ${name} ${issue.rule}`)))
    expect(reported.sort()).toEqual(['BASIC WL prepaid-and-rounding BR-CO-16', 'BASIC prepaid-and-rounding BR-CO-16'].sort())
  })

  // Catches XRechnung checks that demand more than XRechnung: every fixture
  // with the XRechnung fields, and every generated invoice, is clean.
  it('reports nothing for the valid invoices with the XRechnung fields', () => {
    const invoices = [...Object.values(VALID_INVOICES).map(forXRechnung), ...generatedInvoices()]
    expect(invoices.flatMap(invoice => validateEInvoice(invoice, { profile: 'XRECHNUNG' }))).toEqual([])
    expect(generatedInvoices().flatMap(invoice => validateEInvoice(invoice, { profile: 'EN 16931' }))).toEqual([])
  })

  // Catches the BR-DE rules leaking into EN 16931: an invoice without the
  // XRechnung fields is valid EN 16931.
  it('applies the XRechnung rules only to XRECHNUNG', () => {
    const invoice = VALID_INVOICES['outside-scope']!
    expect(validateEInvoice(invoice, { profile: 'EN 16931' })).toEqual([])
    expect(validateEInvoice(invoice, { profile: 'XRECHNUNG' }).map(issue => issue.rule))
      .toEqual(['BR-DE-15', 'BR-DE-2', 'PEPPOL-EN16931-R020', 'PEPPOL-EN16931-R010'])
  })

  // Catches a malformed value escaping as an exception: the form must get a
  // list, not a crash.
  it('returns malformed values as issues instead of throwing', () => {
    const invoice = { ...VALID_INVOICES['one-line']!, issueDate: '2.11.2026', lines: [{ ...VALID_INVOICES['one-line']!.lines[0]!, netPrice: 'abc', quantity: Number.NaN }] }
    expect(validateEInvoice(invoice, { profile: 'EN 16931' }).map(issue => `${issue.rule} ${issue.path}`)).toEqual([
      'PDF-VALUE invoice.issueDate',
      'PDF-VALUE invoice.lines[0].quantity',
      'PDF-VALUE invoice.lines[0].netPrice',
    ])
  })

  // A request body as `readBody` gives it: null for "null", undefined for an
  // empty body. Catches a TypeError on the missing invoice.
  it.each(['null', undefined])('returns one issue for a missing invoice (%s)', (body) => {
    const invoice = body === undefined ? undefined : JSON.parse(body)
    expect(validateEInvoice(invoice, { profile: 'XRECHNUNG' })).toEqual([
      { rule: 'PDF-VALUE', path: 'invoice', message: 'invoice is missing. Send the invoice data as an object.' },
    ])
  })
})

describe('renderEInvoiceXml', () => {
  // Catches writing XML for an invoice that breaks a rule, and losing the
  // issues on the way: the error carries the same list validateEInvoice gives.
  it('refuses an invoice with issues with PDF_INVOICE_INVALID and the issues', () => {
    const entry = RULE_CASES.find(candidate => candidate.rule === 'BR-DE-15')!
    const error = (() => {
      try {
        renderEInvoiceXml(entry.invoice, { profile: 'XRECHNUNG' })
      }
      catch (caught) {
        return caught
      }
      return undefined
    })()
    expect(error).toBeInstanceOf(NuxtPdfError)
    expect(error).toMatchObject({
      code: PDF_ERROR_CODES.InvoiceInvalid,
      issues: validateEInvoice(entry.invoice, { profile: 'XRECHNUNG' }),
      message: expect.stringContaining('BR-DE-15 at invoice.buyerReference'),
    })
  })
})
