<script setup lang="ts">
import type { PaperFloat } from '../../../shared/paper'
import { paperTheme } from '../theme'

// The frame of a figure in the paper: the plot box with its axis labels and
// legend, and the numbered caption below. A chart passes its SVG drawing in
// the default slot and the positions of its ticks. The figure's alt text
// holds every value, so the labels around the drawing are decorative. The
// figure floats to the top or the bottom of its column.
defineProps<{
  id: string
  float: PaperFloat
  alt: string
  label: string
  caption: string
  width: number
  height: number
  /** The unit of the y axis, above it. */
  unit: string
  /** The unit of the x axis, below its right end. */
  xUnit?: string
  legend: { label: string, color: string, round?: boolean }[]
  yTicks: { value: number, y: number }[]
  /** Labels under the x axis: their centre and the room they get. */
  xTicks: { label: string, x: number, width: number }[]
  xTickTop: number
  /** The left edge of the plot area: the y tick labels end 5 pt before it. */
  plotLeft: number
}>()
</script>

<template>
  <PdfView
    :id="id"
    tag="figure"
    :alt="alt"
    class="paper-figure"
    :style="{ float }"
    :wrap="false"
  >
    <PdfView
      class="paper-plot"
      :style="{ width, height }"
    >
      <slot />
      <PdfText
        decorative
        class="paper-tick paper-unit"
      >
        {{ unit }}
      </PdfText>
      <PdfView
        decorative
        class="paper-legend"
      >
        <template
          v-for="entry in legend"
          :key="entry.label"
        >
          <PdfView
            class="paper-swatch"
            :style="{ backgroundColor: entry.color, borderRadius: entry.round ? 3 : 0 }"
          />
          <PdfText class="paper-legend-label">
            {{ entry.label }}
          </PdfText>
        </template>
      </PdfView>
      <PdfText
        v-for="tick in yTicks"
        :key="tick.value"
        decorative
        class="paper-tick paper-tick-y"
        :style="{ top: tick.y - 3.5, width: plotLeft - 5 }"
      >
        {{ tick.value }}
      </PdfText>
      <PdfText
        v-for="tick in xTicks"
        :key="tick.label"
        decorative
        class="paper-tick paper-tick-x"
        :style="{ left: tick.x - tick.width / 2, top: xTickTop, width: tick.width }"
      >
        {{ tick.label }}
      </PdfText>
      <PdfText
        v-if="xUnit"
        decorative
        class="paper-tick paper-x-unit"
        :style="{ top: xTickTop + 9 }"
      >
        {{ xUnit }}
      </PdfText>
    </PdfView>

    <PdfView tag="caption">
      <PdfText class="paper-caption">
        <!-- One line: a line break inside the label would print as a space. -->
        <!-- eslint-disable-next-line vue/singleline-html-element-content-newline -->
        <PdfText class="paper-caption-label">{{ label }}</PdfText>  {{ caption }}
      </PdfText>
    </PdfView>
  </PdfView>
</template>

<style>
:root {
  --ink: v-bind('paperTheme.ink');
  --muted: v-bind('paperTheme.muted');
  --label: v-bind('paperTheme.label');
}
.paper-figure {
  margin: 4pt 0 10pt;
}
.paper-plot {
  margin-top: 8pt;
}
.paper-tick {
  position: absolute;
  font-family: var(--label);
  font-size: 6.5pt;
  color: var(--muted);
}
.paper-unit {
  top: -2pt;
  left: 0;
}
.paper-tick-y {
  left: 0;
  text-align: right;
}
.paper-tick-x {
  text-align: center;
}
.paper-x-unit {
  right: 2pt;
}
.paper-legend {
  position: absolute;
  top: -2pt;
  right: 2pt;
  flex-direction: row;
  align-items: center;
}
.paper-swatch {
  width: 6pt;
  height: 6pt;
  margin-right: 3pt;
}
.paper-legend-label {
  margin-right: 8pt;
  font-family: var(--label);
  font-size: 6.5pt;
  color: var(--ink);
}
.paper-caption {
  margin-top: 6pt;
  font-family: var(--label);
  font-size: 7pt;
  line-height: 1.45;
  color: var(--muted);
}
.paper-caption-label {
  font-weight: 600;
  color: var(--ink);
}
</style>
