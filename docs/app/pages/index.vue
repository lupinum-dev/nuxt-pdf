<script setup lang="ts">
// The start page with the code beside the hero, as before Ginko 0.16. The layer's start page (DocsLanding) puts the
// hero in one centred column and the free text below the features; here the free text (the template, route and
// preview tabs in content/home.md) sits on the right of the hero. All copy still comes from content/home.md.
const home = useGinko("home");
const data = computed(() => home.value.data);
const { t } = useI18n();
useGinkoSeo(() => ({ title: data.value.title, description: data.value.description }));

const { state, copy } = useDocsCopy();
// A route link (`$docs.<page>`) goes through the docs router; a URL stays as written.
const { href } = useDocsSite();
const to = (raw: string) => (raw.startsWith("$") ? href(raw) : raw);
const external = (raw: string) => /^https?:\/\//.test(raw);
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
              @click="copy(data.install ?? '')"
            >
              <DocsIcon :name="state === 'copied' ? 'lucide:check' : 'lucide:copy'" class="docs-icon" />
            </button>
          </div>
        </div>
        <GinkoMarkdown v-if="data.body" :value="data.body" class="docs-prose pdf-hero-code" />
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
