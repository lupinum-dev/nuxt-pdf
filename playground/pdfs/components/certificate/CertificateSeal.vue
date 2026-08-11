<script setup lang="ts">
withDefaults(defineProps<{
  size?: number
}>(), {
  size: 82,
})

// A self-contained wax-and-foil seal drawn purely in SVG: two concentric rules,
// a beaded coin edge, a single bronze radial gradient, a hairline inner keyline,
// and a crisp five-point star.
const bronzeDeep = '#7E5F2B'
const cream = '#F4EAD0'

const beads = Array.from({ length: 32 }, (_, index) => {
  const angle = (index / 32) * Math.PI * 2 - Math.PI / 2
  return {
    cx: 50 + 45.2 * Math.cos(angle),
    cy: 50 + 45.2 * Math.sin(angle),
  }
})

const star
  = 'M 50 35 L 53.82 44.74 L 64.27 45.37 L 56.18 52.01 L 58.82 62.14 '
    + 'L 50 56.5 L 41.18 62.14 L 43.82 52.01 L 35.73 45.37 L 46.18 44.74 Z'
</script>

<template>
  <PdfSvg
    :style="{ height: size, width: size }"
    view-box="0 0 100 100"
  >
    <PdfDefs>
      <PdfRadialGradient
        id="seal-bronze"
        cx="0.5"
        cy="0.38"
        r="0.62"
      >
        <PdfStop
          offset="0"
          stop-color="#E7CC86"
        />
        <PdfStop
          offset="0.55"
          stop-color="#C9A24B"
        />
        <PdfStop
          offset="1"
          stop-color="#8A6A2F"
        />
      </PdfRadialGradient>
    </PdfDefs>

    <PdfCircle
      :cx="50"
      :cy="50"
      fill="none"
      :r="47"
      :stroke="bronzeDeep"
      :stroke-width="1.4"
    />
    <PdfCircle
      :cx="50"
      :cy="50"
      fill="url(#seal-bronze)"
      :r="43.5"
    />
    <PdfCircle
      v-for="(bead, index) in beads"
      :key="`bead-${index}`"
      :cx="bead.cx"
      :cy="bead.cy"
      :fill="bronzeDeep"
      :r="0.75"
    />
    <PdfCircle
      :cx="50"
      :cy="50"
      fill="none"
      :r="38.5"
      :stroke="cream"
      :stroke-width="0.7"
    />
    <PdfPath
      :d="star"
      :fill="cream"
      :stroke="bronzeDeep"
      :stroke-width="0.5"
      stroke-linejoin="miter"
    />
  </PdfSvg>
</template>
