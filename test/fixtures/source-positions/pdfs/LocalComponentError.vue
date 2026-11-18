<script setup lang="ts">
import MissingHref from './components/MissingHref.vue'

definePdf({})
</script>

<template>
  <PdfDocument>
    <PdfPage>
      <MissingHref />
    </PdfPage>
  </PdfDocument>
</template>
