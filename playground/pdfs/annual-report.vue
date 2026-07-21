<script setup lang="ts">
import type { AnnualReport, Kpi } from '../shared/annual'
import { boardCutReport, buildKpis, sampleAnnualReport } from '../shared/annual'
import { barModel, donutModel, ledgerView, lineModel } from './components/annual/models'
import { accent, eyebrow, ink, paper } from './components/annual/theme'

defineOptions({ name: 'FieldnoteAnnualReportPdf' })

type AnnualProps = { report: AnnualReport }

const props = defineProps<AnnualProps>()
const report = props.report

const kpis = buildKpis(report.current, report.prior)
const bar = barModel(report.quarters)
const line = lineModel(report.monthly)
const donut = donutModel(report.sectors)
const ledger = ledgerView(report.current, report.prior)

// Direction sets the triangle orientation; favorability sets its colour.
const triangleFor = (kpi: Kpi): string => (kpi.direction === 'up' ? '3,0 6,5 0,5' : '0,0 6,0 3,5')
const deltaColorFor = (kpi: Kpi): string => (kpi.favorable ? accent.base : '#B4632E')

// Keep the letter's headline and serif body ragged-right without mid-word
// breaks — hyphenated display type reads as a defect.
const noHyphen = (word: string): string[] => [word]

const contentPage = {
  backgroundColor: paper.page,
  color: ink.strong,
  fontFamily: 'Inter',
  fontSize: 10,
  paddingBottom: 60,
  paddingHorizontal: 54,
  paddingTop: 58,
} as const

const topBar = {
  backgroundColor: accent.base,
  height: 5,
  left: 0,
  position: 'absolute',
  right: 0,
  top: 0,
} as const

const footerLeft = {
  bottom: 30,
  color: ink.muted,
  fontFamily: 'Inter',
  fontSize: 7.5,
  left: 54,
  position: 'absolute',
} as const

const footerRight = {
  bottom: 30,
  color: ink.muted,
  fontFamily: 'Inter',
  fontSize: 7.5,
  position: 'absolute',
  right: 54,
  textAlign: 'right',
} as const

const sectionTitle = {
  color: ink.strong,
  fontFamily: 'Inter',
  fontSize: 21,
  fontWeight: 700,
} as const

const chartHeading = {
  color: ink.strong,
  fontFamily: 'Inter',
  fontSize: 11,
  fontWeight: 600,
} as const

const chartCaption = {
  color: ink.muted,
  fontFamily: 'Inter',
  fontSize: 8,
  marginTop: 3,
} as const

const footerText = `${report.company} · ${report.form} ${report.fiscalYear}`

definePdf<AnnualProps>({
  title: ({ report }) => `${report.company} — ${report.form} ${report.fiscalYear}`,
  filename: ({ report }) => `fieldnote-annual-report-${report.fiscalYear}.pdf`,
  language: 'en',
  sampleData: { report: sampleAnnualReport },
  scenarios: {
    boardCut: { report: boardCutReport },
  },
})
</script>

