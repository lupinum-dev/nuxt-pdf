import { NuxtPdfError, pdf } from '#pdf'

export default defineEventHandler(async () => {
  try {
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
  }
  catch (error) {
    // Exercises the public #pdf error export end-to-end: the class must be a
    // real constructor here, not a type-only phantom.
    if (error instanceof NuxtPdfError) {
      throw createError({ statusCode: 500, statusMessage: error.code })
    }
    throw error
  }
})
