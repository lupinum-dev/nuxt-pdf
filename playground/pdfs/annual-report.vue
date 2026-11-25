<script setup lang="ts">
import type { AnnualReport, Kpi } from '../shared/annual'
import { boardCutReport, buildKpis, sampleAnnualReport } from '../shared/annual'
import { barModel, donutModel, ledgerView, lineModel } from './components/annual/models'
import { chart } from './components/annual/theme'
import { theme } from './components/theme'

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

// Direction sets the triangle orientation; a favorable change is in the
// accent, an unfavorable one stays neutral.
const triangleFor = (kpi: Kpi): string => (kpi.direction === 'up' ? '3,0 6,5 0,5' : '0,0 6,0 3,5')
const deltaColorFor = (kpi: Kpi): string => (kpi.favorable ? theme.accent : theme.mutedForeground)

// The cover's bar motif: eight rounded bars rising to the year's result.
const coverBars = [34, 42, 39, 52, 58, 66, 74, 92].map((height, index, all) => ({
  x: index * 18,
  y: 92 - height,
  height,
  fill: index === all.length - 1 ? theme.accent : index < 4 ? theme.border : '#D4D4D8',
}))

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
        <PdfView class="cover-head">
          <PdfText class="cover-company">
            {{ report.company }}
          </PdfText>
          <PdfView class="badge">
            <PdfText class="badge-text">
              {{ report.cover.eyebrow }} · {{ report.edition }}
            </PdfText>
          </PdfView>
        </PdfView>

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

      <PdfSvg
        decorative
        view-box="0 0 138 92"
        class="cover-bars"
      >
        <PdfRect
          v-for="(b, index) in coverBars"
          :key="index"
          :x="b.x"
          :y="b.y"
          width="12"
          :height="b.height"
          rx="3"
          :fill="b.fill"
        />
      </PdfSvg>

      <PdfView class="card cover-band">
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
        <!-- Headline and body stay ragged-right without mid-word breaks:
             hyphenated display type reads as a defect. The page sets hyphens: auto. -->
        <PdfText
          :style="{ hyphens: 'manual' }"
          class="letter-salutation"
        >
          {{ report.letter.salutation }}
        </PdfText>

        <PdfView class="letter-body">
          <PdfText
            v-for="(paragraph, index) in report.letter.paragraphs"
            :key="index"
            :style="{ hyphens: 'manual' }"
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
          class="kpi-grid tabular"
        >
          <PdfView
            v-for="kpi in kpis"
            :key="kpi.id"
            :wrap="false"
            tag="list-item"
            class="card kpi"
          >
            <PdfText class="kpi-label">
              {{ kpi.label }}
            </PdfText>
            <PdfText class="kpi-value">
              {{ kpi.value }}
            </PdfText>
            <PdfView class="kpi-change">
              <!-- The delta text carries the sign; the triangle repeats it. -->
              <PdfView :class="kpi.favorable ? 'badge badge-accent kpi-badge' : 'badge kpi-badge'">
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
              </PdfView>
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
        <PdfView class="card tabular chart chart-wide">
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
                Consulting and licensing, USD thousands
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
                  :stroke="tick.value === 0 ? chart.axis : chart.grid"
                  :stroke-width="tick.value === 0 ? 0.75 : 0.5"
                />
                <PdfPath
                  v-for="(b, index) in bar.bars"
                  :key="`br-${index}`"
                  :d="b.d"
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
                <PdfView class="legend-item">
                  <PdfView
                    class="legend-swatch"
                    :style="{ backgroundColor: chart.accent }"
                  />
                  <PdfText class="bar-legend-label">
                    Consulting
                  </PdfText>
                </PdfView>
                <PdfView class="legend-item">
                  <PdfView
                    class="legend-swatch"
                    :style="{ backgroundColor: chart.secondary }"
                  />
                  <PdfText class="bar-legend-label">
                    Licensing
                  </PdfText>
                </PdfView>
              </PdfView>
            </PdfView>
          </PdfView>
        </PdfView>

        <PdfView class="chart-row">
          <!-- Line + area chart: recurring revenue. -->
          <PdfView class="card tabular chart">
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
                  Monthly, USD thousands
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
                        :stop-color="chart.areaTop"
                      />
                      <PdfStop
                        offset="1"
                        :stop-color="chart.areaBottom"
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
                    :stroke="tick.value === 0 ? chart.axis : chart.grid"
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
                      :stroke="chart.accent"
                      stroke-width="1.75"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                    <PdfCircle
                      :cx="line.dotX"
                      :cy="line.dotY"
                      r="2.6"
                      :fill="chart.accent"
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
          <PdfView class="card tabular chart chart-donut">
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
                  Share of total, USD thousands
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
          For the year ended 31 December {{ report.fiscalYear }} · all figures in USD thousands
        </PdfText>

        <!-- The ledger always fits on this page, so it sits in a card. -->
        <PdfView class="card ledger-card tabular">
          <PdfTable :columns="ledgerColumns">
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
        </PdfView>

        <PdfView class="card basis">
          <PdfText
            tag="h3"
            class="basis-label"
          >
            Basis of preparation
          </PdfText>
          <PdfText class="basis-text">
            Figures are unaudited management accounts rounded to the nearest thousand dollars.
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
@import './components/theme.css';

