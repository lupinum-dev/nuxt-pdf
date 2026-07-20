<script setup lang="ts">
import {
  formatInvoiceMoney,
  invoiceTotal,
  sampleInvoice,
} from './shared/invoice'

useHead({
  title: 'Nuxt PDF · Invoice playground',
  meta: [{
    name: 'description',
    content: 'A complete Nuxt PDF invoice example, from Vue template to Nitro response.',
  }],
})

const isDevelopment = import.meta.dev
const total = formatInvoiceMoney(
  invoiceTotal(sampleInvoice),
  sampleInvoice.currency,
)

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
        External alpha · 0.2.0
      </div>
    </header>

    <main>
      <section
        class="intro"
        aria-labelledby="playground-title"
      >
        <div>
          <p class="eyebrow">
            Invoice playground
          </p>
          <h1 id="playground-title">
            One document.<br>
            The complete Nuxt path.
          </h1>
        </div>

        <div class="intro-copy">
          <p>
            A real Vue-authored invoice rendered by Nitro. The same typed
            registry powers the development preview and the production response.
          </p>
          <div class="intro-actions">
            <a
              class="button button-primary"
              href="/api/invoice"
            >
              Download invoice
              <svg
                viewBox="0 0 20 20"
                aria-hidden="true"
              >
                <path d="M10 3v9m0 0 3.5-3.5M10 12 6.5 8.5M4 16h12" />
              </svg>
            </a>
            <a
              v-if="isDevelopment"
              class="button button-secondary"
              href="/_pdf/invoice"
              target="_blank"
              rel="noreferrer"
            >
              Development preview
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
        class="workspace"
        aria-label="Invoice preview workspace"
      >
        <aside class="invoice-rail">
          <div class="rail-heading">
            <p class="section-label">
              Live fixture
            </p>
            <span class="status-badge">Ready</span>
          </div>

          <div class="invoice-identity">
            <span>{{ sampleInvoice.number }}</span>
            <strong>{{ total }}</strong>
            <p>{{ sampleInvoice.customer.name }}</p>
          </div>

          <dl class="invoice-facts">
            <div>
              <dt>Issued</dt>
              <dd>{{ sampleInvoice.issueDate }}</dd>
            </div>
            <div>
              <dt>Due</dt>
              <dd>{{ sampleInvoice.dueDate }}</dd>
            </div>
            <div>
              <dt>Line items</dt>
              <dd>{{ sampleInvoice.lines.length }}</dd>
            </div>
            <div>
              <dt>Pages</dt>
              <dd>2</dd>
            </div>
          </dl>

          <div
            class="capability-list"
            aria-label="Fixture capabilities"
          >
            <span>Typed Vue props</span>
            <span>Local font + image</span>
            <span>Fixed page footer</span>
            <span>Dynamic page count</span>
          </div>

          <p class="rail-note">
            Source: <code>pdfs/invoice.vue</code>
          </p>
        </aside>

        <div class="document-stage">
          <header class="stage-toolbar">
            <div>
              <span class="stage-title">invoice-{{ sampleInvoice.number.toLowerCase() }}.pdf</span>
              <span class="stage-meta">Generated on request</span>
            </div>
            <a
              href="/api/invoice?inline=1"
              target="_blank"
              rel="noreferrer"
            >
              Open full size
              <svg
                viewBox="0 0 20 20"
                aria-hidden="true"
              >
                <path d="M7 5h8v8M15 5 6 14" />
              </svg>
            </a>
          </header>
          <div class="document-frame">
            <div class="mobile-pdf-fallback">
              <span>Two-page PDF</span>
              <strong>Open the document in a full browser tab.</strong>
              <p>The embedded viewer is replaced on small screens for a more reliable reading experience.</p>
              <a
                class="button button-primary"
                href="/api/invoice?inline=1"
                target="_blank"
                rel="noreferrer"
              >
                Open invoice
                <svg
                  viewBox="0 0 20 20"
                  aria-hidden="true"
                >
                  <path d="M7 5h8v8M15 5 6 14" />
                </svg>
              </a>
            </div>
            <iframe
              src="/api/invoice?inline=1"
              title="Rendered two-page invoice PDF"
            />
          </div>
        </div>
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
            Nuxt PDF discovers the template, generates the typed <code>#pdf</code>
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
