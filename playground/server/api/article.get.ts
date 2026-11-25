import { parseRichTextMarkdown, pdf } from '#pdf'
import { markdownArticle } from '../../shared/article'

// Markdown is parsed here, where the data is loaded: the parse is async, and a
// PDF template cannot await. The template gets the model as `content`.
export default defineEventHandler(async (event) => {
  const { markdown, ...article } = markdownArticle
  const content = await parseRichTextMarkdown(markdown)
  const result = await pdf.article.render({ article: { ...article, content } })

  return result.response({
    disposition: getQuery(event).inline === '1' ? 'inline' : 'attachment',
  })
})
