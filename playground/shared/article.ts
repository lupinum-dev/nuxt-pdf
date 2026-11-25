// Data model for the "article" showcase: a journal post of the fictional
// Fieldnote Studio, as a headless CMS delivers it. The body is the HTML its
// rich text editor saved, or a rich text model parsed from Markdown on the
// server (`server/api/article.get.ts`); the template prints it with
// <PdfRichText>. Its image path is a file in `pdfs/assets`.

import type { PdfRichBlock } from '@lupinum/nuxt-pdf'

export interface Article {
  title: string
  author: string
  published: string
  /** Editor HTML from the CMS. Set this or `content`. */
  body?: string
  /** The model of a Markdown body (`parseRichTextMarkdown`). Set this or `body`. */
  content?: PdfRichBlock[]
}

export const sampleArticle: Article = {
  title: 'Listening to a meadow at dawn',
  author: 'Juno Merrow',
  published: '2 April 2026',
  body: [
    '<p>Most of our workshop guests arrive with a recorder and leave with a habit: <strong>listening before pressing record</strong>. This post collects what we learned on twelve mornings in the <em>Wiesengrund</em> meadow.</p>',
    '<figure><img src="alpine.png" alt="A snow-covered mountain above a dark pine forest"><figcaption>The view from the upper end of the meadow. Snow stays on the peak until June.</figcaption></figure>',
    '<h2>Before you leave the house</h2>',
    '<p>Pack light. A meadow at dawn is wet, cold and quiet, and every extra bag makes noise when you move.</p>',
    '<ol><li>Charge the recorder and carry one spare set of batteries.</li><li>Format the card at home, not in the field.</li><li>Pack a foam windscreen <em>and</em> a fur cover; the wind rises after sunrise.</li><li>Write the date and place on a strip of tape on the recorder.</li></ol>',
    '<h2>Finding a spot</h2>',
    '<p>Walk the meadow once without recording. Note where the sound changes: near the hedge, the brook, the old pear tree. Then choose one place and stay there for at least <strong>twenty minutes</strong>.</p>',
    '<ul><li>Keep the road behind a hill or a hedge.<ul><li>A hedge cuts traffic noise more than distance does.</li><li>Morning traffic starts around six.</li></ul></li><li>Face away from the brook if you want birds, toward it if you want water.</li></ul>',
    '<blockquote><p>The first ten minutes are for the meadow to forget you. The recording starts after that.</p></blockquote>',
    '<h2>Settings we use</h2>',
    '<p>We record at 48 kHz and 24 bit, with the low-cut filter off. A typical file name looks like this:</p>',
    '<pre>2026-04-02_wiesengrund_hedge\n  take-01.wav\n  take-02.wav</pre>',
    '<p>Set the level so that the loudest bird peaks near <code>-12 dB</code>. You can raise quiet passages later; you cannot repair clipping.</p>',
    '<hr>',
    '<h3>Share what you hear</h3>',
    '<p>Send us a two-minute excerpt and the place you recorded it. We play a selection at the next open evening; details are on <a href="https://fieldnote.example/evenings">our events page</a>.</p>',
  ].join(''),
}

/** A second post, written in Markdown with a comark component, for `parseRichTextMarkdown`. */
export const markdownArticle = {
  title: 'Recording rain on a tin roof',
  author: 'Juno Merrow',
  published: '9 April 2026',
  markdown: [
    'Rain is the most requested sound in our library, and the hardest to record well.',
    '',
    '## Where to stand',
    '',
    'Pick a roof you can sit under, out of the wind. Corrugated tin rings; flat sheet hisses.',
    '',
    '::callout{tone="tip"}',
    'Put the recorder on a folded towel. It stops the **drum** of the shelf below.',
    '::',
    '',
    '1. Record two minutes of the roof before the rain.',
    '2. Keep the level low: heavy rain is louder than it sounds.',
    '3. Stop when the gutters start to overflow.',
    '',
    '::callout{tone="warning"}',
    'Never leave a recorder outside in a thunderstorm.',
    '::',
    '',
    '> The best rain recordings have a listener in them: a door, a drip, a roof.',
    '',
    'More notes are on [our journal page](https://fieldnote.example/journal).',
  ].join('\n'),
}
