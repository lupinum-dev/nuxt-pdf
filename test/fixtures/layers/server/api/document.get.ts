import { pdf } from '#pdf'

export default defineEventHandler(async (event) => {
  const name = getQuery(event).name
  const result = name === 'certificate'
    ? await pdf.certificate.render({ recipient: 'Grace Hopper' })
    : await pdf.invoice.render({ projectMessage: 'Project route' })

  return result.response()
})
