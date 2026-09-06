<template>
  <PdfText v-if="route.query.pdfMisuse">
    This belongs in a PDF template.
  </PdfText>
  <div v-else>
    basic
  </div>
</template>

<script setup>
const route = useRoute()
</script>
