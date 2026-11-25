<script setup lang="ts">
useHead({
  title: 'Nuxt PDF · Template gallery',
  meta: [{
    name: 'description',
    content: 'Ten Vue-authored PDF templates rendered by Nitro — invoice, report, annual report, certificate, e-book, menu, form, article, letter, and research paper.',
  }],
})

const isDevelopment = import.meta.dev

type GalleryDoc = {
  key: string
  genre: string
  name: string
  meta: string
  description: string
  technique: string
  /** Production Nitro route, when the template ships one. */
  api?: string
}

const documents: GalleryDoc[] = [
  {
    key: 'invoice',
    genre: 'Invoice',
    name: 'Fieldnote invoice',
    meta: '2 pages · A4',
    description:
      'Typed line items, computed totals, and a fixed footer — the complete Vue-to-Nitro path.',
    technique: 'Typed props · dynamic page count',
    api: '/api/invoice?inline=1',
  },
  {
    key: 'report',
    genre: 'Report',
    name: 'Alpine Trail Survey',
    meta: 'Multi-page · A4',
    description:
      'A field survey whose contents page prints the resolved page each section lands on.',
    technique: 'PdfPageRef · internal links',
  },
  {
    key: 'annual-report',
    genre: 'Annual report',
    name: 'Fieldnote Studio · FY',
    meta: '5 pages · A4',
    description:
      'Cover, KPI spread, and hand-drawn SVG bar, line, and donut charts over engineered tables.',
    technique: 'SVG charts · Views as tables',
  },
  {
    key: 'certificate',
    genre: 'Certificate',
    name: 'Certificate of completion',
    meta: '1 page · A4 landscape',
    description:
      'A calm certificate on ivory paper: one thin frame, the name in Cormorant, and a seal drawn in SVG.',
    technique: 'SVG seal · serif typography',
  },
  {
    key: 'ebook',
    genre: 'E-book',
    name: 'The Reed Line',
    meta: '18 pages · digest',
    description:
      'A nature novella: page numbers drive a contents page and chapter-aware running matter.',
    technique: 'Chapter-aware running foot',
  },
  {
    key: 'menu',
    genre: 'Menu',
    name: 'Gasthaus Alpenrose',
    meta: '2 pages · A5',
    description:
      'A bilingual alpine dinner card on warm paper: two serifs, diacritics, and a tabular price column.',
    technique: 'Typographic detail · tabular prices',
  },
  {
    key: 'registration',
    genre: 'Form',
    name: 'Workshop registration',
    meta: '1 page · A5',
    description:
      'A form the participant fills in a PDF reader: text fields, a drop-down list, a radio group and checkboxes.',
    technique: 'Form fields · scenarios',
  },
  {
    key: 'article',
    genre: 'Article',
    name: 'Listening to a meadow at dawn',
    meta: '2 pages · A5',
    description:
      'A journal post from editor HTML or Markdown, with a captioned photo, lists, a quote and a callout component.',
    technique: 'PdfRichText · bookmarks',
    api: '/api/article?inline=1',
  },
  {
    key: 'letter',
    genre: 'Letter',
    name: 'Kestrel & Moss',
    meta: '1 page · A4',
    description:
      'A business letter whose address sits in the window of a DL envelope, with fold marks and a signature.',
    technique: 'DIN 5008 form B · absolute boxes',
  },
  {
    key: 'paper',
    genre: 'Research paper',
    name: 'Dawn chorus onset in urban and rural meadows',
    meta: '3 pages · A4',
    description:
      'A journal article in two columns, with a masthead, SVG figures, booktabs tables and a numbered reference list.',
    technique: 'Columns · pages="continuation" · internal links',
  },
]

const routeExample = `import { pdf } from '#pdf'
import { sampleInvoice } from '~/shared/invoice'

export default defineEventHandler(async () => {
  const result = await pdf.invoice.render({ invoice: sampleInvoice })
  return result.response()
})`
</script>

