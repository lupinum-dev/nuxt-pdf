<script setup lang="ts">
definePdf({})
</script>

<template>
  <PdfDocument>
    <PdfPage>
      <PdfTable :columns="[1]">
        <PdfTableRow>
          <PdfTableCell>One</PdfTableCell>
          <PdfTableCell>Two</PdfTableCell>
        </PdfTableRow>
      </PdfTable>
    </PdfPage>
  </PdfDocument>
</template>
