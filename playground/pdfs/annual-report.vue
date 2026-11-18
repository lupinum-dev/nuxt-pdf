<script setup lang="ts">
import type { AnnualReport, Kpi } from '../shared/annual'
import { boardCutReport, buildKpis, sampleAnnualReport } from '../shared/annual'
import { barModel, donutModel, ledgerView, lineModel } from './components/annual/models'
import { accent, ink, paper } from './components/annual/theme'

defineOptions({ name: 'FieldnoteAnnualReportPdf' })

type AnnualProps = { report: AnnualReport }

const props = defineProps<AnnualProps>()
const report = props.report

const kpis = buildKpis(report.current, report.prior)
const bar = barModel(report.quarters)
const line = lineModel(report.monthly)
const donut = donutModel(report.sectors)
const ledger = ledgerView(report.current, report.prior)
// Statement line (takes the free width), current year, prior year.
const ledgerColumns = [1, '82pt', '74pt'] as const

// Direction sets the triangle orientation; favorability sets its colour.
const triangleFor = (kpi: Kpi): string => (kpi.direction === 'up' ? '3,0 6,5 0,5' : '0,0 6,0 3,5')
const deltaColorFor = (kpi: Kpi): string => (kpi.favorable ? accent.base : '#B4632E')

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
    :conformance="['PDF/A-3a', 'PDF/UA-1']"
  >
    <!-- 1 · Cover -->
    <PdfPage
      size="A4"
      class="cover-page"
    >
      <PdfView
        id="cover"
        :bookmark="{ title: `${report.form} ${report.fiscalYear}`, expanded: true }"
        tag="section"
        class="cover"
      >
        <PdfText class="eyebrow">
          {{ report.cover.eyebrow }} · {{ report.edition }}
        </PdfText>
        <PdfText class="cover-company">
          {{ report.company }}
        </PdfText>

        <PdfView class="cover-title-block">
          <PdfText class="cover-year">
            {{ report.fiscalYear }}
          </PdfText>
          <PdfText
            tag="h1"
            class="cover-title"
          >
            {{ report.cover.title }}
          </PdfText>
          <PdfText class="cover-standfirst">
            {{ report.cover.standfirst }}
          </PdfText>
        </PdfView>
      </PdfView>

      <!-- The single deliberate full-bleed accent bar. -->
      <PdfView
        class="cover-band"
      >
        <PdfText class="cover-form">
          {{ report.form }} · Fiscal year {{ report.fiscalYear }}
        </PdfText>
        <PdfText class="cover-registration">
          {{ report.registration }}
        </PdfText>
      </PdfView>
    </PdfPage>

    <!-- 2 · Letter -->
    <PdfPage
      size="A4"
      class="page letter-page"
    >
      <PdfView
        fixed
        class="top-bar"
      />
      <PdfView
        id="letter"
        :bookmark="{ title: 'From the Managing Director', expanded: true }"
        tag="section"
      >
        <PdfText
          tag="h2"
          class="eyebrow"
        >
          From the Managing Director
        </PdfText>
        <!-- Headline and serif body stay ragged-right without mid-word breaks:
             hyphenated display type reads as a defect. -->
        <PdfText
          :hyphenate="false"
          class="letter-salutation"
        >
          {{ report.letter.salutation }}
        </PdfText>

        <PdfView class="letter-body">
          <PdfText
            v-for="(paragraph, index) in report.letter.paragraphs"
            :key="index"
            :hyphenate="false"
            class="letter-paragraph"
          >
            {{ paragraph }}
          </PdfText>
        </PdfView>

        <PdfView class="letter-signature">
          <PdfText class="letter-author">
            {{ report.letter.author }}
          </PdfText>
          <PdfText class="letter-role">
            {{ report.letter.role }} · {{ report.letter.place }}, {{ report.letter.date }}
          </PdfText>
        </PdfView>
      </PdfView>

      <PdfText
        fixed
        class="footer footer-left"
      >
        {{ footerText }}
      </PdfText>
      <PdfText
        fixed
        class="footer footer-right"
      >
        <PdfPageNumber /> / <PdfPageCount />
      </PdfText>
    </PdfPage>

    <!-- 3 · Highlights -->
    <PdfPage
      size="A4"
      class="page"
    >
      <PdfView
        fixed
        class="top-bar"
      />
      <PdfView
        id="highlights"
        :bookmark="{ title: 'The Year in Figures', expanded: true }"
        tag="section"
      >
        <PdfText class="eyebrow">
          Highlights · FY {{ report.fiscalYear }}
        </PdfText>
        <PdfText
          tag="h2"
          class="section-title"
        >
          The year in figures
        </PdfText>
        <PdfText class="section-intro highlights-intro">
          Every figure below is measured against {{ report.priorYear }} and drawn from the
          statements on the final page.
        </PdfText>

        <PdfView
          tag="list"
          class="kpi-grid"
        >
          <PdfView
            v-for="kpi in kpis"
            :key="kpi.id"
            :wrap="false"
            tag="list-item"
            class="kpi"
          >
            <PdfText class="kpi-label">
              {{ kpi.label }}
            </PdfText>
            <PdfText class="kpi-value">
              {{ kpi.value }}
            </PdfText>
            <PdfView class="kpi-change">
              <!-- The delta text carries the sign; the triangle repeats it. -->
              <PdfSvg
                viewBox="0 0 6 5"
                decorative
                class="kpi-triangle"
              >
                <PdfPolygon
                  :points="triangleFor(kpi)"
                  :fill="deltaColorFor(kpi)"
                />
              </PdfSvg>
              <PdfText
                class="kpi-delta"
                :style="{ color: deltaColorFor(kpi) }"
              >
                {{ kpi.delta }}
              </PdfText>
              <PdfText class="kpi-caption">
                {{ kpi.caption }}
              </PdfText>
            </PdfView>
          </PdfView>
        </PdfView>
      </PdfView>

      <PdfText
        fixed
        class="footer footer-left"
      >
        {{ footerText }}
      </PdfText>
      <PdfText
        fixed
        class="footer footer-right"
      >
        <PdfPageNumber /> / <PdfPageCount />
      </PdfText>
    </PdfPage>

    <!-- 4 · Performance -->
    <PdfPage
      size="A4"
      class="page"
    >
      <PdfView
        fixed
        class="top-bar"
      />
      <PdfView
        id="performance"
        :bookmark="{ title: 'Performance', expanded: true }"
        tag="section"
      >
        <PdfText class="eyebrow">
          Performance
        </PdfText>
        <PdfText
          tag="h2"
          class="section-title"
        >
          Where the revenue came from
        </PdfText>

        <!-- Grouped bar chart: revenue by quarter, two series. -->
        <PdfView class="chart">
          <PdfText
            tag="h3"
            class="chart-heading"
          >
            Revenue by quarter
          </PdfText>
          <!-- One figure: its caption, the chart, and the labels around it.
               The figure's alt text carries every plotted value, so the axis,
               value and legend labels around the bars are decorative. -->
          <PdfView
            tag="figure"
            :alt="bar.alt"
          >
            <PdfView tag="caption">
              <PdfText class="chart-caption">
                Consulting and licensing, EUR thousands
              </PdfText>
            </PdfView>

            <PdfView
              class="chart-plot"
              :style="{ height: bar.height, width: bar.width }"
            >
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
                decorative
                class="bar-tick"
                :style="{ top: tick.y - 3.5, width: bar.gutter - 6 }"
              >
                {{ tick.label }}
              </PdfText>
              <PdfText
                v-for="(b, index) in bar.bars"
                :key="`bv-${index}`"
                decorative
                class="bar-value"
                :style="{ left: b.center - 20, top: b.labelTop }"
              >
                {{ b.value }}
              </PdfText>
              <PdfText
                v-for="group in bar.groups"
                :key="`bg-${group.label}`"
                decorative
                class="bar-group"
                :style="{ left: group.center - 20, top: bar.baseline + 7 }"
              >
                {{ group.label }}
              </PdfText>
              <PdfView
                decorative
                class="bar-legend"
                :style="{ left: bar.plotLeft, width: bar.plotW }"
              >
                <PdfText class="bar-legend-consulting">
                  Consulting
                </PdfText>
                <PdfText class="bar-legend-licensing">
                  Licensing
                </PdfText>
              </PdfView>
            </PdfView>
          </PdfView>
        </PdfView>

        <PdfView class="chart-row">
          <!-- Line + area chart: recurring revenue. -->
          <PdfView>
            <PdfText
              tag="h3"
              class="chart-heading"
            >
              Recurring revenue
            </PdfText>
            <!-- One figure: caption, chart and labels. The figure's alt text
                 says what the line shows; the axis and point labels are
                 decorative. -->
            <PdfView
              tag="figure"
              :alt="line.alt"
            >
              <PdfView tag="caption">
                <PdfText class="chart-caption">
                  Monthly, EUR thousands
                </PdfText>
              </PdfView>

              <PdfView
                class="chart-plot"
                :style="{ height: line.height, width: line.width }"
              >
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
                  decorative
                  class="line-tick"
                  :style="{ top: tick.y - 3.2, width: line.gutter - 5 }"
                >
                  {{ tick.value }}
                </PdfText>
                <PdfText
                  v-for="(month, index) in line.months"
                  :key="`lm-${index}`"
                  decorative
                  class="line-month"
                  :style="{ left: month.x - 8, top: line.baseline + 5 }"
                >
                  {{ month.label }}
                </PdfText>
                <PdfText
                  decorative
                  class="line-first"
                  :style="{ left: line.first.x, top: line.first.y }"
                >
                  {{ line.first.label }}
                </PdfText>
                <PdfText
                  decorative
                  class="line-last"
                  :style="{ left: line.last.x, top: line.last.y }"
                >
                  {{ line.last.label }}
                </PdfText>
              </PdfView>
            </PdfView>
          </PdfView>

          <!-- Donut chart: revenue by client sector, one highlighted. -->
          <PdfView>
            <PdfText
              tag="h3"
              class="chart-heading"
            >
              Revenue by client sector
            </PdfText>
            <!-- One figure: caption, donut and legend. The legend stands
                 beside the donut under the caption, so it is part of the
                 figure, and the figure's alt text gives every sector's share. -->
            <PdfView
              tag="figure"
              :alt="donut.alt"
            >
              <PdfView tag="caption">
                <PdfText class="chart-caption">
                  Share of total, EUR thousands
                </PdfText>
              </PdfView>

              <PdfView class="donut-row">
                <PdfView
                  class="donut"
                  :style="{ height: donut.size, width: donut.size }"
                >
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
                  <!-- The legend total below repeats the centre figure. -->
                  <PdfView
                    decorative
                    class="donut-center"
                  >
                    <PdfText class="donut-total">
                      {{ donut.totalLabel }}
                    </PdfText>
                    <PdfText class="donut-label">
                      Revenue
                    </PdfText>
                  </PdfView>
                </PdfView>

                <PdfView class="legend">
                  <PdfView
                    v-for="row in donut.legend"
                    :key="row.id"
                    class="legend-row"
                  >
                    <PdfView
                      class="legend-swatch"
                      :style="{ backgroundColor: row.color }"
                    />
                    <PdfText :class="['legend-label', { 'legend-label-highlight': row.highlight }]">
                      {{ row.label }}
                    </PdfText>
                    <PdfText class="legend-share">
                      {{ row.pct }}
                    </PdfText>
                  </PdfView>
                  <PdfView class="legend-total">
                    <PdfText class="legend-total-label">
                      Total
                    </PdfText>
                    <PdfText class="legend-total-value">
                      {{ donut.totalK }}
                    </PdfText>
                  </PdfView>
                </PdfView>
              </PdfView>
            </PdfView>
          </PdfView>
        </PdfView>
      </PdfView>

      <PdfText
        fixed
        class="footer footer-left"
      >
        {{ footerText }}
      </PdfText>
      <PdfText
        fixed
        class="footer footer-right"
      >
        <PdfPageNumber /> / <PdfPageCount />
      </PdfText>
    </PdfPage>

    <!-- 5 · Financial statements -->
    <PdfPage
      size="A4"
      class="page"
    >
      <PdfView
        fixed
        class="top-bar"
      />
      <PdfView
        id="financials"
        :bookmark="{ title: 'Financial Statements', expanded: true }"
        tag="section"
      >
        <PdfText class="eyebrow">
          Financial Statements
        </PdfText>
        <PdfText
          tag="h2"
          class="section-title"
        >
          Statement of operations
        </PdfText>
        <PdfText class="section-intro">
          For the year ended 31 December {{ report.fiscalYear }} · all figures in EUR thousands
        </PdfText>

        <PdfTable
          :columns="ledgerColumns"
          class="ledger"
        >
          <PdfTableHeader class="ledger-head">
            <PdfTableCell class="ledger-head-label">
              Statement line
            </PdfTableCell>
            <PdfTableCell
              align="right"
              class="ledger-head-current"
            >
              FY {{ report.fiscalYear }}
            </PdfTableCell>
            <PdfTableCell
              align="right"
              class="ledger-head-prior"
            >
              FY {{ report.priorYear }}
            </PdfTableCell>
          </PdfTableHeader>

          <PdfTableRow
            v-for="row in ledger"
            :key="row.id"
            :class="['ledger-row', row.kind]"
          >
            <PdfTableCell
              header
              class="ledger-label"
            >
              {{ row.label }}
            </PdfTableCell>
            <PdfTableCell
              align="right"
              class="ledger-current"
            >
              {{ row.current }}
            </PdfTableCell>
            <PdfTableCell
              align="right"
              class="ledger-prior"
            >
              {{ row.prior }}
            </PdfTableCell>
          </PdfTableRow>
        </PdfTable>

        <PdfView class="basis">
          <PdfText
            tag="h3"
            class="basis-label"
          >
            Basis of preparation
          </PdfText>
          <PdfText class="basis-text">
            Figures are unaudited management accounts rounded to the nearest thousand euro.
            Parentheses denote outflows. {{ report.registration }}.
          </PdfText>
        </PdfView>
      </PdfView>

      <PdfText
        fixed
        class="footer footer-left"
      >
        {{ footerText }}
      </PdfText>
      <PdfText
        fixed
        class="footer footer-right"
      >
        <PdfPageNumber /> / <PdfPageCount />
      </PdfText>
    </PdfPage>
  </PdfDocument>
