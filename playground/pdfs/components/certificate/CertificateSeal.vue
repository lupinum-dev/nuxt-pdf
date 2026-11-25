<script setup lang="ts">
import { certificateTheme } from '../theme'

const props = withDefaults(defineProps<{
  /** The letter in the middle of the seal. */
  monogram: string
  size?: number
}>(), {
  size: 64,
})

// Two rings with a band of fine ticks between them, like the bezel of a watch.
const center = 32
const ticks = Array.from({ length: 72 }, (_, index) => {
  const angle = (index / 72) * Math.PI * 2
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return {
    x1: center + cos * 26.2,
    y1: center + sin * 26.2,
    x2: center + cos * 29.2,
    y2: center + sin * 29.2,
  }
})
const letterSize = props.size * 0.42
</script>

<template>
  <PdfView
    class="seal"
    :style="{ width: size, height: size }"
  >
    <PdfSvg
      class="seal-rings"
      :style="{ width: size, height: size }"
      view-box="0 0 64 64"
    >
      <PdfCircle
        :cx="center"
        :cy="center"
        r="31.4"
        fill="none"
        :stroke="certificateTheme.accent"
        stroke-width="0.6"
      />
      <PdfLine
        v-for="(tick, index) in ticks"
        :key="index"
        :x1="tick.x1"
        :y1="tick.y1"
        :x2="tick.x2"
        :y2="tick.y2"
        :stroke="certificateTheme.accent"
        stroke-width="0.35"
      />
      <PdfCircle
        :cx="center"
        :cy="center"
        r="24.4"
        fill="none"
        :stroke="certificateTheme.accent"
        stroke-width="0.6"
      />
    </PdfSvg>
    <PdfText
      class="seal-letter"
      :style="{ fontSize: letterSize }"
    >
      {{ monogram }}
    </PdfText>
  </PdfView>
</template>

<style>
:root {
  --accent: v-bind('certificateTheme.accent');
  --display: v-bind('certificateTheme.display');
}

.seal {
  align-items: center;
  justify-content: center;
}

.seal-rings {
  position: absolute;
  top: 0;
  left: 0;
}

.seal-letter {
  font-family: var(--display);
  font-style: italic;
  font-weight: 500;
  color: var(--accent);
}
</style>
