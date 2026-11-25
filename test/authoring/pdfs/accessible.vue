<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
defineProps<{ skipLevel?: boolean }>()

definePdf<{ skipLevel?: boolean }>({ title: 'Quarterly field report', language: 'en' })

const sites = [
  { name: 'North', carbon: 420, change: '+4 %' },
  { name: 'South', carbon: 380, change: '+1 %' },
  { name: 'East', carbon: 450, change: '+7 %' },
]
</script>

<template>
  <!-- eslint-disable vue/singleline-html-element-content-newline, vue/multiline-html-element-content-newline -->
  <PdfDocument
    conformance="PDF/UA-1"
    :creation-date="new Date('2026-11-03T08:00:00Z')"
  >
    <PdfPage
      size="A4"
      class="page"
    >
      <PdfText
        tag="h1"
        class="h1"
      >
        Quarterly field report
      </PdfText>
      <PdfText class="lead">
        Soil carbon rose on all three survey sites in the third quarter.
        The table lists the measured stocks.
      </PdfText>

      <PdfText
        :tag="skipLevel ? 'h4' : 'h2'"
        class="h2"
      >
        Results
      </PdfText>

      <PdfSvg
        viewBox="0 0 240 100"
        alt="Bar chart of carbon stock by site: North 420, South 380, East 450 tonnes per hectare."
        :style="{ width: 240, height: 100 }"
      >
        <PdfRect
          x="20"
          y="20"
          width="40"
          height="80"
          fill="#2f5d3a"
        />
        <PdfRect
          x="100"
          y="30"
          width="40"
          height="70"
          fill="#47734f"
        />
        <PdfRect
          x="180"
          y="14"
          width="40"
          height="86"
          fill="#2f5d3a"
        />
      </PdfSvg>

      <PdfTable
        :columns="[1, '90pt', '70pt']"
        class="table"
      >
        <PdfTableHeader class="head">
          <PdfTableCell>Site</PdfTableCell>
          <PdfTableCell align="right">
            Carbon (t/ha)
          </PdfTableCell>
          <PdfTableCell align="right">
            Change
          </PdfTableCell>
        </PdfTableHeader>
        <PdfTableRow
          v-for="site in sites"
          :key="site.name"
          class="row"
        >
          <PdfTableCell>{{ site.name }}</PdfTableCell>
          <PdfTableCell align="right">
            {{ site.carbon }}
          </PdfTableCell>
          <PdfTableCell align="right">
            {{ site.change }}
          </PdfTableCell>
        </PdfTableRow>
      </PdfTable>

      <PdfText
        tag="h2"
        class="h2"
      >
        Sources
      </PdfText>
      <PdfText>
        The sampling method is described in the
        <PdfLink
          href="https://example.com/field-report/method"
          class="link"
        >method notes</PdfLink>
        of the project.
      </PdfText>
    </PdfPage>
  </PdfDocument>
</template>

<style>
.page {
  hyphens: auto;
  padding: 56pt;
  font-family: Inter;
  font-size: 10.5pt;
  line-height: 1.45;
  color: #1c2a30;
}
.h1 {
  font-size: 22pt;
  font-weight: 700;
}
.lead {
  margin-top: 6pt;
}
.h2 {
  margin-top: 20pt;
  margin-bottom: 8pt;
  font-size: 14pt;
  font-weight: 700;
}
.table {
  margin-top: 16pt;
}
.head {
  font-weight: 700;
  border-bottom: 1pt solid #1c2a30;
  padding-bottom: 4pt;
}
.row {
  padding: 5pt 0;
  border-bottom: 0.5pt solid #d5dde0;
}
.link {
  color: #1f4e5f;
  text-decoration: underline;
}
</style>
