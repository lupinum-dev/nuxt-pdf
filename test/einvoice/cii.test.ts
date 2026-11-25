import { describe, expect, it } from 'vitest'
import { renderEInvoiceXml } from '../../src/runtime/einvoice'
import { writeEInvoiceXml } from '../../src/runtime/einvoice/cii'
import { scanCiiXml } from '../../src/runtime/renderer/factur-x-xml'
import { NuxtPdfError } from '../../src/runtime/shared/errors'
import { VALID_INVOICES } from './invoices'

const EN16931 = { profile: 'EN 16931' } as const

describe('renderEInvoiceXml', () => {
  // Catches a timestamp, a random id or iteration over unordered state in the
  // output: equal input, also as a fresh copy, must give the same string.
  it('gives the same string for equal input', () => {
    for (const invoice of Object.values(VALID_INVOICES)) {
      const first = renderEInvoiceXml(invoice, EN16931)
      expect(renderEInvoiceXml(structuredClone(invoice), EN16931)).toBe(first)
      expect(renderEInvoiceXml(invoice, EN16931)).toBe(first)
    }
  })

  // Catches unescaped `&`, `<`, `>` in text and `"` in attributes: the XML
  // must stay well-formed and keep the guideline id readable.
  it('escapes text and attribute values', () => {
    const xml = renderEInvoiceXml(VALID_INVOICES['card-and-references']!, EN16931)
    expect(scanCiiXml(xml)).toEqual({ root: 'rsm:CrossIndustryInvoice', guidelineId: 'urn:cen.eu:en16931:2017' })
    expect(xml).toContain('<ram:ID>INV-0014 &lt;A&amp;B&gt;</ram:ID>')
    expect(xml).toContain('<ram:IssuerAssignedID>PO-"7781"</ram:IssuerAssignedID>')
    // No EAS code holds a quote, so only the writer without the rule check can show attribute escaping.
    const quoted = writeEInvoiceXml({ ...VALID_INVOICES['one-line']!, seller: { ...VALID_INVOICES['one-line']!.seller, electronicAddress: { value: 'x', scheme: 'A"B' } } }, 'EN 16931')
    expect(quoted).toContain('schemeID="A&quot;B"')
  })

  // Catches writing characters XML forbids, and dates the validators would
  // read as another day.
  it.each([
    [{ number: 'INV\u0001' }, 'has the character U+0001'],
    [{ issueDate: '2026-02-30' }, 'invoice.issueDate must be a calendar date written as "YYYY-MM-DD"'],
    [{ issueDate: '02.11.2026' }, 'invoice.issueDate must be a calendar date'],
  ])('rejects %j with a typed error', (extra, message) => {
    const run = () => renderEInvoiceXml({ ...VALID_INVOICES['one-line']!, ...extra }, EN16931)
    expect(run).toThrowError(NuxtPdfError)
    expect(run).toThrowError(message)
  })
})

/** The header summation amounts of a CII document, by element name. */
const summation = (xml: string): Record<string, string> => {
  const block = /<ram:SpecifiedTradeSettlementHeaderMonetarySummation>([\s\S]*?)<\/ram:SpecifiedTradeSettlementHeaderMonetarySummation>/.exec(xml)![1]!
  return Object.fromEntries([...block.matchAll(/<ram:(\w+)(?: [^>]*)?>([^<]*)</g)].map(([, name, value]) => [name!, value!]))
}

describe('profile projections', () => {
  // Catches a lower profile that computes its totals from the subset it
  // writes: MINIMUM and BASIC WL have no lines, yet their header totals must
  // be the totals of the full invoice.
  it.each(Object.keys(VALID_INVOICES).filter(name => name !== 'prepaid-and-rounding'))('%s keeps the EN 16931 header totals in MINIMUM and BASIC WL', (name) => {
    const invoice = VALID_INVOICES[name]!
    const full = summation(renderEInvoiceXml(invoice, EN16931))
    const basicWl = summation(renderEInvoiceXml(invoice, { profile: 'BASIC WL' }))
    const minimum = summation(renderEInvoiceXml(invoice, { profile: 'MINIMUM' }))
    expect(basicWl).toEqual(full)
    expect(minimum).toEqual({
      TaxBasisTotalAmount: full.TaxBasisTotalAmount,
      TaxTotalAmount: full.TaxTotalAmount,
      GrandTotalAmount: full.GrandTotalAmount,
      DuePayableAmount: full.DuePayableAmount,
    })
    expect(renderEInvoiceXml(invoice, { profile: 'MINIMUM' })).not.toContain('IncludedSupplyChainTradeLineItem')
  })
})