</template>

<style>
/* The palette comes from components/annual/theme.ts, which the charts use too. */
:root {
  --ink: v-bind('ink.strong');
  --ink-soft: v-bind('ink.soft');
  --muted: v-bind('ink.muted');
  --accent: v-bind('accent.base');
  --hairline-strong: v-bind('paper.hairlineStrong');
  --paper: v-bind('paper.page');
  --font-body: Inter;
  --font-display: Lora;
  --page-margin: 54pt;
}
.cover-page {
  font-family: var(--font-body);
  background-color: var(--paper);
  color: var(--ink);
}

.cover {
  flex: 1;
  padding-top: 66pt;
  padding-horizontal: var(--page-margin);
}

/* Small-caps label above every section. */
.eyebrow {
  font-family: var(--font-body);
  font-size: 8pt;
  font-weight: 600;
  letter-spacing: 1.6pt;
  text-transform: uppercase;
  color: var(--accent);
}

.cover-company {
  margin-top: 10pt;
  font-family: var(--font-body);
  font-size: 15pt;
  font-weight: 600;
  color: var(--ink);
}

.cover-title-block {
  margin-top: 120pt;
}

.cover-year {
  font-family: var(--font-body);
  font-size: 138pt;
  font-weight: 800;
  letter-spacing: -2pt;
  color: var(--accent);
}

