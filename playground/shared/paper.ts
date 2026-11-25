// Sample data for the research paper template. The study, the journal, the
// authors, the institutions and the references are invented.

/** A run of text inside a paragraph. A plain string is ordinary text. */
export type PaperInline
  = | string
  /** Italics: species names and statistical symbols such as p, r and R. */
    | { em: string }
    | { sub: string }
    | { sup: string }
  /** Numbered citations, printed as "[1, 3]" and linked to the reference list. */
    | { cite: number[] }
  /** A figure or the table, printed as its label and linked to it. */
    | { ref: PaperTarget, label: string }

export type PaperTarget = 'fig-1' | 'fig-2' | 'table-1' | 'table-2'

export type PaperBlock
  = | { kind: 'p', parts: PaperInline[] }
    | { kind: 'h3', title: string }
  /** A figure or a table floats to the top or the bottom of its column. */
    | { kind: 'figure', figure: 'bars' | 'scatter', float: PaperFloat }
    | { kind: 'table', table: PaperTable, float: PaperFloat }

export type PaperFloat = 'top' | 'bottom'

export type PaperSection = {
  id: string
  number: number
  title: string
  blocks: PaperBlock[]
}

/** A short item after the discussion, such as the funding or the data. */
export type PaperBackMatter = {
  id: string
  title: string
  text: string
}

/** One entry of the reference list: an article, or a book with a publisher. */
export type PaperReference = {
  authors: string
  year: number
  title: string
  journal?: string
  volume?: number
  pages?: [number, number]
  publisher?: string
}

/** Mean onset before sunrise in minutes, with its standard error, per species. */
export type PaperSpecies = {
  name: string
  urban: number
  urbanError: number
  rural: number
  ruralError: number
}

/** One meadow: artificial light at night and the mean chorus onset. */
export type PaperSite = {
  type: 'urban' | 'rural'
  lux: number
  onset: number
}

/** A table with a numbered caption above it and a note below it. */
export type PaperTable = {
  id: PaperTarget
  label: string
  caption: string
  /** The column heads. The first column holds the row labels. */
  head: PaperInline[][]
  rows: PaperTableRow[]
  note: string
}

export type PaperTableRow = {
  label: string
  /** The unit after the label, in the muted colour. */
  unit?: string
  values: string[]
}

export type Paper = {
  journal: string
  volume: number
  year: number
  /** The article number, which stands in for page numbers in a citation. */
  article: string
  kind: string
  /** The short title of the running head. */
  shortTitle: string
  title: string
  authors: { name: string, affiliations: number[] }[]
  affiliations: string[]
  correspondence: string
  /** Received, accepted and published, in this order. */
  history: { label: string, date: string }[]
  licence: string
  abstract: PaperInline[]
  keywords: string[]
  sections: PaperSection[]
  backMatter: PaperBackMatter[]
  species: PaperSpecies[]
  sites: PaperSite[]
  references: PaperReference[]
}

