<script setup lang="ts">
// The start page with the code beside the hero, as before Ginko 0.16. The layer's start page (DocsLanding) puts the
// hero in one centred column and the free text below the features; here the free text (the template, route and
// preview tabs in content/home.md) sits on the right of the hero. All copy still comes from content/home.md.
const home = useGinko("home");
const data = computed(() => home.value.data);
const { t } = useI18n();
useGinkoSeo(() => ({ title: data.value.title, description: data.value.description }));

const { state, copy } = useDocsCopy();
// Plausible goals (set up in the Plausible site): who copies the install command and opens a showcase PDF.
const copyInstall = async () => {
  await copy(data.value.install ?? "");
  if (state.value === "copied") window.plausible?.("Install command copied");
};
const trackPdf = (id: string) => window.plausible?.("Showcase PDF opened", { props: { document: id } });
// A route link (`$docs.<page>`) goes through the docs router; a URL stays as written.
const { href } = useDocsSite();
const to = (raw: string) => (raw.startsWith("$") ? href(raw) : raw);
const external = (raw: string) => /^https?:\/\//.test(raw);

// Real output: each image is a page of a playground template, rendered by Nuxt PDF. The PDFs and images in
// public/showcase/ are regenerated from playground/pdfs/ when those templates change.
const repository = "https://github.com/lupinum-dev/nuxt-pdf/blob/main/playground/pdfs";
const showcase = [
  { id: "invoice", title: "Invoice", detail: "Typed props, computed totals, page numbers" },
  { id: "annual-report", title: "Annual report", detail: "SVG charts, KPI tiles, a financial table" },
  { id: "ebook", title: "E-book", detail: "Contents with real page numbers, running heads" },
  { id: "certificate", title: "Certificate", detail: "Landscape page, SVG ornaments, a seal" },
];
</script>

<template>
  <div class="docs-landing">
    <div class="docs-landing-inner">
      <section class="pdf-hero">
        <div class="pdf-hero-text">
          <h1>{{ data.title }}</h1>
          <p v-if="data.description" class="pdf-hero-lead">{{ data.description }}</p>
          <div v-if="data.links.length" class="pdf-hero-links">
            <NuxtLink
              v-for="(l, i) in data.links"
              :key="l.href"
              :to="to(l.href)"
              :target="external(l.href) ? '_blank' : undefined"
              class="docs-button is-large"
              :class="i === 0 ? 'is-primary' : 'is-soft'"
            >
              {{ l.label }}<DocsIcon v-if="i === 0" name="lucide:arrow-right" class="docs-icon" />
            </NuxtLink>
          </div>
          <div v-if="data.install" class="docs-install">
            <code tabindex="0" role="region" :aria-label="t('docs.installCommand')">{{ data.install }}</code>
            <button
              type="button"
              class="docs-icon-button"
              :aria-label="state === 'copied' ? t('docs.copied') : state === 'failed' ? t('docs.copyFailed') : t('docs.copyCommand')"
              @click="copyInstall"
            >
              <DocsIcon :name="state === 'copied' ? 'lucide:check' : 'lucide:copy'" class="docs-icon" />
            </button>
          </div>
        </div>
        <GinkoMarkdown v-if="data.body" :value="data.body" class="docs-prose pdf-hero-code" />
      </section>
      <section class="pdf-showcase" aria-labelledby="pdf-showcase-title">
        <h2 id="pdf-showcase-title">Made with Nuxt PDF</h2>
        <p>Each page is a Vue template from the repository, rendered by Nuxt PDF. Open the real PDF or read the source.</p>
        <ul>
          <li v-for="item in showcase" :key="item.id">
            <a :href="`/showcase/${item.id}.pdf`" class="pdf-showcase-page" target="_blank" @click="trackPdf(item.id)">
              <img :src="`/showcase/${item.id}.webp`" :alt="`${item.title} rendered by Nuxt PDF`" loading="lazy" width="707" height="1000">
            </a>
            <h3>{{ item.title }}</h3>
            <p>{{ item.detail }}</p>
            <div class="pdf-showcase-links">
              <a :href="`/showcase/${item.id}.pdf`" target="_blank" @click="trackPdf(item.id)">Open PDF</a>
              <a :href="`${repository}/${item.id}.vue`" target="_blank">Source</a>
            </div>
          </li>
        </ul>
      </section>
      <ul v-if="data.features.length" class="docs-features">
        <li v-for="f in data.features" :key="f.title" class="docs-feature">
          <div v-if="f.icon" class="docs-feature-icon">
            <DocsIcon :name="f.icon" class="docs-icon" />
          </div>
          <h2>
            <NuxtLink v-if="f.href" :to="to(f.href)">{{ f.title }}</NuxtLink>
            <template v-else>{{ f.title }}</template>
          </h2>
          <p>{{ f.description }}</p>
        </li>
      </ul>
    </div>
  </div>
</template>
