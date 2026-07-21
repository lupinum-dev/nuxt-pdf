<script setup lang="ts">
import type { PdfStyleValue } from '../../../../src/module'

const image = new Uint8Array([1, 2, 3])
const showAccent = false
const nestedStyle = [
  { color: '#18251d', fontSize: 12 },
  [null, false, showAccent && { color: '#315d3b' }],
] as const satisfies PdfStyleValue
</script>

<template>
  <PdfDocument page-layout="singlePage">
    <PdfPage
      size="A4"
      :style="nestedStyle"
    >
      <PdfView :min-presence-ahead="24">
        <PdfImage :src="image" />

        <!-- @vue-expect-error PdfImage requires exactly one source alias. -->
        <PdfImage />

        <!-- @vue-expect-error PdfImage source aliases are mutually exclusive. -->
        <PdfImage
          :src="image"
          :source="image"
        />

        <PdfSvg view-box="0 0 10 10">
          <PdfDefs>
            <PdfClipPath id="clip">
              <PdfRect
                width="10"
                height="10"
              />
            </PdfClipPath>

            <!-- @vue-expect-error PdfClipPath requires an id. -->
            <PdfClipPath />
          </PdfDefs>

          <!-- @vue-expect-error PdfRect requires width and height. -->
          <PdfRect />
        </PdfSvg>
      </PdfView>
    </PdfPage>
  </PdfDocument>
</template>
