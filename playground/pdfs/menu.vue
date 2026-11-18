<script setup lang="ts">
import type { Menu, MenuCourse } from '../shared/menu'
import { formatMenuPrice, formatWinePrice, sampleMenu, winterMenu } from '../shared/menu'
import DotLeader from './components/common/DotLeader.vue'

defineOptions({ name: 'AlpenroseMenuPdf' })

type MenuProps = { menu: Menu }

const props = defineProps<MenuProps>()
const menu = props.menu

// A restrained alpine palette: warm near-black ink on a cream ground, one dusty
// rose accent for the section marks, a warm taupe for descriptions, and a light
// warm tone for the dotted leaders. No borders, no boxes — the type is the design.
// These two colours feed component props; the styles carry the same literals.
const accent = '#8f4a46'
const leader = '#cdbfa6'

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

      <template
        v-for="course in [menu.starters, menu.mains]"
        :key="course.id"
      >
        <PdfView
          :id="course.id"
          :bookmark="{ title: bookmarkTitles[course.id], expanded: false }"
          :class="{ 'course-following': course.id === menu.mains.id }"
        >
          <PdfView class="course-head">
            <PdfSvg
              :width="11"
              :height="11"
              view-box="0 0 13 13"
              class="course-mark"
            >
              <PdfPath
                d="M6.5 0.6 L12.4 6.5 L6.5 12.4 L0.6 6.5 Z"
                :stroke="accent"
                :stroke-width="0.75"
                fill="none"
              />
              <PdfCircle
                :cx="6.5"
                :cy="6.5"
                :r="1.15"
                :fill="accent"
              />
            </PdfSvg>
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
              <DotLeader
                :baseline="2"
                :gap="7"
                :color="leader"
                :width="0.75"
              />
              <PdfText class="dish-price">
                {{ formatMenuPrice(dish.price) }}
              </PdfText>
            </PdfView>
            <PdfText class="dish-description">
              {{ dish.description }}
            </PdfText>
          </PdfView>
        </PdfView>
      </template>

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
          <PdfSvg
            :width="11"
            :height="11"
            view-box="0 0 13 13"
            class="course-mark"
          >
            <PdfPath
              d="M6.5 0.6 L12.4 6.5 L6.5 12.4 L0.6 6.5 Z"
              :stroke="accent"
              :stroke-width="0.75"
              fill="none"
            />
            <PdfCircle
              :cx="6.5"
              :cy="6.5"
              :r="1.15"
              :fill="accent"
            />
          </PdfSvg>
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
            <DotLeader
              :baseline="2"
              :gap="7"
              :color="leader"
              :width="0.75"
            />
            <PdfText class="dish-price">
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
          <PdfSvg
            :width="11"
            :height="11"
            view-box="0 0 13 13"
            class="course-mark"
          >
            <PdfPath
              d="M6.5 0.6 L12.4 6.5 L6.5 12.4 L0.6 6.5 Z"
              :stroke="accent"
              :stroke-width="0.75"
              fill="none"
            />
            <PdfCircle
              :cx="6.5"
              :cy="6.5"
              :r="1.15"
              :fill="accent"
            />
          </PdfSvg>
          <PdfText class="course-label">
            {{ menu.wines.label }}
          </PdfText>
          <PdfView class="course-rule" />
        </PdfView>

        <PdfView class="wine-head">
          <PdfText class="wine-head-label">
            Offene Weine
          </PdfText>
          <PdfText class="column-head">
            Glas
          </PdfText>
          <PdfText class="column-head bottle-column">
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
          <PdfText class="wine-price">
            {{ formatMenuPrice(wine.glass) }}
          </PdfText>
          <PdfText class="wine-price bottle-column">
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
:root {
  --ink: #23201c;
  --muted: #857a68;
  --accent: #8f4a46;
  --font-body: Inter;
  --font-display: Lora;
  --page-margin: 52pt;
}
.page {
  padding: 42pt var(--page-margin) 38pt;
  font-family: var(--font-body);
  color: var(--ink);
  background-color: #faf7f0;
}

.masthead {
  align-items: center;
  margin-bottom: 20pt;
}