.cover-title {
  width: 380pt;
  margin-top: 6pt;
  font-family: var(--font-display);
  font-size: 30pt;
  color: var(--ink);
}

.cover-standfirst {
  width: 360pt;
  margin-top: 18pt;
  font-family: var(--font-display);
  font-size: 11.5pt;
  line-height: 1.6;
  color: var(--ink-soft);
}

.cover-band {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  flex-direction: row;
  justify-content: space-between;
  align-items: flex-end;
  padding-top: 24pt;
  padding-horizontal: var(--page-margin);
  padding-bottom: 26pt;
  background-color: var(--accent);
}

.cover-form {
  font-family: var(--font-body);
  font-size: 9pt;
  font-weight: 600;
  letter-spacing: 0.5pt;
  color: var(--paper);
}

.cover-registration {
  font-family: var(--font-body);
  font-size: 7.5pt;
  color: #CFE0D3;
}

.page {
  padding-top: 58pt;
  padding-horizontal: var(--page-margin);
  padding-bottom: 60pt;
  font-family: var(--font-body);
  font-size: 10pt;
  background-color: var(--paper);
  color: var(--ink);
}

.letter-page {
  padding-top: 84pt;
  padding-horizontal: 90pt;
}

.top-bar {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  height: 5pt;
  background-color: var(--accent);
}

