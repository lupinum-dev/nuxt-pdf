import { defineComponent, h } from 'vue'
import {
  PdfDocument,
  PdfImage,
  PdfLink,
  PdfPage,
  PdfText,
  PdfView,
} from '../../src/runtime/components'
import {
  conformanceLines,
  conformanceParagraphs,
  conformanceStyles as styles,
} from './conformance-data'

const Section = defineComponent({
  name: 'ConformanceSection',
  props: {
    title: { type: String, required: true },
    breakBefore: { type: Boolean, default: false },
  },
  setup(props, { slots }) {
    return () => h(PdfView, {
      break: props.breakBefore,
      style: styles.section,
    }, {
      default: () => [
        h(PdfText, { style: styles.sectionTitle }, () => props.title),
        slots.default?.(),
      ],
    })
  },
})

export const VueConformanceDocument = defineComponent({
  name: 'VueConformanceDocument',
  props: {
    imagePath: { type: String, required: true },
    showConditional: { type: Boolean, default: true },
  },
  setup(props) {
    return () => h(PdfDocument, {
      title: 'Nuxt PDF conformance proof',
      language: 'en',
      creationDate: new Date('2026-07-20T00:00:00.000Z'),
    }, {
      default: () => h(PdfPage, {
        size: 'A4',
        wrap: true,
        style: styles.page,
      }, {
        default: () => [
          h(PdfText, {
            fixed: true,
            style: styles.header,
          }, () => 'NUXT PDF / COMPATIBILITY KERNEL'),
          h(PdfText, { style: styles.title }, () => 'Renderer conformance'),
          h(PdfImage, { src: props.imagePath, style: styles.image }),
          ...conformanceParagraphs.map((paragraph, index) => h(
            PdfText,
            {
              key: `paragraph-${index}`,
              style: styles.paragraph,
              orphans: 2,
              widows: 2,
            },
            () => paragraph,
          )),
          h(Section, { title: 'Keyed service rows' }, {
            default: () => [
              ...conformanceLines.map(line => h(
                PdfView,
                { key: line.id, style: styles.row },
                {
                  default: () => [
                    h(PdfText, null, () => line.label),
                    h(PdfText, null, () => line.amount),
                  ],
                },
              )),
              props.showConditional
                ? h(
                    PdfText,
                    { style: styles.conditional },
                    () => 'Conditional approval included',
                  )
                : null,
            ],
          }),
          h(Section, {
            title: 'Explicit second page',
            breakBefore: true,
          }, {
            default: () => [
              h(
                PdfText,
                { style: styles.paragraph },
                () => 'This marker must begin on page two. It proves explicit breaking and fixed-element repetition.',
              ),
              h(
                PdfLink,
                { href: 'https://nuxt.com', style: styles.link },
                { default: () => 'Nuxt documentation' },
              ),
            ],
          }),
          h(PdfText, {
            fixed: true,
            style: styles.footer,
            render: ({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages ?? '?'}`,
          }),
        ],
      }),
    })
  },
})
