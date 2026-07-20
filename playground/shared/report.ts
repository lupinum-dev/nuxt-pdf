export interface ReportSubsection {
  id: string
  title: string
  paragraphs: string[]
}

export interface ReportSection {
  id: string
  title: string
  lede: string
  subsections: ReportSubsection[]
}

export interface Report {
  eyebrow: string
  title: string
  author: string
  period: string
  sections: ReportSection[]
}

const lorem = (topic: string, count: number): string[] =>
  Array.from({ length: count }, (_, index) =>
    `${topic} — paragraph ${index + 1}. Each layout pass feeds the resolved page `
    + `numbers back into the template, so the table of contents settles on the `
    + `page where this section actually begins rather than where it was guessed.`)

export const sampleReport: Report = {
  eyebrow: 'FIELD REPORT',
  title: 'Alpine Trail Survey 2026',
  author: 'Fieldnote Studio',
  period: 'Season report · Q2 2026',
  sections: [
    {
      id: 'summary',
      title: 'Executive summary',
      lede: 'What the season produced and where the numbers landed.',
      subsections: [
        { id: 'summary-findings', title: 'Key findings', paragraphs: lorem('Findings', 3) },
        { id: 'summary-outlook', title: 'Outlook', paragraphs: lorem('Outlook', 2) },
      ],
    },
    {
      id: 'method',
      title: 'Method',
      lede: 'How the survey was run, and why the sampling spans several pages.',
      subsections: [
        { id: 'method-sampling', title: 'Sampling', paragraphs: lorem('Sampling', 10) },
        { id: 'method-instruments', title: 'Instruments', paragraphs: lorem('Instruments', 9) },
      ],
    },
    {
      id: 'results',
      title: 'Results',
      lede: 'The measured outcomes across the surveyed trails.',
      subsections: [
        { id: 'results-counts', title: 'Counts', paragraphs: lorem('Counts', 4) },
        { id: 'results-trends', title: 'Trends', paragraphs: lorem('Trends', 3) },
      ],
    },
    {
      id: 'appendix',
      title: 'Appendix',
      lede: 'Reference material and definitions.',
      subsections: [
        { id: 'appendix-glossary', title: 'Glossary', paragraphs: lorem('Glossary', 2) },
      ],
    },
  ],
}
