<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
definePdf({ title: 'Certificate of completion', language: 'en' })
</script>

<template>
  <PdfDocument
    creator="Author test"
    :creation-date="new Date('2026-11-03T08:00:00Z')"
  >
    <PdfPage
      size="A4"
      orientation="landscape"
      class="page"
    >
      <PdfSvg
        viewBox="0 0 794 12"
        :style="{ width: 794, height: 12 }"
      >
        <PdfRect
          x="0"
          y="0"
          width="794"
          height="12"
          fill="#7a1f2b"
        />
        <PdfRect
          x="0"
          y="4"
          width="794"
          height="1.5"
          fill="#d9b45a"
        />
      </PdfSvg>

      <PdfView class="middle">
        <PdfSvg
          viewBox="0 0 12 520"
          :style="{ width: 12, height: 520 }"
        >
          <PdfRect
            x="0"
            y="0"
            width="12"
            height="520"
            fill="#7a1f2b"
          />
          <PdfRect
            x="4"
            y="0"
            width="1.5"
            height="520"
            fill="#d9b45a"
          />
        </PdfSvg>

        <PdfView class="content">
          <PdfText class="kicker">
            Fieldwork Academy
          </PdfText>
          <PdfText class="title">
            Certificate of Completion
          </PdfText>
          <PdfText class="lead">
            This certifies that
          </PdfText>
          <PdfText class="name">
            Anna Berger
          </PdfText>
          <PdfText class="lead">
            has completed the course Field Mapping for Beginners
            with distinction on 3 November 2026.
          </PdfText>

          <PdfView class="footer">
            <PdfView class="sign">
              <PdfSvg
                viewBox="0 0 160 2"
                :style="{ width: 160, height: 2 }"
              >
                <PdfLine
                  x1="0"
                  y1="1"
                  x2="160"
                  y2="1"
                  stroke="#1c2a30"
                  stroke-width="1"
                />
              </PdfSvg>
              <PdfText class="caption">
                Mara Fieldwork, Director
              </PdfText>
            </PdfView>

            <PdfSvg
              viewBox="0 0 100 100"
              :style="{ width: 100, height: 100 }"
            >
              <PdfCircle
                cx="50"
                cy="50"
                r="48"
                fill="#7a1f2b"
              />
              <PdfCircle
                cx="50"
                cy="50"
                r="42"
                fill="none"
                stroke="#d9b45a"
                stroke-width="2"
              />
              <PdfPolygon
                points="50.0,16.0 55.9,31.9 72.8,32.6 59.5,43.1 64.1,59.4 50.0,50.0 35.9,59.4 40.5,43.1 27.2,32.6 44.1,31.9"
                fill="#d9b45a"
              />
              <PdfText
                :x="20"
                :y="76"
                fill="#ffffff"
                :style="{ fontFamily: 'Lora', fontSize: 8, fontWeight: 700 }"
              >
                VERIFIED 2026
              </PdfText>
            </PdfSvg>

            <PdfView class="sign">
              <PdfText class="date">
                3 November 2026
              </PdfText>
              <PdfSvg
                viewBox="0 0 160 2"
                :style="{ width: 160, height: 2 }"
              >
                <PdfLine
                  x1="0"
                  y1="1"
                  x2="160"
                  y2="1"
                  stroke="#1c2a30"
                  stroke-width="1"
                />
              </PdfSvg>
              <PdfText class="caption">
                Date of issue
              </PdfText>
            </PdfView>
          </PdfView>
        </PdfView>

        <PdfSvg
          viewBox="0 0 12 520"
          :style="{ width: 12, height: 520 }"
        >
          <PdfRect
            x="0"
            y="0"
            width="12"
            height="520"
            fill="#7a1f2b"
          />
          <PdfRect
            x="6.5"
            y="0"
            width="1.5"
            height="520"
            fill="#d9b45a"
          />
        </PdfSvg>
      </PdfView>

      <PdfSvg
        viewBox="0 0 794 12"
        :style="{ width: 794, height: 12 }"
      >
        <PdfRect
          x="0"
          y="0"
          width="794"
          height="12"
          fill="#7a1f2b"
        />
        <PdfRect
          x="0"
          y="6.5"
          width="794"
          height="1.5"
          fill="#d9b45a"
        />
      </PdfSvg>
    </PdfPage>
  </PdfDocument>
</template>

<style>
.page {
  hyphens: auto;
  padding: 24pt;
  font-family: Lora;
  font-size: 13pt;
  color: #1c2a30;
}
.middle {
  flex-direction: row;
  height: 520pt;
}
.content {
  flex: 1;
  align-items: center;
  justify-content: space-between;
  padding: 26pt 40pt 20pt;
}
.kicker {
  font-size: 11pt;
  letter-spacing: 3pt;
  text-transform: uppercase;
  color: #7a1f2b;
}
.title {
  font-size: 38pt;
  font-weight: 700;
  margin-top: 8pt;
}
.lead {
  text-align: center;
  margin-top: 10pt;
}
.name {
  font-size: 32pt;
  font-weight: 700;
  margin-top: 10pt;
  color: #7a1f2b;
}
.footer {
  flex-direction: row;
  justify-content: space-between;
  align-items: flex-end;
  width: 100%;
}
.sign {
  width: 160pt;
  align-items: center;
}
.caption {
  font-size: 10pt;
  margin-top: 4pt;
}
.date {
  font-size: 12pt;
  margin-bottom: 4pt;
}
</style>