<template>
  <div class="playground-shell">
    <header class="topbar">
      <a
        class="brand"
        href="/"
        aria-label="Nuxt PDF playground home"
      >
        <span
          class="brand-mark"
          aria-hidden="true"
        >
          <span />
          <span />
        </span>
        <span>Nuxt PDF</span>
      </a>

      <div class="release-mark">
        <span
          class="release-dot"
          aria-hidden="true"
        />
        Public beta
      </div>
    </header>

    <main>
      <section
        class="intro"
        aria-labelledby="playground-title"
      >
        <div>
          <p class="eyebrow">
            Template gallery
          </p>
          <h1 id="playground-title">
            Six documents.<br>
            One Vue-to-PDF pipeline.
          </h1>
        </div>

        <div class="intro-copy">
          <p>
            Every template below is an ordinary Vue single-file component,
            discovered by the module and rendered by Nitro through the same
            typed <code>#pdf</code> registry that powers production.
          </p>
          <div
            v-if="isDevelopment"
            class="intro-actions"
          >
            <a
              class="button button-secondary"
              href="/_pdf"
              target="_blank"
              rel="noreferrer"
            >
              Open the dev preview
              <svg
                viewBox="0 0 20 20"
                aria-hidden="true"
              >
                <path d="M7 5h8v8M15 5 6 14" />
              </svg>
            </a>
          </div>
        </div>
      </section>

      <section
        class="gallery"
        aria-label="PDF template gallery"
      >
        <article
          v-for="doc in documents"
          :key="doc.key"
          class="doc-card"
        >
          <header class="doc-card-head">
            <span class="section-label">{{ doc.genre }}</span>
            <span class="doc-meta">{{ doc.meta }}</span>
          </header>

          <h2>{{ doc.name }}</h2>
          <p class="doc-desc">
            {{ doc.description }}
          </p>

          <p class="doc-technique">
            {{ doc.technique }}
          </p>

          <footer class="doc-foot">
            <code>pdfs/{{ doc.key }}.vue</code>
            <span class="doc-links">
              <a
                v-if="doc.api"
                :href="doc.api"
                target="_blank"
                rel="noreferrer"
              >
                Download
                <svg
                  viewBox="0 0 20 20"
                  aria-hidden="true"
                >
                  <path d="M10 3v9m0 0 3.5-3.5M10 12 6.5 8.5M4 16h12" />
                </svg>
              </a>
              <a
                v-if="isDevelopment"
                :href="`/_pdf/${doc.key}`"
                target="_blank"
                rel="noreferrer"
              >
                Preview
                <svg
                  viewBox="0 0 20 20"
                  aria-hidden="true"
                >
                  <path d="M7 5h8v8M15 5 6 14" />
                </svg>
              </a>
              <a
                v-if="isDevelopment"
                :href="`/_pdf/${doc.key}.pdf`"
                target="_blank"
                rel="noreferrer"
              >
                Raw PDF
                <svg
                  viewBox="0 0 20 20"
                  aria-hidden="true"
                >
                  <path d="M7 5h8v8M15 5 6 14" />
                </svg>
              </a>
            </span>
          </footer>
        </article>
      </section>

      <section
        class="implementation"
        aria-labelledby="implementation-title"
      >
        <div class="implementation-copy">
          <p class="eyebrow">
            The ten-minute path
          </p>
          <h2 id="implementation-title">
            Author in Vue.<br>
            Deliver from Nitro.
          </h2>
          <p>
            Nuxt PDF discovers each template, generates the typed <code>#pdf</code>
            registry, and keeps every rendering dependency on the server.
          </p>

          <ol class="flow-list">
            <li>
              <span>01</span>
              <div>
                <strong>Create the template</strong>
                <p>Use ordinary props, loops, conditions, components, and slots.</p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <strong>Preview in development</strong>
                <p>Sample scenarios render through the same registry as production.</p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <strong>Return a Response</strong>
                <p>The generated API carries template names and props end to end.</p>
              </div>
            </li>
          </ol>
        </div>

        <div
          class="code-panel"
          aria-label="Nitro route example"
        >
          <div class="code-toolbar">
            <span>server/api/invoice.get.ts</span>
            <span>TypeScript</span>
          </div>
          <pre><code>{{ routeExample }}</code></pre>
          <div class="code-result">
            <span
              class="release-dot"
              aria-hidden="true"
            />
            <span>application/pdf</span>
            <strong>Typed and server-only</strong>
          </div>
        </div>
      </section>
    </main>

    <footer class="site-footer">
      <span>React PDF-compatible kernel</span>
      <span>Vue-native authoring · Nuxt-native workflow</span>
    </footer>
  </div>
</template>
