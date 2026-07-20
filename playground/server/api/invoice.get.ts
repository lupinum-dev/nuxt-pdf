import { pdf } from '#pdf'
import { sampleInvoice } from '../../shared/invoice'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const result = await pdf.invoice.render({ invoice: sampleInvoice })

  return result.response({
    disposition: query.inline === '1' ? 'inline' : 'attachment',
  })
})
