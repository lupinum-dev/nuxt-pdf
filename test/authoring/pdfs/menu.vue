<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
definePdf({ title: 'Speisekarte / Carte', language: 'de' })

const sections = [
  {
    title: 'Vorspeisen / Entrées',
    dishes: [
      { name: 'Œufs mayonnaise', note: 'Eier, hausgemachte Mayonnaise, Schnittlauch', price: '7,50 €' },
      { name: 'Soupe à l’oignon gratinée', note: 'Zwiebelsuppe mit Käsekruste', price: '8,90 €' },
      { name: 'Käsespätzle mit Röstzwiebeln', note: 'Bergkäse, Röstzwiebeln', price: '11,50 €' },
    ],
  },
  {
    title: 'Hauptgerichte / Plats',
    dishes: [
      { name: 'Gebratene Forelle Müllerin Art', note: 'Butterkartoffeln, Zitrone', price: '18,50 €' },
      { name: 'Cassoulet de Toulouse', note: 'Weiße Bohnen, Confit de canard', price: '21,00 €' },
      { name: 'Schweinshaxe mit Sauerkraut', note: 'Knödel, dunkle Bratensoße', price: '19,80 €' },
    ],
  },
  {
    title: 'Nachspeisen / Desserts',
    dishes: [
      { name: 'Crème brûlée à la lavande', note: 'Karamellkruste, Lavendelblüten', price: '7,90 €' },
      { name: 'Apfelstrudel mit Vanillesoße', note: 'Rosinen, Zimt, Sahne', price: '6,80 €' },
      { name: 'Fondant au chocolat', note: 'Warmer Schokoladenkuchen, Crème fraîche', price: '8,20 €' },
    ],
  },
]
</script>

<template>
  <PdfDocument
    creator="Author test"
    :creation-date="new Date('2026-11-03T08:00:00Z')"
  >
    <PdfPage
      size="A5"
      class="page"
    >
      <PdfText class="title">
        Gasthaus zum Löwen
      </PdfText>
      <PdfText class="subtitle">
        Speisekarte · Carte du jour
      </PdfText>

      <PdfView
        v-for="section in sections"
        :key="section.title"
        class="section"
      >
        <PdfText class="heading">
          {{ section.title }}
        </PdfText>
        <PdfView
          v-for="dish in section.dishes"
          :key="dish.name"
          class="dish"
        >
          <PdfText class="line">
            <PdfText>{{ dish.name }}</PdfText>
            <PdfLeader />
            <PdfText class="price">
              {{ dish.price }}
            </PdfText>
          </PdfText>
          <PdfText class="note">
            {{ dish.note }}
          </PdfText>
        </PdfView>
      </PdfView>
    </PdfPage>
  </PdfDocument>
</template>

<style>
.page {
  hyphens: auto;
  padding: 34pt 38pt;
  font-family: Lora;
  font-size: 10pt;
  color: #2b2118;
}
.title {
  font-size: 22pt;
  font-weight: 700;
  text-align: center;
}
.subtitle {
  font-style: italic;
  text-align: center;
  color: #7a5c3a;
  margin-top: 2pt;
  margin-bottom: 8pt;
}
.section {
  margin-top: 10pt;
}
.heading {
  font-size: 11pt;
  font-weight: 700;
  letter-spacing: 1pt;
  text-transform: uppercase;
  color: #7a5c3a;
  border-bottom: 0.75pt solid #c9b79c;
  padding-bottom: 3pt;
  margin-bottom: 4pt;
}
.dish {
  margin-top: 4pt;
}
.line {
  font-size: 10.5pt;
}
.price {
  font-weight: 700;
}
.note {
  font-style: italic;
  font-size: 8.5pt;
  color: #6c6254;
}
</style>
