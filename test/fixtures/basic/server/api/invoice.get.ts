import { pdf } from '#pdf'

export default defineEventHandler(async () => {
  const result = await pdf.invoice.render({
    customer: 'Ada Lovelace',
    number: 'INV-001',
    lines: [{
      description: 'PDF framework',
      id: 'framework',
      price: 'EUR 1,250.00',
    }],
  })

  return result.response()
})
