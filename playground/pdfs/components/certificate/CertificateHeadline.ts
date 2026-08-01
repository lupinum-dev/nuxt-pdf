import { defineComponent, h, type PropType } from 'vue'
import type { PdfStyleValue } from '@lupinum/nuxt-pdf'
import { PdfText } from '../../../../src/runtime/components'

// A headline PdfText that forbids intra-word hyphenation. Setting
// `hyphenationCallback` here (in JS) keeps the exact camelCase key the engine
// reads — a template attribute would be kebab-cased by lint and silently
// no-op. Used for the hero name and course title so they wrap only at spaces.
const keepWhole = (word: string): string[] => [word]

export default defineComponent({
  name: 'CertificateHeadline',
  props: {
    text: { type: String, required: true },
    sx: { type: Object as PropType<PdfStyleValue>, required: true },
  },
  setup(props) {
    return () => h(PdfText, { hyphenationCallback: keepWhole, style: props.sx }, {
      default: () => props.text,
    })
  },
})
