<script setup lang="ts">
import type { PaperFloat, PaperSite } from '../../../shared/paper'
import { paperTheme } from '../theme'
import PaperFigure from './PaperFigure.vue'

// Figure 2: one point per meadow and a least-squares trend line, drawn with
// SVG. The fit and R² are computed from the plotted points, so the drawing
// and the printed R² cannot disagree.
const props = defineProps<{ sites: PaperSite[], float: PaperFloat }>()

const size = { width: 234, height: 160 }
const plot = { left: 24, right: 230, top: 14, bottom: 138 }
const range = { x: [0, 20], y: [10, 60] } as const
const px = (lux: number) => plot.left + (lux - range.x[0]) / (range.x[1] - range.x[0]) * (plot.right - plot.left)
const py = (minutes: number) => plot.bottom - (minutes - range.y[0]) / (range.y[1] - range.y[0]) * (plot.bottom - plot.top)

const xs = props.sites.map(site => site.lux)
const ys = props.sites.map(site => site.onset)
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length
const mx = mean(xs)
const my = mean(ys)
const slope = xs.reduce((sum, x, i) => sum + (x - mx) * (ys[i]! - my), 0) / xs.reduce((sum, x) => sum + (x - mx) ** 2, 0)
const intercept = my - slope * mx
const residual = xs.reduce((sum, x, i) => sum + (ys[i]! - (intercept + slope * x)) ** 2, 0)
const r2 = 1 - residual / ys.reduce((sum, y) => sum + (y - my) ** 2, 0)
const trend = { x1: px(range.x[0]), y1: py(intercept), x2: px(range.x[1]), y2: py(intercept + slope * range.x[1]) }

const yTicks = [20, 40, 60].map(value => ({ value, y: py(value) }))
const xTicks = [0, 5, 10, 15, 20].map(value => ({ label: String(value), x: px(value), width: 20 }))
const points = props.sites.map(site => ({
  cx: px(site.lux),
  cy: py(site.onset),
  fill: site.type === 'urban' ? paperTheme.accent : paperTheme.secondary,
}))
const legend = [
  { label: 'Urban', color: paperTheme.accent, round: true },
  { label: 'Rural', color: paperTheme.secondary, round: true },
]

const alt = `Scatter plot of chorus onset in minutes before sunrise against artificial light at night in lux for twelve meadows, with a linear trend: onset = ${
  intercept.toFixed(1)} + ${slope.toFixed(2)} × lux, R² = ${r2.toFixed(2)}. Sites: ${
  props.sites.map(site => `${site.type} ${site.lux} lux, ${site.onset} min`).join('; ')}.`
</script>

<template>
  <PaperFigure
    id="fig-2"
    :float="float"
    :alt="alt"
    label="Fig. 2"
    caption="Chorus onset against artificial light at night. Each point is one meadow; the line is the least-squares fit over all twelve."
    :width="size.width"
    :height="size.height"
    unit="min before sunrise"
    x-unit="light at night, lux"
    :legend="legend"
    :y-ticks="yTicks"
    :x-ticks="xTicks"
    :x-tick-top="plot.bottom + 4"
    :plot-left="plot.left"
  >
    <PdfSvg
      :view-box="`0 0 ${size.width} ${size.height}`"
      :style="{ width: size.width, height: size.height }"
    >
      <PdfLine
        v-for="tick in yTicks"
        :key="tick.value"
        :x1="plot.left"
        :y1="tick.y"
        :x2="plot.right"
        :y2="tick.y"
        :stroke="paperTheme.grid"
        stroke-width="0.5"
      />
      <PdfLine
        :x1="plot.left"
        :y1="plot.bottom"
        :x2="plot.right"
        :y2="plot.bottom"
        :stroke="paperTheme.ink"
        stroke-width="0.6"
      />
      <PdfLine
        v-bind="trend"
        :stroke="paperTheme.ink"
        stroke-width="0.8"
      />
      <PdfCircle
        v-for="(point, index) in points"
        :key="index"
        :cx="point.cx"
        :cy="point.cy"
        r="2.8"
        :fill="point.fill"
        stroke="#FFFFFF"
        stroke-width="0.6"
      />
    </PdfSvg>
    <PdfText
      decorative
      class="paper-fit"
      :style="{ left: plot.left + 6, top: plot.top + 4 }"
    >
      <!-- eslint-disable-next-line vue/singleline-html-element-content-newline -->
      <PdfText class="paper-fit-symbol">R</PdfText><PdfText class="paper-fit-sup">2</PdfText> = {{ r2.toFixed(2) }}
    </PdfText>
  </PaperFigure>
</template>

<style>
:root {
  --ink: v-bind('paperTheme.ink');
  --label: v-bind('paperTheme.label');
  --reading: v-bind('paperTheme.reading');
}
.paper-fit {
  position: absolute;
  font-family: var(--label);
  font-size: 7pt;
  font-weight: 500;
  color: var(--ink);
}
.paper-fit-symbol {
  font-family: var(--reading);
  font-style: italic;
  font-weight: 400;
}
.paper-fit-sup {
  vertical-align: super;
  font-size: 70%;
}
</style>
