import React, { type PropsWithChildren } from 'react'
import {
  Document,
  Image,
  Link,
  Page,
  Text,
  View,
} from '@react-pdf/renderer'
import {
  conformanceLines,
  conformanceParagraphs,
  conformanceStyles as styles,
} from './conformance-data'

interface ConformanceOptions {
  imagePath: string
  showConditional?: boolean
}

interface SectionProps extends PropsWithChildren {
  title: string
  breakBefore?: boolean
}

const h = React.createElement

const Section = ({ title, breakBefore, children }: SectionProps) => h(
  View,
  { style: styles.section, break: breakBefore },
  h(Text, { style: styles.sectionTitle }, title),
  children,
)

export const createReactConformanceDocument = ({
  imagePath,
  showConditional = true,
}: ConformanceOptions) => h(
  Document,
  {
    title: 'Nuxt PDF conformance proof',
    language: 'en',
    creationDate: new Date('2026-07-20T00:00:00.000Z'),
  },
  h(
    Page,
    { size: 'A4', wrap: true, style: styles.page },
    h(Text, { fixed: true, style: styles.header }, 'NUXT PDF / COMPATIBILITY KERNEL'),
    h(Text, { style: styles.title }, 'Renderer conformance'),
    h(Image, { src: imagePath, style: styles.image }),
    ...conformanceParagraphs.map((paragraph, index) => h(
      Text,
      {
        key: `paragraph-${index}`,
        style: styles.paragraph,
        orphans: 2,
        widows: 2,
      },
      paragraph,
    )),
    h(
      Section,
      { title: 'Keyed service rows' },
      ...conformanceLines.map(line => h(
        View,
        { key: line.id, style: styles.row },
        h(Text, null, line.label),
        h(Text, null, line.amount),
      )),
      showConditional
        ? h(Text, { style: styles.conditional }, 'Conditional approval included')
        : null,
    ),
    h(
      Section,
      { title: 'Explicit second page', breakBefore: true },
      h(
        Text,
        { style: styles.paragraph },
        'This marker must begin on page two. It proves explicit breaking and fixed-element repetition.',
      ),
      h(
        Link,
        { src: 'https://nuxt.com', style: styles.link },
        'Nuxt documentation',
      ),
    ),
    h(Text, {
      fixed: true,
      style: styles.footer,
      render: ({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages ?? '?'}`,
    }),
  ),
)