.letter-salutation {
  width: 340pt;
  margin-top: 14pt;
  font-family: var(--font-display);
  font-size: 23pt;
  color: var(--ink);
}

.letter-body {
  width: 372pt;
  margin-top: 22pt;
}

.letter-paragraph {
  margin-bottom: 13pt;
  font-family: var(--font-display);
  font-size: 11pt;
  line-height: 1.62;
  color: var(--ink-soft);
}

.letter-signature {
  width: 240pt;
  margin-top: 20pt;
  padding-top: 16pt;
  border-top-width: 0.5pt;
  border-top-color: #D3DAD3;
}

.letter-author {
  font-family: var(--font-display);
  font-size: 15pt;
  font-style: italic;
  color: var(--ink);
}

.letter-role {
  margin-top: 5pt;
  font-family: var(--font-body);
  font-size: 8.5pt;
  color: var(--muted);
}

.footer {
  position: absolute;
  bottom: 30pt;
  font-family: var(--font-body);
  font-size: 7.5pt;
  color: var(--muted);
}

.footer-left {
  left: var(--page-margin);
}

.footer-right {
  right: var(--page-margin);
  text-align: right;
}

.section-title {
  margin-top: 8pt;
  font-family: var(--font-body);
  font-size: 21pt;
  font-weight: 700;
  color: var(--ink);
}

