<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  height?: number
  ink?: string
  opacity?: number
  width?: number
}>(), {
  height: 595,
  ink: '#1B2229',
  opacity: 0.03,
  width: 842,
})

// A single oversized star watermark, filled at a whisper-low opacity so it reads
// as a faint deboss behind the composition and never competes with the ink. It
// echoes the seal's star motif to keep the page one visual system.
const star = computed(() => {
  const cx = props.width / 2
  const cy = props.height / 2
  const outerRadius = 188
  const innerRadius = 77

  return Array.from({ length: 10 }, (_, index) => {
    const radius = index % 2 === 0 ? outerRadius : innerRadius
    const angle = (index / 10) * Math.PI * 2 - Math.PI / 2
    const x = cx + radius * Math.cos(angle)
    const y = cy + radius * Math.sin(angle)
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
  }).join(' ') + ' Z'
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
      <PdfPath
        :d="star"
        :fill="ink"
        :fill-opacity="opacity"
      />
    </PdfSvg>
  </PdfView>
</template>
