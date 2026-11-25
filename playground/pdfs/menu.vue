<script setup lang="ts">
import type { Menu, MenuCourse } from '../shared/menu'
import { formatMenuPrice, formatWinePrice, sampleMenu, winterMenu } from '../shared/menu'
import { menuTheme } from './components/theme'

defineOptions({ name: 'AlpenroseMenuPdf' })

type MenuProps = { menu: Menu }

const props = defineProps<MenuProps>()
const menu = props.menu

const bookmarkTitles: Record<MenuCourse['id'] | 'wines', string> = {
  starters: 'Starters',
  mains: 'Mains',
  desserts: 'Desserts',
  wines: 'Wine',
}

definePdf<MenuProps>({
  title: ({ menu }) => `${menu.name} — Speisekarte`,
  filename: ({ menu }) => `${menu.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-menu.pdf`,
  language: 'de-AT',
  sampleData: { menu: sampleMenu },
  scenarios: {
    winter: { menu: winterMenu },
  },
})
</script>

<template>
  <PdfDocument
    :author="menu.name"
    creator="Nuxt PDF"
    subject="Dinner menu"
  >
    <!-- Page 1: masthead, starters, mains -->
    <PdfPage
      size="A5"
      class="page"
    >
      <PdfView class="masthead">
        <PdfText class="menu-name">
          {{ menu.name }}
        </PdfText>
        <PdfText class="ethos">
          {{ menu.ethos }}
        </PdfText>
        <PdfView class="masthead-rule" />
        <PdfText class="established">
          {{ menu.established }}
        </PdfText>
      </PdfView>

      <PdfView
        v-for="course in [menu.starters, menu.mains]"
        :id="course.id"
        :key="course.id"
        :bookmark="{ title: bookmarkTitles[course.id], expanded: false }"
        :class="{ 'course-following': course.id === menu.mains.id }"
      >
        <PdfView class="course-head">
          <PdfText class="course-label">
            {{ course.label }}
          </PdfText>
          <PdfView class="course-rule" />
        </PdfView>

        <PdfView
          v-for="dish in course.dishes"
          :key="dish.name"
          class="dish"
          :wrap="false"
        >
          <PdfView class="dish-row">
            <PdfText class="dish-name">
              {{ dish.name }}
            </PdfText>
            <PdfText class="price">
              {{ formatMenuPrice(dish.price) }}
            </PdfText>
          </PdfView>
          <PdfText class="dish-description">
            {{ dish.description }}
          </PdfText>
        </PdfView>
      </PdfView>

      <PdfText
        fixed
        class="footer"
      >
        {{ menu.name }}
      </PdfText>
    </PdfPage>

    <!-- Page 2: desserts, wine list -->
    <PdfPage
      size="A5"
      class="page"
    >
      <PdfView
        :id="menu.desserts.id"
        :bookmark="{ title: bookmarkTitles.desserts, expanded: false }"
      >
        <PdfView class="course-head">
          <PdfText class="course-label">
            {{ menu.desserts.label }}
          </PdfText>
          <PdfView class="course-rule" />
        </PdfView>

        <PdfView
          v-for="dish in menu.desserts.dishes"
          :key="dish.name"
          class="dish"
          :wrap="false"
        >
          <PdfView class="dish-row">
            <PdfText class="dish-name">
              {{ dish.name }}
            </PdfText>
            <PdfText class="price">
              {{ formatMenuPrice(dish.price) }}
            </PdfText>
          </PdfView>
          <PdfText class="dish-description">
            {{ dish.description }}
          </PdfText>
        </PdfView>
      </PdfView>

      <PdfView
        :id="menu.wines.id"
        :bookmark="{ title: bookmarkTitles.wines, expanded: false }"
        class="wines"
      >
        <PdfView class="course-head">
          <PdfText class="course-label">
            {{ menu.wines.label }}
          </PdfText>
          <PdfView class="course-rule" />
        </PdfView>

        <PdfView class="wine-head">
          <PdfText class="wine-head-label">
            Offene Weine
          </PdfText>
          <PdfText
            class="column-head"
            :style="{ hyphens: 'manual' }"
          >
            Glas
          </PdfText>
          <PdfText
            class="column-head bottle-column"
            :style="{ hyphens: 'manual' }"
          >
            Flasche
          </PdfText>
        </PdfView>

        <PdfView
          v-for="wine in menu.wines.entries"
          :key="wine.name"
          class="wine"
          :wrap="false"
        >
          <PdfView class="wine-info">
            <PdfText class="wine-name">
              {{ wine.name }}
            </PdfText>
            <PdfText class="wine-origin">
              {{ wine.region }} · {{ wine.year }}
            </PdfText>
          </PdfView>
          <PdfText class="price">
            {{ formatMenuPrice(wine.glass) }}
          </PdfText>
          <PdfText class="price bottle-column">
            {{ formatWinePrice(wine.bottle) }}
          </PdfText>
        </PdfView>
      </PdfView>

      <PdfText
        fixed
        class="price-note"
      >
        {{ menu.priceNote }}
      </PdfText>

      <PdfText
        fixed
        class="footer"
      >
        {{ menu.name }}
      </PdfText>
    </PdfPage>
  </PdfDocument>
