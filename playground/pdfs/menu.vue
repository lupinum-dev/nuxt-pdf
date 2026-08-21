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
const ink = '#23201c'
const accent = '#8f4a46'
const muted = '#857a68'
const leader = '#cdbfa6'

const pageStyle = {
  backgroundColor: '#faf7f0',
  color: ink,
  fontFamily: 'Inter',
  paddingBottom: 38,
  paddingHorizontal: 52,
  paddingTop: 42,
} as const

const footerStyle = {
  bottom: 38,
  color: accent,
  fontFamily: 'Inter',
  fontSize: 7,
  left: 52,
  letterSpacing: 2,
  position: 'absolute',
  right: 52,
  textAlign: 'center',
  textTransform: 'uppercase',
} as const

// Course head: a tiny alpine-rose lozenge mark, the letterspaced small-caps
// label, and one short hairline rule beneath — mark and rule share a single
// 0.75pt weight so the ornament reads as engineered, not decorative.
const headWrapStyle = { alignItems: 'center', marginBottom: 11 } as const
const headLabelStyle = {
  color: ink,
  fontFamily: 'Inter',
  fontSize: 9.5,
  fontWeight: 600,
  letterSpacing: 2,
  textAlign: 'center',
  textTransform: 'uppercase',
} as const
const headRuleStyle = {
  borderBottomColor: accent,
  borderBottomWidth: 0.75,
  marginTop: 6,
  width: 28,
} as const

// Dish row shared by every course.
const dishRowStyle = { alignItems: 'flex-end', flexDirection: 'row' } as const
const dishNameStyle = { color: ink, fontFamily: 'Inter', fontSize: 10, fontWeight: 600 } as const
const dishPriceStyle = {
  color: ink,
  fontFamily: 'Inter',
  fontSize: 10,
  fontWeight: 500,
  textAlign: 'right',
  width: 32,
} as const
const dishDescStyle = {
  color: muted,
  fontFamily: 'Lora',
  fontSize: 8,
  fontStyle: 'italic',
  lineHeight: 1.3,
  marginTop: 2,
  maxWidth: 235,
} as const