<template>
  <PdfDocument
    :author="report.company"
    creator="Nuxt PDF"
    :subject="`${report.form} ${report.fiscalYear}`"
  >
    <!-- 1 · Cover -->
    <PdfPage
      size="A4"
      :style="{ backgroundColor: paper.page, color: ink.strong, fontFamily: 'Inter' }"
    >
      <PdfView
        id="cover"
        :bookmark="{ title: `${report.form} ${report.fiscalYear}`, expanded: true }"
        :style="{ flex: 1, paddingHorizontal: 54, paddingTop: 66 }"
      >
        <PdfText :style="{ ...eyebrow, textTransform: 'uppercase' }">
          {{ report.cover.eyebrow }} · {{ report.edition }}
        </PdfText>
        <PdfText :style="{ color: ink.strong, fontFamily: 'Inter', fontSize: 15, fontWeight: 600, marginTop: 10 }">
          {{ report.company }}
        </PdfText>

        <PdfView :style="{ marginTop: 120 }">
          <PdfText :style="{ color: accent.base, fontFamily: 'Inter', fontSize: 138, fontWeight: 800, letterSpacing: -2 }">
            {{ report.fiscalYear }}
          </PdfText>
          <PdfText :style="{ color: ink.strong, fontFamily: 'Lora', fontSize: 30, marginTop: 6, width: 380 }">
            {{ report.cover.title }}
          </PdfText>
          <PdfText :style="{ color: ink.soft, fontFamily: 'Lora', fontSize: 11.5, lineHeight: 1.6, marginTop: 18, width: 360 }">
            {{ report.cover.standfirst }}
          </PdfText>
        </PdfView>
      </PdfView>

      <!-- The single deliberate full-bleed accent bar. -->
      <PdfView
        :style="{
          alignItems: 'flex-end',
          backgroundColor: accent.base,
          bottom: 0,
          flexDirection: 'row',
          justifyContent: 'space-between',
          left: 0,
          paddingBottom: 26,
          paddingHorizontal: 54,
          paddingTop: 24,
          position: 'absolute',
          right: 0,
        }"
      >
        <PdfText :style="{ color: '#FFFFFF', fontFamily: 'Inter', fontSize: 9, fontWeight: 600, letterSpacing: 0.5 }">
          {{ report.form }} · Fiscal year {{ report.fiscalYear }}
        </PdfText>
        <PdfText :style="{ color: '#CFE0D3', fontFamily: 'Inter', fontSize: 7.5 }">
          {{ report.registration }}
        </PdfText>
      </PdfView>
    </PdfPage>

    <!-- 2 · Letter -->
    <PdfPage
      size="A4"
      :style="{ ...contentPage, paddingHorizontal: 90, paddingTop: 84 }"
    >
      <PdfView
        fixed
        :style="topBar"
      />
      <PdfView
        id="letter"
        :bookmark="{ title: 'From the Managing Director', expanded: true }"
      >
        <PdfText :style="{ ...eyebrow, textTransform: 'uppercase' }">
          From the Managing Director
        </PdfText>
        <PdfText
          v-bind="{ hyphenationCallback: noHyphen }"
          :style="{ color: ink.strong, fontFamily: 'Lora', fontSize: 23, marginTop: 14, width: 340 }"
        >
          {{ report.letter.salutation }}
        </PdfText>

        <PdfView :style="{ marginTop: 22, width: 372 }">
          <PdfText
            v-for="(paragraph, index) in report.letter.paragraphs"
            :key="index"
            v-bind="{ hyphenationCallback: noHyphen }"
            :style="{ color: ink.soft, fontFamily: 'Lora', fontSize: 11, lineHeight: 1.62, marginBottom: 13 }"
          >
            {{ paragraph }}
          </PdfText>
        </PdfView>

        <PdfView :style="{ borderTopColor: paper.hairline, borderTopWidth: 0.5, marginTop: 20, paddingTop: 16, width: 240 }">
          <PdfText :style="{ color: ink.strong, fontFamily: 'Lora', fontSize: 15, fontStyle: 'italic' }">
            {{ report.letter.author }}
          </PdfText>
          <PdfText :style="{ color: ink.muted, fontFamily: 'Inter', fontSize: 8.5, marginTop: 5 }">
            {{ report.letter.role }} · {{ report.letter.place }}, {{ report.letter.date }}
          </PdfText>
        </PdfView>
      </PdfView>

      <PdfText
        fixed
        :style="footerLeft"
      >
        {{ footerText }}
      </PdfText>
      <PdfText
        fixed
        :render="({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`"
        :style="footerRight"
      />
    </PdfPage>

    <!-- 3 · Highlights -->
    <PdfPage
      size="A4"
      :style="contentPage"
    >
      <PdfView
        fixed
        :style="topBar"
      />
      <PdfView
        id="highlights"
        :bookmark="{ title: 'The Year in Figures', expanded: true }"
      >
        <PdfText :style="{ ...eyebrow, textTransform: 'uppercase' }">
          Highlights · FY {{ report.fiscalYear }}
        </PdfText>
        <PdfText :style="{ ...sectionTitle, marginTop: 8 }">
          The year in figures
        </PdfText>
        <PdfText :style="{ color: ink.muted, fontFamily: 'Inter', fontSize: 9.5, lineHeight: 1.5, marginTop: 8, width: 400 }">
          Every figure below is measured against {{ report.priorYear }} and drawn from the
          statements on the final page.
        </PdfText>

        <PdfView :style="{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 26 }">
          <PdfView
            v-for="kpi in kpis"
            :key="kpi.id"
            :wrap="false"
            :style="{
              backgroundColor: paper.panel,
              borderTopColor: accent.base,
              borderTopWidth: 2,
              marginBottom: 16,
              paddingBottom: 16,
              paddingHorizontal: 15,
              paddingTop: 13,
              width: '31.5%',
            }"
          >
            <PdfText :style="{ color: ink.muted, fontFamily: 'Inter', fontSize: 7.5, fontWeight: 600, letterSpacing: 1.1, textTransform: 'uppercase' }">
              {{ kpi.label }}
            </PdfText>
            <PdfText :style="{ color: ink.strong, fontFamily: 'Inter', fontSize: 25, fontWeight: 700, marginTop: 11 }">
              {{ kpi.value }}
            </PdfText>
            <PdfView :style="{ alignItems: 'center', flexDirection: 'row', marginTop: 10 }">
              <PdfSvg
                viewBox="0 0 6 5"
                :style="{ height: 5, marginRight: 4, width: 6 }"
              >
                <PdfPolygon
                  :points="triangleFor(kpi)"
                  :fill="deltaColorFor(kpi)"
                />
              </PdfSvg>
              <PdfText :style="{ color: deltaColorFor(kpi), fontFamily: 'Inter', fontSize: 9, fontWeight: 600 }">
                {{ kpi.delta }}
              </PdfText>
              <PdfText :style="{ color: ink.muted, fontFamily: 'Inter', fontSize: 8, marginLeft: 6 }">
                {{ kpi.caption }}
              </PdfText>
            </PdfView>
          </PdfView>
        </PdfView>
      </PdfView>

      <PdfText
        fixed
        :style="footerLeft"
      >
        {{ footerText }}
      </PdfText>
      <PdfText
        fixed
        :render="({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`"
        :style="footerRight"
      />
    </PdfPage>

    <!-- 4 · Performance -->
    <PdfPage
      size="A4"
      :style="contentPage"
    >
      <PdfView
        fixed
        :style="topBar"
      />
      <PdfView
        id="performance"
        :bookmark="{ title: 'Performance', expanded: true }"
      >
        <PdfText :style="{ ...eyebrow, textTransform: 'uppercase' }">
          Performance
        </PdfText>
        <PdfText :style="{ ...sectionTitle, marginTop: 8 }">
          Where the revenue came from
        </PdfText>

        <!-- Grouped bar chart: revenue by quarter, two series. -->
        <PdfView :style="{ marginTop: 26 }">
          <PdfText :style="chartHeading">
            Revenue by quarter
          </PdfText>
          <PdfText :style="chartCaption">
            Consulting and licensing, EUR thousands
          </PdfText>

          <PdfView :style="{ height: bar.height, marginTop: 12, position: 'relative', width: bar.width }">
            <PdfSvg
              :viewBox="`0 0 ${bar.width} ${bar.height}`"
              :style="{ height: bar.height, width: bar.width }"
            >
              <PdfLine
                v-for="tick in bar.ticks"
                :key="`bl-${tick.value}`"
                :x1="bar.plotLeft"
                :y1="tick.y"
                :x2="bar.width"
                :y2="tick.y"
                :stroke="tick.value === 0 ? paper.hairlineStrong : paper.hairline"
                :stroke-width="tick.value === 0 ? 0.75 : 0.5"
              />
              <PdfRect
                v-for="(b, index) in bar.bars"
                :key="`br-${index}`"
                :x="b.x"
                :y="b.y"
                :width="bar.barW"
                :height="b.h"
                :fill="b.fill"
              />
            </PdfSvg>

            <PdfText
              v-for="tick in bar.ticks"
              :key="`bt-${tick.value}`"
              :style="{ color: ink.muted, fontFamily: 'Inter', fontSize: 7, left: 0, position: 'absolute', textAlign: 'right', top: tick.y - 3.5, width: bar.gutter - 6 }"
            >
              {{ tick.label }}
            </PdfText>
            <PdfText
              v-for="(b, index) in bar.bars"
              :key="`bv-${index}`"
              :style="{ color: ink.soft, fontFamily: 'Inter', fontSize: 7, fontWeight: 500, left: b.center - 20, position: 'absolute', textAlign: 'center', top: b.labelTop, width: 40 }"
            >
              {{ b.value }}
            </PdfText>
            <PdfText
              v-for="group in bar.groups"
              :key="`bg-${group.label}`"
              :style="{ color: ink.strong, fontFamily: 'Inter', fontSize: 8.5, fontWeight: 500, left: group.center - 20, position: 'absolute', textAlign: 'center', top: bar.baseline + 7, width: 40 }"
            >
              {{ group.label }}
            </PdfText>
            <PdfView :style="{ flexDirection: 'row', justifyContent: 'flex-end', left: bar.plotLeft, position: 'absolute', top: -2, width: bar.plotW }">
              <PdfText :style="{ color: accent.deep, fontFamily: 'Inter', fontSize: 8, fontWeight: 600, marginRight: 16 }">
                Consulting
              </PdfText>
              <PdfText :style="{ color: accent.mid, fontFamily: 'Inter', fontSize: 8, fontWeight: 600 }">
                Licensing
              </PdfText>
            </PdfView>
          </PdfView>
        </PdfView>

        <PdfView :style="{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 34 }">
          <!-- Line + area chart: recurring revenue. -->
          <PdfView>
            <PdfText :style="chartHeading">
              Recurring revenue
            </PdfText>
            <PdfText :style="chartCaption">
              Monthly, EUR thousands
            </PdfText>

            <PdfView :style="{ height: line.height, marginTop: 12, position: 'relative', width: line.width }">
              <PdfSvg
                :viewBox="`0 0 ${line.width} ${line.height}`"
                :style="{ height: line.height, width: line.width }"
              >
                <PdfDefs>
                  <PdfLinearGradient
                    id="mrrArea"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <PdfStop
                      offset="0"
                      stop-color="#9FBBA6"
                    />
                    <PdfStop
                      offset="1"
                      stop-color="#EAF0E9"
                    />
                  </PdfLinearGradient>
                </PdfDefs>
                <PdfLine
                  v-for="tick in line.ticks"
                  :key="`ll-${tick.value}`"
                  :x1="line.plotLeft"
                  :y1="tick.y"
                  :x2="line.width"
                  :y2="tick.y"
                  :stroke="tick.value === 0 ? paper.hairlineStrong : paper.hairline"
                  :stroke-width="tick.value === 0 ? 0.75 : 0.5"
                />
                <PdfG :transform="line.translate">
                  <PdfPath
                    :d="line.area"
                    fill="url(#mrrArea)"
                  />
                  <PdfPolyline
                    :points="line.line"
                    fill="none"
                    :stroke="accent.base"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                  <PdfCircle
                    :cx="line.dotX"
                    :cy="line.dotY"
                    r="2.4"
                    :fill="accent.base"
                  />
                </PdfG>
              </PdfSvg>

              <PdfText
                v-for="tick in line.ticks"
                :key="`lt-${tick.value}`"
                :style="{ color: ink.muted, fontFamily: 'Inter', fontSize: 6.5, left: 0, position: 'absolute', textAlign: 'right', top: tick.y - 3.2, width: line.gutter - 5 }"
              >
                {{ tick.value }}
              </PdfText>
              <PdfText
                v-for="(month, index) in line.months"
                :key="`lm-${index}`"
                :style="{ color: ink.muted, fontFamily: 'Inter', fontSize: 6, left: month.x - 8, position: 'absolute', textAlign: 'center', top: line.baseline + 5, width: 16 }"
              >
                {{ month.label }}
              </PdfText>
              <PdfText :style="{ color: ink.muted, fontFamily: 'Inter', fontSize: 7, left: line.first.x, position: 'absolute', top: line.first.y }">
                {{ line.first.label }}
              </PdfText>
              <PdfText :style="{ color: accent.base, fontFamily: 'Inter', fontSize: 8.5, fontWeight: 700, left: line.last.x, position: 'absolute', textAlign: 'right', top: line.last.y, width: 50 }">
                {{ line.last.label }}
              </PdfText>
            </PdfView>
          </PdfView>

          <!-- Donut chart: revenue by client sector, one highlighted. -->
          <PdfView>
            <PdfText :style="chartHeading">
              Revenue by client sector
            </PdfText>
            <PdfText :style="chartCaption">
              Share of total, EUR thousands
            </PdfText>

            <PdfView :style="{ alignItems: 'center', flexDirection: 'row', marginTop: 12, width: 250 }">
              <PdfView :style="{ height: donut.size, position: 'relative', width: donut.size }">
                <PdfSvg
                  :viewBox="`0 0 ${donut.size} ${donut.size}`"
                  :style="{ height: donut.size, width: donut.size }"
                >
                  <PdfPath
                    v-for="segment in donut.segments"
                    :key="segment.id"
                    :d="segment.d"
                    :fill="segment.fill"
                    :transform="segment.transform"
                  />
                </PdfSvg>
                <PdfView :style="{ alignItems: 'center', bottom: 0, justifyContent: 'center', left: 0, position: 'absolute', right: 0, top: 0 }">
                  <PdfText :style="{ color: ink.strong, fontFamily: 'Inter', fontSize: 15, fontWeight: 700 }">
                    {{ donut.totalLabel }}
                  </PdfText>
                  <PdfText :style="{ color: ink.muted, fontFamily: 'Inter', fontSize: 6.5, letterSpacing: 0.8, marginTop: 2, textTransform: 'uppercase' }">
                    Revenue
                  </PdfText>
                </PdfView>
              </PdfView>

              <PdfView :style="{ flex: 1, paddingLeft: 10 }">
                <PdfView
                  v-for="row in donut.legend"
                  :key="row.id"
                  :style="{ alignItems: 'center', flexDirection: 'row', marginBottom: 6 }"
                >
                  <PdfView :style="{ backgroundColor: row.color, height: 7, marginRight: 6, width: 7 }" />
                  <PdfText :style="{ color: row.highlight ? ink.strong : ink.soft, flex: 1, fontFamily: 'Inter', fontSize: 8, fontWeight: row.highlight ? 600 : 400 }">
                    {{ row.label }}
                  </PdfText>
                  <PdfText :style="{ color: ink.muted, fontFamily: 'Inter', fontSize: 7.5, textAlign: 'right', width: 26 }">
                    {{ row.pct }}
                  </PdfText>
                </PdfView>
                <PdfView :style="{ borderTopColor: paper.hairline, borderTopWidth: 0.5, flexDirection: 'row', marginTop: 2, paddingTop: 6 }">
                  <PdfText :style="{ color: ink.muted, flex: 1, fontFamily: 'Inter', fontSize: 7.5 }">
                    Total
                  </PdfText>
                  <PdfText :style="{ color: ink.strong, fontFamily: 'Inter', fontSize: 7.5, fontWeight: 600, textAlign: 'right' }">
                    {{ donut.totalK }}
                  </PdfText>
                </PdfView>
              </PdfView>
            </PdfView>
          </PdfView>
        </PdfView>
      </PdfView>

      <PdfText
        fixed
        :style="footerLeft"
      >
        {{ footerText }}
      </PdfText>
      <PdfText
        fixed
        :render="({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`"
        :style="footerRight"
      />
    </PdfPage>

    <!-- 5 · Financial statements -->
    <PdfPage
      size="A4"
      :style="contentPage"
    >
      <PdfView
        fixed
        :style="topBar"
      />
      <PdfView
        id="financials"
        :bookmark="{ title: 'Financial Statements', expanded: true }"
      >
        <PdfText :style="{ ...eyebrow, textTransform: 'uppercase' }">
          Financial Statements
        </PdfText>
        <PdfText :style="{ ...sectionTitle, marginTop: 8 }">
          Statement of operations
        </PdfText>
        <PdfText :style="{ color: ink.muted, fontFamily: 'Inter', fontSize: 9.5, marginTop: 8 }">
          For the year ended 31 December {{ report.fiscalYear }} · all figures in EUR thousands
        </PdfText>

        <PdfView :style="{ marginTop: 26, width: 420 }">
          <PdfView :style="{ alignItems: 'flex-end', flexDirection: 'row', paddingBottom: 8 }">
            <PdfText :style="{ color: ink.muted, flex: 1, fontFamily: 'Inter', fontSize: 7.5, letterSpacing: 0.6, textTransform: 'uppercase' }">
              Statement line
            </PdfText>
            <PdfText :style="{ color: ink.strong, fontFamily: 'Inter', fontSize: 8, fontWeight: 600, textAlign: 'right', width: 82 }">
              FY {{ report.fiscalYear }}
            </PdfText>
            <PdfText :style="{ color: ink.muted, fontFamily: 'Inter', fontSize: 8, textAlign: 'right', width: 74 }">
              FY {{ report.priorYear }}
            </PdfText>
          </PdfView>

          <PdfView
            v-for="row in ledger"
            :key="row.id"
            :wrap="false"
            :style="{
              alignItems: 'baseline',
              borderTopColor: row.topColor,
              borderTopWidth: row.ruled ? row.topWidth : 0,
              flexDirection: 'row',
              marginTop: row.ruled ? 6 : 0,
              paddingBottom: 6,
              paddingTop: row.ruled ? 7 : 6,
            }"
          >
            <PdfText :style="{ color: row.labelColor, flex: 1, fontFamily: 'Inter', fontSize: row.fontSize, fontWeight: row.labelWeight }">
              {{ row.label }}
            </PdfText>
            <PdfText :style="{ color: row.valueColor, fontFamily: 'Inter', fontSize: row.fontSize, fontWeight: row.valueWeight, textAlign: 'right', width: 82 }">
              {{ row.current }}
            </PdfText>
            <PdfText :style="{ color: ink.muted, fontFamily: 'Inter', fontSize: row.fontSize - 0.5, textAlign: 'right', width: 74 }">
              {{ row.prior }}
            </PdfText>
          </PdfView>
        </PdfView>

        <PdfView :style="{ borderLeftColor: accent.base, borderLeftWidth: 2, marginTop: 30, paddingLeft: 12, width: 420 }">
          <PdfText :style="{ color: ink.muted, fontFamily: 'Inter', fontSize: 7.5, letterSpacing: 0.6, marginBottom: 4, textTransform: 'uppercase' }">
            Basis of preparation
          </PdfText>
          <PdfText :style="{ color: ink.soft, fontFamily: 'Inter', fontSize: 8.5, lineHeight: 1.5 }">
            Figures are unaudited management accounts rounded to the nearest thousand euro.
            Parentheses denote outflows. {{ report.registration }}.
          </PdfText>
        </PdfView>
      </PdfView>

      <PdfText
        fixed
        :style="footerLeft"
      >
        {{ footerText }}
      </PdfText>
      <PdfText
        fixed
        :render="({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`"
        :style="footerRight"
      />
    </PdfPage>
  </PdfDocument>
</template>