export const samplePaper: Paper = {
  journal: 'Fieldnote Ecology Reports',
  volume: 4,
  year: 2026,
  article: 'e2026.014',
  kind: 'Research article',
  shortTitle: 'Dawn chorus onset in urban and rural meadows',
  title: 'Dawn chorus onset in urban and rural meadows: artificial light advances the first song',
  authors: [
    { name: 'Ada Lindqvist', affiliations: [1] },
    { name: 'Tomas Reyes', affiliations: [2] },
    { name: 'Mira Okafor', affiliations: [1, 2] },
  ],
  affiliations: [
    'Fieldnote Institute of Ecology, Riverside Campus',
    'Department of Soundscape Studies, Northvale University',
  ],
  correspondence: 'Ada Lindqvist, a.lindqvist@fieldnote.example',
  history: [
    { label: 'Received', date: '12 February 2026' },
    { label: 'Accepted', date: '30 May 2026' },
    { label: 'Published', date: '18 June 2026' },
  ],
  licence: '© 2026 The authors. Published under CC BY 4.0.',
  abstract: [
    'Songbirds in cities often start to sing earlier than their rural neighbours, but light and noise rise together in cities, so their effects are hard to separate. We recorded the dawn chorus on 168 mornings at twelve meadows, six in a city and six in the surrounding farmland, and measured artificial light at night and background noise at each site. The chorus started on average 47.5 minutes before sunrise at urban meadows and 27.5 minutes before sunrise at rural meadows. All four focal species sang earlier in the city. Across sites, onset advanced by 1.7 minutes per lux of light at night (',
    { em: 'R' },
    { sup: '2' },
    '\u00A0=\u00A00.82, ',
    { em: 'p' },
    '\u00A0<\u00A00.001), while noise added no further explanation once light was in the model. Darker meadow edges could give urban birds back part of their night.',
  ],
  keywords: ['dawn chorus', 'light pollution', 'urban ecology', 'passive acoustic monitoring', 'songbirds'],
  sections: [
    {
      id: 'introduction',
      number: 1,
      title: 'Introduction',
      blocks: [
        {
          kind: 'p',
          parts: [
            'The dawn chorus is one of the most regular events in a temperate meadow. Each species begins at its own light level, so the order of first songs is almost as fixed as a timetable ',
            { cite: [1, 2] },
            '. Several studies have found that birds in cities break this timetable and sing earlier, sometimes in full darkness ',
            { cite: [3] },
            '.',
          ],
        },
        {
          kind: 'p',
          parts: [
            'Two features of cities could cause the shift. Street lights extend the perceived day, and traffic noise masks songs later in the morning, which may push birds to sing before the roads fill ',
            { cite: [4, 5] },
            '. Because light and noise rise together towards a city centre, most earlier work could not tell them apart. Here we use twelve meadows where the two vary partly independently, and ask which of them predicts the onset of song.',
          ],
        },
        {
          kind: 'p',
          parts: [
            'We tested two expectations. If light sets the start, onset should follow light at night across sites, and the earliest species should move most, because they start at the lowest natural light level ',
            { cite: [9] },
            '. If noise sets the start, onset should follow background noise, and all species should move by a similar amount, because they all compete with the same traffic.',
          ],
        },
      ],
    },
    {
      id: 'methods',
      number: 2,
      title: 'Methods',
      blocks: [
        { kind: 'h3', title: '2.1 Study sites' },
        {
          kind: 'p',
          parts: [
            'We selected six meadows inside the city and six in farmland 15–30\u00A0km away, each at least 1\u00A0ha of unmown grassland with a hedge or woodland edge (',
            { ref: 'table-1', label: 'Table 1' },
            '). The city is lit by LED street lamps of 3,000\u00A0K, the type now replacing sodium lamps in most of the region. Light at night was measured at ground level with a calibrated lux meter, facing up, on three moonless nights per site; we use the median of five readings taken between 23:00 and 01:00.',
          ],
        },
        {
          kind: 'table',
          float: 'top',
          table: {
            id: 'table-1',
            label: 'Table 1',
            caption: 'Site characteristics of the urban and rural meadows.',
            head: [['Variable'], ['Urban'], ['Rural']],
            rows: [
              { label: 'Meadow area', unit: 'ha', values: ['1.8 ± 0.4', '3.2 ± 0.6'] },
              { label: 'Light at night', unit: 'lux', values: ['11.1 ± 2.1', '0.9 ± 0.2'] },
              { label: 'Background noise', unit: 'dB(A)', values: ['52.4 ± 1.8', '36.1 ± 1.2'] },
              { label: 'Mornings recorded', values: ['84', '84'] },
              { label: 'Onset before sunrise', unit: 'min', values: ['47.5 ± 2.8', '27.5 ± 2.3'] },
            ],
            note: 'Means ± standard error over the six meadows of each type. Mornings are counted after the exclusions for rain and wind.',
          },
        },
        { kind: 'h3', title: '2.2 Recordings' },
        {
          kind: 'p',
          parts: [
            'An autonomous recorder at each meadow edge recorded from 03:00 to 07:00 at 48\u00A0kHz on every third morning between 1 April and 14 May, 15 mornings per site and 90 per site type. Six mornings per site type with rain or wind above 5\u00A0m\u00A0s',
            { sup: '−1' },
            ' were excluded, which left 84 per site type and 168 in all. Recorders hung 1.5\u00A0m above the ground and faced the meadow; all twelve were calibrated against one reference tone before and after the season. Background noise was measured as the A-weighted level in dB(A) between 06:00 and 07:00, the hour in which traffic rises fastest.',
          ],
        },
        { kind: 'h3', title: '2.3 Song detection' },
        {
          kind: 'p',
          parts: [
            'Songs of the four focal species, robin, blackbird, great tit and wren, were detected with a classifier trained on recordings from other meadows in the region ',
            { cite: [10] },
            '. A listener checked every detection in the first 30 minutes of the chorus and a random tenth of the rest, and removed false detections, mostly wren calls taken for song. Precision in the checked sample was 0.94 and did not differ between urban and rural sites.',
          ],
        },
        { kind: 'h3', title: '2.4 Analysis' },
        {
          kind: 'p',
          parts: [
            'Onset was defined as the first minute with at least three song events of a species. We modelled onset relative to civil sunrise with linear mixed models that had site as a random effect, and compared models with light, noise, both or neither using AIC ',
            { cite: [6] },
            ' and Akaike weights. Light and noise were standardised before fitting, so their coefficients can be compared, and their correlation across sites (',
            { em: 'r' },
            '\u00A0=\u00A00.58, ',
            { em: 'n' },
            '\u00A0=\u00A012) was low enough to fit both in one model. Cloud cover came from the hourly observations of the nearest weather station, 4–22\u00A0km from the sites. Values are given as means with standard errors.',
          ],
        },
      ],
    },
    {
      id: 'results',
      number: 3,
      title: 'Results',
      blocks: [
        {
          kind: 'p',
          parts: [
            'The chorus started 20 minutes earlier at urban meadows than at rural ones. All four focal species sang earlier in the city, and the robin (',
            { em: 'Erithacus rubecula' },
            '), the earliest singer, moved most (',
            { ref: 'fig-1', label: 'Fig. 1' },
            '). The shift shrank from the robin (23 minutes) through the blackbird (22) and the great tit (19) to the wren (16), the latest of the four. The order of species stayed the same in both settings.',
          ],
        },
        { kind: 'figure', figure: 'bars', float: 'top' },
        {
          kind: 'p',
          parts: [
            'Across the twelve sites, onset advanced by 1.7 minutes for each lux of light at night (',
            { em: 'R' },
            { sup: '2' },
            '\u00A0=\u00A00.82, ',
            { em: 'p' },
            '\u00A0<\u00A00.001; ',
            { ref: 'fig-2', label: 'Fig. 2' },
            '). The model with light alone had the lowest AIC and most of the weight (',
            { ref: 'table-2', label: 'Table 2' },
            '); adding noise did not improve it (ΔAIC\u00A0=\u00A01.6), and noise alone explained far less of the variation (',
            { em: 'R' },
            { sup: '2' },
            '\u00A0=\u00A00.41).',
          ],
        },
        { kind: 'figure', figure: 'scatter', float: 'top' },
        {
          kind: 'table',
          float: 'bottom',
          table: {
            id: 'table-2',
            label: 'Table 2',
            caption: 'Models of chorus onset across the twelve meadows, ranked by AIC.',
            head: [['Predictors'], ['ΔAIC'], [{ em: 'R' }, { sup: '2' }], ['Weight']],
            rows: [
              { label: 'Light', values: ['0.0', '0.82', '0.69'] },
              { label: 'Light + noise', values: ['1.6', '0.83', '0.31'] },
              { label: 'Noise', values: ['14.9', '0.41', '< 0.01'] },
              { label: 'None', values: ['22.7', '0.00', '< 0.01'] },
            ],
            note: 'Linear mixed models with site as a random effect; ΔAIC is the difference to the best model.',
          },
        },
        {
          kind: 'p',
          parts: [
            'The two rural meadows nearest a village had the highest rural light levels and the earliest rural onsets, which fits the same relation at the low end of the light range. Within sites, onset varied little from morning to morning: its standard deviation was 4.1 minutes at urban and 3.8 minutes at rural meadows, so the difference between the site types was about five times the daily scatter.',
          ],
        },
        {
          kind: 'p',
          parts: [
            'Cloud cover changed the urban advance from morning to morning. Under full cloud, urban onset came on average 6 minutes earlier than on clear mornings, while rural onset did not change. Clouds reflect city light back to the ground as sky glow, so overcast urban nights are brighter, not darker ',
            { cite: [11] },
            '.',
          ],
        },
      ],
    },
    {
      id: 'discussion',
      number: 4,
      title: 'Discussion',
      blocks: [
        {
          kind: 'p',
          parts: [
            'Light at night, not noise, best predicted when the dawn chorus began. The size of the effect is large for a behaviour that is otherwise so regular: at the brightest meadow, birds started singing more than half an hour before their rural counterparts. This agrees with experiments in which single lamps advanced song in forest birds ',
            { cite: [3, 7] },
            '.',
          ],
        },
        {
          kind: 'p',
          parts: [
            'Singing earlier has costs. Song in darkness takes time from feeding, and early singers may carry less energy into the day ',
            { cite: [8] },
            '. Urban noise may still matter for how songs sound, through higher pitch or longer notes ',
            { cite: [5] },
            ', even if it does not set the start.',
          ],
        },
        {
          kind: 'p',
          parts: [
            'Why noise added so little is worth a closer look. At our urban meadows traffic rose mainly after 06:00, when most species had already sung for an hour. Noise may set the start where roads fill before dawn, near motorways or airports, and a design that crosses light and noise at such sites would test this directly.',
          ],
        },
        {
          kind: 'p',
          parts: [
            'The pattern across species points to a mechanism. Each species begins to sing at a light level of its own, and artificial light lifts the whole morning above those levels earlier. A species that starts in deep twilight, like the robin, crosses its threshold first and so gains most. Hormonal studies suggest that light at night lowers melatonin and shortens the night of birds in the same way ',
            { cite: [12] },
            '.',
          ],
        },
        {
          kind: 'p',
          parts: [
            'Our design has limits: twelve sites in one region, one spring, and light measured on a few nights. Still, the result points to a practical step. Shielded or dimmed lamps along meadow edges cost little and could give urban birds back part of their night, a measure that also cuts the CO',
            { sub: '2' },
            ' footprint of street lighting.',
          ],
        },
      ],
    },
  ],
  backMatter: [
    { id: 'acknowledgements', title: 'Acknowledgements', text: 'We thank the owners of the twelve meadows for access at unsocial hours, and the volunteers who checked detections by ear.' },
    { id: 'contributions', title: 'Author contributions', text: 'A.L. and M.O. designed the study. T.R. built the recorders and trained the classifier. A.L. analysed the data and wrote the first draft. All authors revised and approved the final text.' },
    { id: 'funding', title: 'Funding', text: 'Fieldnote Institute small grants programme, grant SG-25-07.' },
    { id: 'interests', title: 'Competing interests', text: 'None declared.' },
    { id: 'data', title: 'Data availability', text: 'Onset times, light and noise readings and the analysis code are available from the corresponding author on request.' },
  ],
  species: [
    { name: 'Robin', urban: 59, urbanError: 3.1, rural: 36, ruralError: 2.6 },
    { name: 'Blackbird', urban: 52, urbanError: 2.8, rural: 30, ruralError: 2.4 },
    { name: 'Great tit', urban: 43, urbanError: 2.5, rural: 24, ruralError: 2.1 },
    { name: 'Wren', urban: 36, urbanError: 2.9, rural: 20, ruralError: 2.2 },
  ],
  sites: [
    { type: 'rural', lux: 0.2, onset: 25 },
    { type: 'rural', lux: 0.4, onset: 31 },
    { type: 'rural', lux: 0.6, onset: 20 },
    { type: 'rural', lux: 0.9, onset: 32 },
    { type: 'rural', lux: 1.3, onset: 23 },
    { type: 'rural', lux: 1.8, onset: 34 },
    { type: 'urban', lux: 4.6, onset: 42 },
    { type: 'urban', lux: 6.9, onset: 39 },
    { type: 'urban', lux: 9.4, onset: 49 },
    { type: 'urban', lux: 12.2, onset: 45 },
    { type: 'urban', lux: 15.1, onset: 57 },
    { type: 'urban', lux: 18.6, onset: 53 },
  ],
  references: [
    { authors: 'Hartley, J. & Moreau, S.', year: 2019, title: 'Light thresholds and the order of the dawn chorus', journal: 'Journal of Avian Timing', volume: 11, pages: [201, 214] },
    { authors: 'Okonkwo, P., Sand, L. & Viret, A.', year: 2020, title: 'A timetable of first songs in temperate grassland birds', journal: 'Meadow Bird Studies', volume: 7, pages: [45, 58] },
    { authors: 'Brandt, E.', year: 2021, title: 'Songbirds sing earlier in cities: a review of twenty years of recordings', journal: 'Urban Fauna Review', volume: 3, pages: [1, 19] },
    { authors: 'Castell, R. & Ng, W.', year: 2018, title: 'Street lights and the perceived day length of small passerines', journal: 'Nocturnal Ecology', volume: 5, pages: [88, 97] },
    { authors: 'Feld, M., Ortiz, C. & Haan, J.', year: 2022, title: 'Traffic noise shapes when and how urban birds sing', journal: 'Soundscape Letters', volume: 9, pages: [310, 322] },
    { authors: 'Ivers, T.', year: 2017, title: 'Model selection for field ecologists', publisher: 'Riverside Academic Press' },
    { authors: 'Sato, K. & Lindgren, B.', year: 2023, title: 'A single lamp advances song onset in forest birds: a field experiment', journal: 'Journal of Avian Timing', volume: 15, pages: [77, 90] },
    { authors: 'Duarte, H.', year: 2024, title: 'The energetic cost of singing in darkness', journal: 'Behavioural Energetics', volume: 12, pages: [133, 145] },
    { authors: 'Mbeki, L. & Strand, O.', year: 2016, title: 'Song onset and light sensitivity in four European songbirds', journal: 'Meadow Bird Studies', volume: 3, pages: [12, 24] },
    { authors: 'Quint, A., Ferreira, D. & Holm, K.', year: 2025, title: 'An open classifier for songbird detection in long field recordings', journal: 'Acoustic Methods in Ecology', volume: 2, pages: [55, 71] },
    { authors: 'Valli, S.', year: 2020, title: 'Sky glow under clouds: how overcast nights brighten cities', journal: 'Nocturnal Ecology', volume: 7, pages: [140, 151] },
    { authors: 'Rowe, P. & Iqbal, N.', year: 2022, title: 'Light at night, melatonin and the timing of activity in wild birds', journal: 'Behavioural Energetics', volume: 10, pages: [201, 216] },
  ],
}
