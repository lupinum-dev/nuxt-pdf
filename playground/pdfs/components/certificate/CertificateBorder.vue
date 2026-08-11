<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  height?: number
  ink?: string
  inset?: number
  width?: number
}>(), {
  height: 595,
  ink: '#7E5F2B',
  inset: 40,
  width: 842,
})

// Double-rule engraver's border with mitred corner joins and four small corner
// diamonds. Drawn as one absolute full-bleed SVG in the page's user space so the
// content flows above it untouched.
const gap = 6
const outer = computed(() => ({
  height: props.height - props.inset * 2,
  width: props.width - props.inset * 2,
  x: props.inset,
  y: props.inset,
}))
const inner = computed(() => ({
  height: props.height - (props.inset + gap) * 2,
  width: props.width - (props.inset + gap) * 2,
  x: props.inset + gap,
  y: props.inset + gap,
}))
const corners = computed(() => {
  const diamondRadius = 4
  const { height, width, x, y } = inner.value

  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ].map(corner =>
    `M ${corner.x} ${corner.y - diamondRadius} `
    + `L ${corner.x + diamondRadius} ${corner.y} `
    + `L ${corner.x} ${corner.y + diamondRadius} `
    + `L ${corner.x - diamondRadius} ${corner.y} Z`,
  )
})
</script>

<template>
  <PdfView
    :style="{
      height,
      left: 0,
      position: 'absolute',
      top: 0,
      width,
    }"
  >
    <PdfSvg
      :style="{ height, width }"
      :view-box="`0 0 ${width} ${height}`"
    >
      <PdfRect
        fill="none"
        :height="outer.height"
        :stroke="ink"
        :stroke-width="1.5"
        stroke-linejoin="miter"
        :width="outer.width"
        :x="outer.x"
        :y="outer.y"
      />
      <PdfRect
        fill="none"
        :height="inner.height"
        :stroke="ink"
        :stroke-width="0.5"
        stroke-linejoin="miter"
        :width="inner.width"
        :x="inner.x"
        :y="inner.y"
      />
      <PdfPath
        v-for="(corner, index) in corners"
        :key="`corner-${index}`"
        :d="corner"
        :fill="ink"
      />
    </PdfSvg>
  </PdfView>
</template>