.menu-name {
  font-family: var(--font-display);
  font-size: 23pt;
  font-weight: 700;
  text-align: center;
  color: var(--ink);
}

.ethos {
  margin-top: 7pt;
  max-width: 230pt;
  font-family: var(--font-display);
  font-size: 10pt;
  font-style: italic;
  line-height: 1.4;
  text-align: center;
  color: var(--muted);
}

.masthead-rule {
  margin-top: 10pt;
  width: 34pt;
  border-bottom-width: 0.75pt;
  border-bottom-color: var(--accent);
}

.established {
  margin-top: 10pt;
  font-family: var(--font-body);
  font-size: 7pt;
  font-weight: 500;
  letter-spacing: 0.8pt;
  text-align: center;
  color: var(--muted);
}

.course-following {
  margin-top: 15pt;
}

/* Course head: a tiny alpine-rose lozenge mark, the letterspaced small-caps
   label, and one short hairline rule beneath. Mark and rule share a single
   0.75pt weight so the ornament reads as engineered, not decorative. */
.course-head {
  align-items: center;
  margin-bottom: 11pt;
}

.course-mark {
  margin-bottom: 6pt;
}

.course-label {
  font-family: var(--font-body);
  font-size: 9.5pt;
  font-weight: 600;
  letter-spacing: 2pt;
  text-align: center;
  text-transform: uppercase;
  color: var(--ink);
}

.course-rule {
  margin-top: 6pt;
  width: 28pt;
  border-bottom-width: 0.75pt;
  border-bottom-color: var(--accent);
}

.dish {
  margin-bottom: 9pt;
}

.dish-row {
  flex-direction: row;
  align-items: flex-end;
}

.dish-name {
  font-family: var(--font-body);
  font-size: 10pt;
  font-weight: 600;
  color: var(--ink);
}

.dish-price {
  width: 32pt;
  font-family: var(--font-body);
  font-size: 10pt;
  font-weight: 500;
  text-align: right;
  color: var(--ink);
}

.dish-description {
  margin-top: 2pt;
  max-width: 235pt;
  font-family: var(--font-display);
  font-size: 8pt;
  font-style: italic;
  line-height: 1.3;
  color: var(--muted);
}

.footer {
  position: absolute;
  right: var(--page-margin);
  bottom: 38pt;
  left: var(--page-margin);
  font-family: var(--font-body);
  font-size: 7pt;
  letter-spacing: 2pt;
  text-align: center;
  text-transform: uppercase;
  color: var(--accent);
}

.wines {
  margin-top: 22pt;
}

.wine-head {
  flex-direction: row;
  align-items: flex-end;
  margin-bottom: 11pt;
  padding-bottom: 5pt;
  border-bottom-width: 0.5pt;
  border-bottom-color: #cdbfa6;
}

.wine-head-label {
  flex: 1;
  font-family: var(--font-body);
  font-size: 7pt;
  font-weight: 500;
  letter-spacing: 1.4pt;
  text-transform: uppercase;
  color: var(--muted);
}

.column-head {
  width: 42pt;
  font-family: var(--font-body);
  font-size: 7pt;
  font-weight: 500;
  letter-spacing: 1.4pt;
  text-align: right;
  text-transform: uppercase;
  color: var(--muted);
}

.bottle-column {
  margin-left: 14pt;
}

.wine {
  flex-direction: row;
  align-items: flex-start;
  margin-bottom: 9pt;
}

.wine-info {
  flex: 1;
  padding-right: 12pt;
}

.wine-name {
  font-family: var(--font-body);
  font-size: 10pt;
  font-weight: 600;
  color: var(--ink);
}

.wine-origin {
  margin-top: 2pt;
  font-family: var(--font-display);
  font-size: 8pt;
  font-style: italic;
  color: var(--muted);
}

.wine-price {
  width: 42pt;
  font-family: var(--font-body);
  font-size: 10pt;
  font-weight: 500;
  text-align: right;
  color: var(--ink);
}

.price-note {
  position: absolute;
  right: var(--page-margin);
  bottom: 56pt;
  left: var(--page-margin);
  font-family: var(--font-display);
  font-size: 8pt;
  font-style: italic;
  text-align: center;
  color: var(--muted);
}
</style>