.section-intro {
  margin-top: 8pt;
  font-family: var(--font-body);
  font-size: 9.5pt;
  color: var(--muted);
}

.highlights-intro {
  width: 400pt;
  line-height: 1.5;
}

.kpi-grid {
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: space-between;
  margin-top: 26pt;
}

.kpi {
  width: 31.5%;
  margin-bottom: 16pt;
  padding-top: 13pt;
  padding-horizontal: 15pt;
  padding-bottom: 16pt;
  border-top-width: 2pt;
  border-top-color: var(--accent);
  background-color: #F2F5F1;
}

.kpi-label {
  font-family: var(--font-body);
  font-size: 7.5pt;
  font-weight: 600;
  letter-spacing: 1.1pt;
  text-transform: uppercase;
  color: var(--muted);
}

.kpi-value {
  margin-top: 11pt;
  font-family: var(--font-body);
  font-size: 25pt;
  font-weight: 700;
  color: var(--ink);
}

.kpi-change {
  flex-direction: row;
  align-items: center;
  margin-top: 10pt;
}

.kpi-triangle {
  width: 6pt;
  height: 5pt;
  margin-right: 4pt;
}

.kpi-delta {
  font-family: var(--font-body);
  font-size: 9pt;
  font-weight: 600;
}

.kpi-caption {
  margin-left: 6pt;
  font-family: var(--font-body);
  font-size: 8pt;
  color: var(--muted);
}

.chart {
  margin-top: 26pt;
}

.chart-heading {
  font-family: var(--font-body);
  font-size: 11pt;
  font-weight: 600;
  color: var(--ink);
}

.chart-caption {
  margin-top: 3pt;
  font-family: var(--font-body);
  font-size: 8pt;
  color: var(--muted);
}

.chart-plot {
  position: relative;
  margin-top: 12pt;
}

.bar-tick {
  position: absolute;
  left: 0;
  font-family: var(--font-body);
  font-size: 7pt;
  text-align: right;
  color: var(--muted);
}

.bar-value {
  position: absolute;
  width: 40pt;
  font-family: var(--font-body);
  font-size: 7pt;
  font-weight: 500;
  text-align: center;
  color: var(--ink-soft);
}

.bar-group {
  position: absolute;
  width: 40pt;
  font-family: var(--font-body);
  font-size: 8.5pt;
  font-weight: 500;
  text-align: center;
  color: var(--ink);
}

.bar-legend {
  position: absolute;
  top: -2pt;
  flex-direction: row;
  justify-content: flex-end;
}

.bar-legend-consulting {
  margin-right: 16pt;
  font-family: var(--font-body);
  font-size: 8pt;
  font-weight: 600;
  color: #223F2A;
}

.bar-legend-licensing {
  font-family: var(--font-body);
  font-size: 8pt;
  font-weight: 600;
  color: #6E9078;
}

.chart-row {
  flex-direction: row;
  justify-content: space-between;
  margin-top: 34pt;
}

.line-tick {
  position: absolute;
  left: 0;
  font-family: var(--font-body);
  font-size: 6.5pt;
  text-align: right;
  color: var(--muted);
}

.line-month {
  position: absolute;
  width: 16pt;
  font-family: var(--font-body);
  font-size: 6pt;
  text-align: center;
  color: var(--muted);
}

