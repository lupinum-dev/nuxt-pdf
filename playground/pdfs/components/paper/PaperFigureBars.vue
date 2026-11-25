<script setup lang="ts">
import type { PaperFloat, PaperSpecies } from '../../../shared/paper'
import { paperTheme } from '../theme'
import PaperFigure from './PaperFigure.vue'

// Figure 1: grouped bars with error bars, drawn with SVG.
const props = defineProps<{ species: PaperSpecies[], float: PaperFloat }>()

const size = { width: 234, height: 160 }
const plot = { left: 24, right: 232, top: 14, bottom: 140 }
const max = 60
const y = (minutes: number) => plot.bottom - (minutes / max) * (plot.bottom - plot.top)
const yTicks = [0, 20, 40, 60].map(value => ({ value, y: y(value) }))

const groupWidth = (plot.right - plot.left) / props.species.length
const barWidth = 15
const groups = props.species.map((entry, index) => {
  const center = plot.left + groupWidth * (index + 0.5)
  const bars = [
    { x: center - barWidth - 1, value: entry.urban, error: entry.urbanError, fill: paperTheme.accent },
    { x: center + 1, value: entry.rural, error: entry.ruralError, fill: paperTheme.secondary },
  ].map(bar => ({
    ...bar,
    top: y(bar.value),
    whisker: { x: bar.x + barWidth / 2, high: y(bar.value + bar.error), low: y(bar.value - bar.error) },
  }))
  return { name: entry.name, center, bars }
})
const xTicks = groups.map(group => ({ label: group.name, x: group.center, width: groupWidth }))
const legend = [
  { label: 'Urban', color: paperTheme.accent },
  { label: 'Rural', color: paperTheme.secondary },
]

const alt = `Bar chart of dawn chorus onset in minutes before sunrise, urban and rural meadows, mean ± standard error: ${
  props.species.map(entry => `${entry.name} ${entry.urban} ± ${entry.urbanError} urban, ${entry.rural} ± ${entry.ruralError} rural`).join('; ')}.`
</script>

<template>
  <PaperFigure
    id="fig-1"
    :float="float"
    :alt="alt"
    label="Fig. 1"
    caption="Chorus onset before sunrise by species. Bars show means of six meadows per type, whiskers one standard error."
    :width="size.width"
    :height="size.height"
    unit="min before sunrise"
    :legend="legend"
    :y-ticks="yTicks"
    :x-ticks="xTicks"
    :x-tick-top="plot.bottom + 5"
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
        :stroke="tick.value === 0 ? paperTheme.ink : paperTheme.grid"
        :stroke-width="tick.value === 0 ? 0.6 : 0.5"
      />
      <template
        v-for="group in groups"
        :key="group.name"
      >
        <template
          v-for="bar in group.bars"
          :key="bar.x"
        >
          <PdfRect
            :x="bar.x"
            :y="bar.top"
            :width="barWidth"
            :height="plot.bottom - bar.top"
            :fill="bar.fill"
          />
          <PdfLine
            :x1="bar.whisker.x"
            :y1="bar.whisker.high"
            :x2="bar.whisker.x"
            :y2="bar.whisker.low"
            :stroke="paperTheme.ink"
            stroke-width="0.6"
          />
          <PdfLine
            :x1="bar.whisker.x - 2.5"
            :y1="bar.whisker.high"
            :x2="bar.whisker.x + 2.5"
            :y2="bar.whisker.high"
            :stroke="paperTheme.ink"
            stroke-width="0.6"
          />
        </template>
      </template>
    </PdfSvg>
  </PaperFigure>
</template>
