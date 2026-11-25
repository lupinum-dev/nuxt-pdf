<script setup lang="ts">
definePdf({})
</script>

<template>
  <PdfDocument>
    <PdfPage>
      <!-- eslint-disable-next-line vue/singleline-html-element-content-newline -- the class rewrite on this line must not move PdfPage's column -->
      <PdfView class="box"><PdfPage /></PdfView>
    </PdfPage>
  </PdfDocument>
</template>

<style>
.box { padding: 4pt }
</style>