/* The shared colours and radii (components/theme.ts); the charts read the
   same values through components/annual/theme.ts. */
:root {
  --foreground: v-bind('theme.foreground');
  --muted-foreground: v-bind('theme.mutedForeground');
  --border: v-bind('theme.border');
  --muted: v-bind('theme.muted');
  --subtle: v-bind('theme.subtle');
  --accent: v-bind('theme.accent');
  --accent-soft: v-bind('theme.accentSoft');
  --accent-border: v-bind('theme.accentBorder');
  --radius: v-bind('theme.radius');
  --radius-small: v-bind('theme.radiusSmall');
  --page-margin: 48pt;
}
.cover-page {
  hyphens: auto;
  font-family: "Inter";
  background-color: #FFFFFF;
  color: var(--foreground);
}

.cover {
  flex: 1;
  padding-top: 56pt;
  padding-horizontal: var(--page-margin);
}

.cover-head {
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
}

.cover-company {
  font-size: 13pt;
  font-weight: 600;
  letter-spacing: -0.3pt;
}

.cover-head .badge {
  align-self: center;
}

.cover-title-block {
  margin-top: 150pt;
}

.cover-year {
  font-size: 132pt;
  font-weight: 700;
  letter-spacing: -6pt;
  line-height: 1;
}

.cover-title {
  width: 400pt;
  margin-top: 18pt;
  font-size: 30pt;
  font-weight: 600;
  letter-spacing: -0.9pt;
  line-height: 1.15;
}

.cover-standfirst {
  width: 360pt;
  margin-top: 14pt;
  font-size: 11.5pt;
  line-height: 1.6;
  color: var(--muted-foreground);
}

.cover-bars {
  position: absolute;
  right: var(--page-margin);
  bottom: 120pt;
  width: 138pt;
  height: 92pt;
}

.cover-band {
  position: absolute;
  right: var(--page-margin);
  bottom: 48pt;
  left: var(--page-margin);
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  padding: 14pt 16pt;
  background-color: var(--subtle);
}

.cover-form {
  font-size: 9pt;
  font-weight: 600;
}

.cover-registration {
  font-size: 7.5pt;
  color: var(--muted-foreground);
}

.page {
  hyphens: auto;
  padding-top: 56pt;
  padding-horizontal: var(--page-margin);
  padding-bottom: 60pt;
  font-family: "Inter";
  font-size: 10pt;
  background-color: #FFFFFF;
  color: var(--foreground);
}