.line-first {
  position: absolute;
  font-family: var(--font-body);
  font-size: 7pt;
  color: var(--muted);
}

.line-last {
  position: absolute;
  width: 50pt;
  font-family: var(--font-body);
  font-size: 8.5pt;
  font-weight: 700;
  text-align: right;
  color: var(--accent);
}

.donut-row {
  flex-direction: row;
  align-items: center;
  width: 250pt;
  margin-top: 12pt;
}

.donut {
  position: relative;
}

.donut-center {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  justify-content: center;
  align-items: center;
}

.donut-total {
  font-family: var(--font-body);
  font-size: 15pt;
  font-weight: 700;
  color: var(--ink);
}

.donut-label {
  margin-top: 2pt;
  font-family: var(--font-body);
  font-size: 6.5pt;
  letter-spacing: 0.8pt;
  text-transform: uppercase;
  color: var(--muted);
}

.legend {
  flex: 1;
  padding-left: 10pt;
}

.legend-row {
  flex-direction: row;
  align-items: center;
  margin-bottom: 6pt;
}

.legend-swatch {
  width: 7pt;
  height: 7pt;
  margin-right: 6pt;
}

.legend-label {
  flex: 1;
  font-family: var(--font-body);
  font-size: 8pt;
  font-weight: 400;
  color: var(--ink-soft);
}

.legend-label-highlight {
  font-weight: 600;
  color: var(--ink);
}

.legend-share {
  width: 26pt;
  font-family: var(--font-body);
  font-size: 7.5pt;
  text-align: right;
  color: var(--muted);
}

.legend-total {
  flex-direction: row;
  margin-top: 2pt;
  padding-top: 6pt;
  border-top-width: 0.5pt;
  border-top-color: #D3DAD3;
}

.legend-total-label {
  flex: 1;
  font-family: var(--font-body);
  font-size: 7.5pt;
  color: var(--muted);
}

.legend-total-value {
  font-family: var(--font-body);
  font-size: 7.5pt;
  font-weight: 600;
  text-align: right;
  color: var(--ink);
}

.ledger {
  width: 420pt;
  margin-top: 26pt;
}

.ledger-head {
  flex-direction: row;
  align-items: flex-end;
  padding-bottom: 8pt;
}

.ledger-head-label {
  font-family: var(--font-body);
  font-size: 7.5pt;
  letter-spacing: 0.6pt;
  text-transform: uppercase;
  color: var(--muted);
}

.ledger-head-current {
  font-family: var(--font-body);
  font-size: 8pt;
  font-weight: 600;
  color: var(--ink);
}

.ledger-head-prior {
  font-family: var(--font-body);
  font-size: 8pt;
  color: var(--muted);
}

/* Row kinds: item, subtotal and total, set on the row; the cells follow it.
   Subtotal and total rows sit below a rule. */
.ledger-row {
  align-items: baseline;
  padding-bottom: 6pt;
}

.item {
  padding-top: 6pt;
}

.subtotal {
  margin-top: 6pt;
  padding-top: 7pt;
  border-top-width: 0.5pt;
  border-top-color: var(--hairline-strong);
}

.total {
  margin-top: 6pt;
  padding-top: 7pt;
  border-top-width: 0.75pt;
  border-top-color: var(--accent);
}

.ledger-label,
.ledger-current {
  font-size: 9pt;
  font-family: var(--font-body);
  color: var(--ink);
}

.ledger-prior {
  font-size: 8.5pt;
  font-family: var(--font-body);
  color: var(--muted);
}

.item .ledger-label {
  color: var(--ink-soft);
}

.subtotal .ledger-label,
.subtotal .ledger-current {
  font-weight: 600;
}

.total .ledger-label,
.total .ledger-current {
  font-size: 10.5pt;
  font-weight: 700;
}

.total .ledger-current {
  color: var(--accent);
}

.total .ledger-prior {
  font-size: 10pt;
}

.basis {
  width: 420pt;
  margin-top: 30pt;
  padding-left: 12pt;
  border-left-width: 2pt;
  border-left-color: var(--accent);
}

.basis-label {
  margin-bottom: 4pt;
  font-family: var(--font-body);
  font-size: 7.5pt;
  letter-spacing: 0.6pt;
  text-transform: uppercase;
  color: var(--muted);
}

.basis-text {
  font-family: var(--font-body);
  font-size: 8.5pt;
  line-height: 1.5;
  color: var(--ink-soft);
}
</style>