</template>

<style>
/* The menu's own look (menuTheme in components/theme.ts): warm paper, a
   display serif for the name and the courses, a reading serif for the dishes,
   one deep green and fine hairlines. */
:root {
  --paper: v-bind('menuTheme.paper');
  --ink: v-bind('menuTheme.ink');
  --muted: v-bind('menuTheme.muted');
  --hairline: v-bind('menuTheme.hairline');
  --accent: v-bind('menuTheme.accent');
  --display: v-bind('menuTheme.display');
  --reading: v-bind('menuTheme.reading');
  --page-margin: 52pt;
}
.page {
  hyphens: auto;
  padding: 42pt var(--page-margin) 56pt;
  font-family: var(--reading);
  color: var(--ink);
  background-color: var(--paper);
}

.masthead {
  align-items: center;
  margin-bottom: 20pt;
}

.menu-name {
  font-family: var(--display);
  font-size: 30pt;
  font-weight: 500;
  line-height: 1.05;
  text-align: center;
}

.ethos {
  margin-top: 8pt;
  max-width: 270pt;
  font-size: 8.5pt;
  font-style: italic;
  line-height: 1.5;
  text-align: center;
  color: var(--muted);
}

.masthead-rule {
  width: 28pt;
  margin-top: 12pt;
  border-bottom: 0.75pt solid var(--accent);
}

.established {
  margin-top: 10pt;
  font-size: 7.5pt;
  text-align: center;
  color: var(--muted);
}

.course-following {
  margin-top: 12pt;
}

/* Course head: the title in the display italic and a hairline to the edge. */
.course-head {
  flex-direction: row;
  align-items: center;
  margin-bottom: 12pt;
}

.course-label {
  font-family: var(--display);
  font-size: 17pt;
  font-style: italic;
  font-weight: 500;
  color: var(--accent);
}

.course-rule {
  flex: 1;
  margin-left: 12pt;
  border-bottom: 0.5pt solid var(--hairline);
}

.dish {
  margin-bottom: 8pt;
}

.dish-row {
  flex-direction: row;
  align-items: baseline;
}

.dish-name {
  flex: 1;
  padding-right: 12pt;
  font-family: var(--display);
  font-size: 13pt;
  font-weight: 600;
  line-height: 1.2;
}

/* Prices in one column, with digits of one width. */
.price {
  width: 40pt;
  font-size: 9.5pt;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.dish-description {
  margin-top: 2pt;
  max-width: 250pt;
  font-size: 8.5pt;
  font-style: italic;
  line-height: 1.45;
  color: var(--muted);
}

.footer {
  position: absolute;
  right: var(--page-margin);
  bottom: 30pt;
  left: var(--page-margin);
  font-family: var(--display);
  font-size: 9pt;
  font-style: italic;
  font-weight: 500;
  text-align: center;
  color: var(--muted);
}

.wines {
  margin-top: 16pt;
}

.wine-head {
  flex-direction: row;
  align-items: flex-end;
  padding-bottom: 6pt;
}

.wine-head-label {
  flex: 1;
  font-size: 7.5pt;
  font-style: italic;
  color: var(--muted);
}

.column-head {
  width: 40pt;
  font-size: 7.5pt;
  font-style: italic;
  text-align: right;
  color: var(--muted);
}

.bottle-column {
  margin-left: 12pt;
}

.wine {
  flex-direction: row;
  align-items: baseline;
  padding-vertical: 6pt;
  border-top: 0.5pt solid var(--hairline);
}

.wine-info {
  flex: 1;
  padding-right: 12pt;
}

.wine-name {
  font-family: var(--display);
  font-size: 12pt;
  font-weight: 600;
}

.wine-origin {
  margin-top: 1pt;
  font-size: 8pt;
  color: var(--muted);
}

.price-note {
  position: absolute;
  right: var(--page-margin);
  bottom: 46pt;
  left: var(--page-margin);
  font-size: 7pt;
  font-style: italic;
  text-align: center;
  color: var(--muted);
}
</style>
