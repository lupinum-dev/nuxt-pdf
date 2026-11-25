<script setup lang="ts">
import ClassBadge from './components/ClassBadge.vue'
import ClassFrame from './components/ClassFrame.vue'

const props = defineProps<{ big: boolean, extra?: string }>()

definePdf({ title: 'Classes' })
</script>

<template>
  <PdfDocument>
    <PdfPage class="page">
      <PdfText class="huge small">
        StylesheetOrder
      </PdfText>
      <PdfText
        class="small"
        :style="{ fontSize: 30 }"
      >
        StyleWins
      </PdfText>
      <PdfText :class="['small', { huge: props.big }]">
        DynamicObject
      </PdfText>
      <PdfText :class="extra">
        DynamicValue
      </PdfText>
      <ClassBadge>BadgeOwn</ClassBadge>
      <ClassBadge class="huge">
        BadgePassed
      </ClassBadge>
      <ClassFrame>
        <PdfText class="huge">
          SlotContent
        </PdfText>
      </ClassFrame>
    </PdfPage>
  </PdfDocument>
</template>

<style>
.page { padding: 20pt }
.small { font-size: 10pt }
.huge { font-size: 24pt }
.listed, .small-again { font-size: 9pt }
</style>