.letter-page {
  padding-top: 84pt;
  padding-horizontal: 90pt;
}

/* The line above every section title: small, medium weight, muted. */
.eyebrow {
  font-size: 8.5pt;
  font-weight: 500;
  color: var(--muted-foreground);
}

.letter-salutation {
  width: 360pt;
  margin-top: 8pt;
  font-size: 22pt;
  font-weight: 600;
  letter-spacing: -0.6pt;
  line-height: 1.2;
}

.letter-body {
  width: 400pt;
  margin-top: 22pt;
}

.letter-paragraph {
  margin-bottom: 12pt;
  font-size: 10.5pt;
  line-height: 1.65;
}

.letter-signature {
  width: 240pt;
  margin-top: 18pt;
  padding-top: 14pt;
  border-top: 1pt solid var(--border);
}

.letter-author {
  font-size: 11pt;
  font-weight: 600;
}

.letter-role {
  margin-top: 3pt;
  font-size: 8.5pt;
  color: var(--muted-foreground);
}

.footer {
  position: absolute;
  bottom: 30pt;
  font-size: 7.5pt;
  color: var(--muted-foreground);
}

.footer-left {
  left: var(--page-margin);
}

.footer-right {
  right: var(--page-margin);
  text-align: right;
}

.section-title {
  margin-top: 4pt;
  font-size: 22pt;
  font-weight: 600;
  letter-spacing: -0.6pt;
}

.section-intro {
  margin-top: 6pt;
  font-size: 9.5pt;
  color: var(--muted-foreground);
}

.highlights-intro {
  width: 400pt;
  line-height: 1.5;
}

.kpi-grid {
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: space-between;
  margin-top: 24pt;
}

.kpi {
  width: 32%;
  margin-bottom: 10pt;
  padding: 14pt 14pt 13pt;
}

.kpi-label {
  font-size: 8pt;
  font-weight: 500;
  color: var(--muted-foreground);
}

.kpi-value {
  margin-top: 8pt;
  font-size: 24pt;
  font-weight: 600;
  letter-spacing: -0.8pt;
}

.kpi-change {
  flex-direction: row;
  align-items: center;
  margin-top: 10pt;
}

.kpi-badge {
  flex-direction: row;
  align-items: center;
  padding: 2pt 6pt;
}

.kpi-triangle {
  width: 5pt;
  height: 4pt;
  margin-right: 3pt;
}

.kpi-delta {
  font-size: 7.5pt;
  font-weight: 600;
}

.kpi-caption {
  margin-left: 6pt;
  font-size: 7.5pt;
  color: var(--muted-foreground);
}

.chart {
  padding: 14pt;
}

.chart-wide {
  margin-top: 22pt;
}

.chart-heading {
  font-size: 10.5pt;
  font-weight: 600;
  letter-spacing: -0.2pt;
}

.chart-caption {
  margin-top: 2pt;
  font-size: 8pt;
  color: var(--muted-foreground);
}

.chart-plot {
  position: relative;
  margin-top: 12pt;
}

.bar-tick {
  position: absolute;
  left: 0;
  font-size: 7pt;
  text-align: right;
  color: var(--muted-foreground);
}

.bar-value {
  position: absolute;
  width: 40pt;
  font-size: 7pt;
  font-weight: 500;
  text-align: center;
  color: var(--muted-foreground);
}

.bar-group {
  position: absolute;
  width: 40pt;
  font-size: 8pt;
  font-weight: 500;
  text-align: center;
}

.bar-legend {
  position: absolute;
  top: -4pt;
  flex-direction: row;
  justify-content: flex-end;
}

.legend-item {
  flex-direction: row;
  align-items: center;
  margin-left: 14pt;
}

.bar-legend-label {
  font-size: 8pt;
  font-weight: 500;
}

.chart-row {
  flex-direction: row;
  justify-content: space-between;
  margin-top: 12pt;
}

