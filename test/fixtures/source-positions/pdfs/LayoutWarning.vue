<script setup lang="ts">
definePdf({})
</script>

<template>
  <PdfDocument>
    <PdfPage :style="{ padding: 30 }">
      <PdfText class="title">
        Source positions
      </PdfText>
      <PdfTable :columns="[2, 1]">
        <PdfTableHeader>
          <PdfTableCell>Item</PdfTableCell>
          <PdfTableCell align="right">
            Amount
          </PdfTableCell>
        </PdfTableHeader>
        <PdfTableRow
          v-for="row in 40"
          :key="row"
        >
          <PdfTableCell>Row {{ row }}</PdfTableCell>
          <PdfTableCell align="right">
            {{ row * 3 }}
          </PdfTableCell>
        </PdfTableRow>
      </PdfTable>
      <PdfView
        :wrap="false"
        :style="{ height: 800, minHeight: 800 }"
      >
        <PdfText>Too tall</PdfText>
      </PdfView>
    </PdfPage>
  </PdfDocument>
</template>

<style>
.title { font-size: 18pt; margin-bottom: 8pt }
</style>
