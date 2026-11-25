<script setup lang="ts">
import { ebookTheme } from '../theme'

// The cover drawing: a stand of reeds over one accent waterline, drawn as
// curved strokes straight on the paper. Sizes are points inside the drawing.
const panel = { width: 316, height: 264, water: 198 }

// x: root, height: above the water, lean: sideways shift of the tip,
// head: whether the stem carries a seed head (else it is a plain blade).
const stand = [
  [30, 70, -6, false], [44, 104, 4, true], [56, 82, -10, false], [68, 128, 6, true],
  [82, 92, 12, false], [94, 116, -4, true], [108, 140, 8, true], [120, 76, -12, false],
  [134, 108, 10, true], [148, 132, -6, true], [160, 88, 14, false], [174, 120, 4, true],
  [188, 96, -10, false], [200, 136, 8, true], [214, 84, 12, false], [228, 112, -6, true],
  [242, 72, -12, false], [254, 100, 6, true], [268, 80, 10, false], [284, 92, -4, true],
] as const

const reeds = stand.map(([x, height, lean, head]) => {
  const tipX = x + lean
  const tipY = panel.water - height
  // The stem bends near its tip; the head follows the last part of the bend.
  const control = { x, y: tipY + height * 0.45 }
  const length = Math.hypot(tipX - control.x, tipY - control.y)
  const headLength = 15
  return {
    x,
    stem: `M ${x} ${panel.water} Q ${control.x} ${control.y} ${tipX} ${tipY}`,
    head: head
      ? {
          x1: tipX - (tipX - control.x) / length * headLength,
          y1: tipY - (tipY - control.y) / length * headLength,
          x2: tipX - (tipX - control.x) / length * 3,
          y2: tipY - (tipY - control.y) / length * 3,
        }
      : undefined,
    reflection: `M ${x} ${panel.water + 6} L ${x - lean * 0.3} ${panel.water + 6 + height * 0.28}`,
  }
})
const reedStroke = ebookTheme.reed
const reedHead = ebookTheme.ink
const reflection = ebookTheme.hairline
</script>

<template>
  <PdfSvg
    :style="{ width: panel.width, height: panel.height }"
    decorative
    :view-box="`0 0 ${panel.width} ${panel.height}`"
  >
    <PdfPath
      v-for="reed in reeds"
      :key="reed.x"
      :d="reed.stem"
      fill="none"
      :stroke="reedStroke"
      stroke-width="1"
      stroke-linecap="round"
    />
    <template
      v-for="reed in reeds"
      :key="`h-${reed.x}`"
    >
      <PdfLine
        v-if="reed.head"
        :x1="reed.head.x1"
        :y1="reed.head.y1"
        :x2="reed.head.x2"
        :y2="reed.head.y2"
        :stroke="reedHead"
        stroke-width="4.5"
        stroke-linecap="round"
      />
    </template>
    <PdfPath
      v-for="reed in reeds"
      :key="`r-${reed.x}`"
      :d="reed.reflection"
      fill="none"
      :stroke="reflection"
      stroke-width="1"
      stroke-linecap="round"
    />
    <PdfLine
      x1="20"
      :y1="panel.water"
      :x2="panel.width - 20"
      :y2="panel.water"
      :stroke="ebookTheme.accent"
      stroke-width="1.5"
      stroke-linecap="round"
    />
  </PdfSvg>
</template>