.chart-donut {
  flex: 1;
  margin-left: 12pt;
}

.line-tick {
  position: absolute;
  left: 0;
  font-size: 6.5pt;
  text-align: right;
  color: var(--muted-foreground);
}

.line-month {
  position: absolute;
  width: 16pt;
  font-size: 6pt;
  text-align: center;
  color: var(--muted-foreground);
}

.line-first {
  position: absolute;
  font-size: 7pt;
  color: var(--muted-foreground);
}

.line-last {
  position: absolute;
  width: 50pt;
  font-size: 8.5pt;
  font-weight: 600;
  text-align: right;
  color: var(--accent);
}

.donut-row {
  flex-direction: row;
  align-items: center;
  margin-top: 14pt;
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
  font-size: 14pt;
  font-weight: 600;
  letter-spacing: -0.4pt;
}

.donut-label {
  margin-top: 1pt;
  font-size: 6.5pt;
  color: var(--muted-foreground);
}

.legend {
  flex: 1;
  padding-left: 12pt;
}

.legend-row {
  flex-direction: row;
  align-items: center;
  margin-bottom: 6pt;
}

.legend-swatch {
  width: 7pt;
  height: 7pt;
  margin-right: 5pt;
  border-radius: 2pt;
}

.legend-label {
  flex: 1;
  font-size: 8pt;
  color: var(--muted-foreground);
}

.legend-label-highlight {
  font-weight: 600;
  color: var(--foreground);
}

.legend-share {
  width: 26pt;
  font-size: 7.5pt;
  text-align: right;
  color: var(--muted-foreground);
}

.legend-total {
  flex-direction: row;
  margin-top: 2pt;
  padding-top: 6pt;
  border-top: 1pt solid var(--border);
}

.legend-total-label {
  flex: 1;
  font-size: 7.5pt;
  color: var(--muted-foreground);
}

.legend-total-value {
  font-size: 7.5pt;
  font-weight: 600;
  text-align: right;
}

.ledger-card {
  margin-top: 22pt;
  padding: 0 16pt;
}

.ledger-head {
  flex-direction: row;
  align-items: flex-end;
  padding-top: 11pt;
  padding-bottom: 9pt;
}

.ledger-head-label {
  font-size: 7.5pt;
  font-weight: 500;
  color: var(--muted-foreground);
}

.ledger-head-current {
  font-size: 7.5pt;
  font-weight: 600;
}

.ledger-head-prior {
  font-size: 7.5pt;
  font-weight: 500;
  color: var(--muted-foreground);
}

/* Row kinds: item, subtotal and total, set on the row; the cells follow it.
   A divider sits above every row; subtotal and total rows are bolder. */
.ledger-row {
  align-items: baseline;
  padding-top: 7pt;
  padding-bottom: 7pt;
  border-top: 1pt solid var(--border);
}

.subtotal {
  padding-top: 8pt;
}

.total {
  padding-top: 10pt;
  padding-bottom: 10pt;
}

.ledger-label,
.ledger-current {
  font-size: 9pt;
}

.ledger-prior {
  font-size: 8.5pt;
  color: var(--muted-foreground);
}

.item .ledger-label {
  color: var(--muted-foreground);
}

.subtotal .ledger-label,
.subtotal .ledger-current {
  font-weight: 600;
}

.total .ledger-label,
.total .ledger-current {
  font-size: 10.5pt;
  font-weight: 600;
}

.total .ledger-prior {
  font-size: 10pt;
}

/* A shadcn Alert: a bordered rounded box with a title and a description. */
.basis {
  margin-top: 14pt;
  padding: 11pt 14pt;
}

.basis-label {
  margin-bottom: 3pt;
  font-size: 8.5pt;
  font-weight: 600;
}

.basis-text {
  font-size: 8.5pt;
  line-height: 1.5;
  color: var(--muted-foreground);
}
</style>