const columnHeadStyle = {
  color: muted,
  fontFamily: 'Inter',
  fontSize: 7,
  fontWeight: 500,
  letterSpacing: 1.4,
  textAlign: 'right',
  textTransform: 'uppercase',
  width: 42,
} as const
const columnHeadLastStyle = { ...columnHeadStyle, marginLeft: 14 } as const
const winePriceStyle = {
  color: ink,
  fontFamily: 'Inter',
  fontSize: 10,
  fontWeight: 500,
  textAlign: 'right',
  width: 42,
} as const
const winePriceLastStyle = { ...winePriceStyle, marginLeft: 14 } as const

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
      :style="pageStyle"
    >
      <PdfView :style="{ alignItems: 'center', marginBottom: 20 }">
        <PdfText
          :style="{
            color: ink,
            fontFamily: 'Lora',
            fontSize: 23,
            fontWeight: 700,
            textAlign: 'center',
          }"
        >
          {{ menu.name }}
        </PdfText>
        <PdfText
          :style="{
            color: muted,
            fontFamily: 'Lora',
            fontSize: 10,
            fontStyle: 'italic',
            lineHeight: 1.4,
            marginTop: 7,
            maxWidth: 230,
            textAlign: 'center',
          }"
        >
          {{ menu.ethos }}
        </PdfText>
        <PdfView
          :style="{
            borderBottomColor: accent,
            borderBottomWidth: 0.75,
            marginTop: 10,
            width: 34,
          }"
        />
        <PdfText
          :style="{
            color: muted,
            fontFamily: 'Inter',
            fontSize: 7,
            fontWeight: 500,
            letterSpacing: 0.8,
            marginTop: 10,
            textAlign: 'center',
          }"
        >
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
          :style="{ marginTop: course.id === menu.mains.id ? 15 : 0 }"
        >
          <PdfView :style="headWrapStyle">
            <PdfSvg
              :width="11"
              :height="11"
              view-box="0 0 13 13"
              :style="{ marginBottom: 6 }"
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
            <PdfText :style="headLabelStyle">
              {{ course.label }}
            </PdfText>
            <PdfView :style="headRuleStyle" />
          </PdfView>

          <PdfView
            v-for="dish in course.dishes"
            :key="dish.name"
            :style="{ marginBottom: 9 }"
            :wrap="false"
          >
            <PdfView :style="dishRowStyle">
              <PdfText :style="dishNameStyle">
                {{ dish.name }}
              </PdfText>
              <DotLeader
                :baseline="2"
                :gap="7"
                :color="leader"
                :width="0.75"
              />
              <PdfText :style="dishPriceStyle">
                {{ formatMenuPrice(dish.price) }}
              </PdfText>
            </PdfView>
            <PdfText :style="dishDescStyle">
              {{ dish.description }}
            </PdfText>
          </PdfView>
        </PdfView>
      </template>

      <PdfText
        fixed
        :style="footerStyle"
      >
        {{ menu.name }}
      </PdfText>
    </PdfPage>

    <!-- Page 2: desserts, wine list -->
    <PdfPage
      size="A5"
      :style="pageStyle"
    >
      <PdfView
        :id="menu.desserts.id"
        :bookmark="{ title: bookmarkTitles.desserts, expanded: false }"
      >
        <PdfView :style="headWrapStyle">
          <PdfSvg
            :width="11"
            :height="11"
            view-box="0 0 13 13"
            :style="{ marginBottom: 6 }"
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
          <PdfText :style="headLabelStyle">
            {{ menu.desserts.label }}
          </PdfText>
          <PdfView :style="headRuleStyle" />
        </PdfView>

        <PdfView
          v-for="dish in menu.desserts.dishes"
          :key="dish.name"
          :style="{ marginBottom: 9 }"
          :wrap="false"
        >
          <PdfView :style="dishRowStyle">
            <PdfText :style="dishNameStyle">
              {{ dish.name }}
            </PdfText>
            <DotLeader
              :baseline="2"
              :gap="7"
              :color="leader"
              :width="0.75"
            />
            <PdfText :style="dishPriceStyle">
              {{ formatMenuPrice(dish.price) }}
            </PdfText>
          </PdfView>
          <PdfText :style="dishDescStyle">
            {{ dish.description }}
          </PdfText>
        </PdfView>
      </PdfView>

      <PdfView
        :id="menu.wines.id"
        :bookmark="{ title: bookmarkTitles.wines, expanded: false }"
        :style="{ marginTop: 22 }"
      >
        <PdfView :style="headWrapStyle">
          <PdfSvg
            :width="11"
            :height="11"
            view-box="0 0 13 13"
            :style="{ marginBottom: 6 }"
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
          <PdfText :style="headLabelStyle">
            {{ menu.wines.label }}
          </PdfText>
          <PdfView :style="headRuleStyle" />
        </PdfView>

        <PdfView
          :style="{
            alignItems: 'flex-end',
            borderBottomColor: leader,
            borderBottomWidth: 0.5,
            flexDirection: 'row',
            marginBottom: 11,
            paddingBottom: 5,
          }"
        >
          <PdfText
            :style="{
              color: muted,
              flex: 1,
              fontFamily: 'Inter',
              fontSize: 7,
              fontWeight: 500,
              letterSpacing: 1.4,
              textTransform: 'uppercase',
            }"
          >
            Offene Weine
          </PdfText>
          <PdfText :style="columnHeadStyle">
            Glas
          </PdfText>
          <PdfText :style="columnHeadLastStyle">
            Flasche
          </PdfText>
        </PdfView>

        <PdfView
          v-for="wine in menu.wines.entries"
          :key="wine.name"
          :style="{ alignItems: 'flex-start', flexDirection: 'row', marginBottom: 9 }"
          :wrap="false"
        >
          <PdfView :style="{ flex: 1, paddingRight: 12 }">
            <PdfText :style="{ color: ink, fontFamily: 'Inter', fontSize: 10, fontWeight: 600 }">
              {{ wine.name }}
            </PdfText>
            <PdfText
              :style="{
                color: muted,
                fontFamily: 'Lora',
                fontSize: 8,
                fontStyle: 'italic',
                marginTop: 2,
              }"
            >
              {{ wine.region }} · {{ wine.year }}
            </PdfText>
          </PdfView>
          <PdfText :style="winePriceStyle">
            {{ formatMenuPrice(wine.glass) }}
          </PdfText>
          <PdfText :style="winePriceLastStyle">
            {{ formatWinePrice(wine.bottle) }}
          </PdfText>
        </PdfView>
      </PdfView>

      <PdfText
        fixed
        :style="{
          bottom: 56,
          color: muted,
          fontFamily: 'Lora',
          fontSize: 8,
          fontStyle: 'italic',
          left: 52,
          position: 'absolute',
          right: 52,
          textAlign: 'center',
        }"
      >
        {{ menu.priceNote }}
      </PdfText>

      <PdfText
        fixed
        :style="footerStyle"
      >
        {{ menu.name }}
      </PdfText>
    </PdfPage>
  </PdfDocument>
</template>
