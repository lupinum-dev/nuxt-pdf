import { NuxtPdfError, pdf } from '#pdf'

export default defineEventHandler(async (event) => {
  try {
    const result = await pdf['production-error'].render({
      message: 'private production render failure',
    })
    return result.response()
  }
  catch (error) {
    if (!(error instanceof NuxtPdfError)) throw error

    setResponseStatus(event, 500)
    return { code: error.code }
  }
})
