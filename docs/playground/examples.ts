// Starter templates of the playground. Plain strings in a .ts file: inside a
// .vue file, a closing script tag in a string would end the page's own block.
// The look follows the docs' sample PDFs: zinc greys, Inter, rounded bordered
// cards and one blue accent. The names and figures are made up.

export interface PlaygroundExample {
  id: string;
  label: string;
  source: string;
}

const letter = `<script setup lang="ts">
// sampleData are the props of the preview. Change them, or the template.
definePdf({
  title: ({ name }) => \`Welcome, \${name}\`,
  sampleData: { name: 'Ada', team: 'Studio Kestrel' },
})

const props = defineProps<{ name: string, team: string }>()
</script>

<template>
  <PdfDocument language="en">
    <PdfPage size="A4" class="page">
      <PdfView class="badge">
        <PdfText class="badge-text">{{ props.team }}</PdfText>
      </PdfView>
      <PdfText class="title">Welcome, {{ props.name }}.</PdfText>
      <PdfText class="lead">
        This PDF is a Vue component. Edit the template on the left and
        the page updates as you type.
      </PdfText>
      <PdfView class="card">
        <PdfText class="label">How it works</PdfText>
        <PdfText>
          Text wraps, hyphenates and breaks across pages by itself. Classes
          from the style block below style the elements, as in any Vue
          file. Try another font size, or change the accent colour.
        </PdfText>
      </PdfView>
    </PdfPage>
  </PdfDocument>
</template>

<style>
:root { --foreground: #09090b; --muted: #71717a; --border: #e4e4e7; --accent: #2563eb; }
.page { padding: 64pt 56pt; font-family: Inter; font-size: 10.5pt; line-height: 1.55; color: var(--foreground); }
.badge { align-self: flex-start; padding: 3pt 9pt; border: 1pt solid #bfdbfe; border-radius: 999pt; background-color: #eff6ff; }
.badge-text { font-size: 8pt; font-weight: 500; color: var(--accent); }
.title { font-size: 28pt; font-weight: 600; letter-spacing: -0.5pt; line-height: 1.15; margin: 18pt 0 10pt; }
.lead { font-size: 13pt; color: var(--muted); margin-bottom: 28pt; }
.card { padding: 16pt 18pt; border: 1pt solid var(--border); border-radius: 10pt; }
.label { font-size: 8pt; font-weight: 500; color: var(--muted); margin-bottom: 4pt; }
</style>
`;

const invoice = `<script setup lang="ts">
type Line = { id: number, title: string, quantity: number, price: number }

definePdf({
  title: ({ number }) => \`Invoice \${number}\`,
  sampleData: {
    number: '2026-041',
    customer: 'Riverbend Cooperative',
    lines: [
      { id: 1, title: 'Workshop: content model', quantity: 1, price: 1200 },
      { id: 2, title: 'Page templates', quantity: 6, price: 340 },
      { id: 3, title: 'Image pipeline setup', quantity: 1, price: 680 },
      { id: 4, title: 'Hosting, first year', quantity: 12, price: 25 },
    ],
  },
})

const props = defineProps<{ number: string, customer: string, lines: Line[] }>()

const money = (value: number) =>
  new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(value)
const subtotal = computed(() => props.lines.reduce((sum, line) => sum + line.quantity * line.price, 0))
const vat = computed(() => subtotal.value * 0.2)

// One entry per table column: the item takes the free width, the numbers align right.
const figure = { width: 'auto', align: 'right', style: { paddingLeft: 20 } } as const
</script>

<template>
  <PdfDocument language="en">
    <PdfPage size="A4" class="page">
      <PdfView class="head">
        <PdfText class="brand">Studio Kestrel</PdfText>
        <PdfView class="badge"><PdfText class="badge-text">Due in 14 days</PdfText></PdfView>
      </PdfView>

      <PdfView class="meta">
        <PdfView class="meta-item">
          <PdfText class="label">Invoice</PdfText>
          <PdfText class="value">{{ props.number }}</PdfText>
        </PdfView>
        <PdfView class="meta-item">
          <PdfText class="label">Billed to</PdfText>
          <PdfText class="value">{{ props.customer }}</PdfText>
        </PdfView>
      </PdfView>

      <PdfView class="card">
        <PdfTable :columns="[1, figure, figure, figure]">
          <PdfTableHeader class="row header">
            <PdfTableCell>Item</PdfTableCell>
            <PdfTableCell>Qty</PdfTableCell>
            <PdfTableCell>Price</PdfTableCell>
            <PdfTableCell>Amount</PdfTableCell>
          </PdfTableHeader>
          <PdfTableRow v-for="line in props.lines" :key="line.id" class="row line">
            <PdfTableCell>{{ line.title }}</PdfTableCell>
            <PdfTableCell>{{ line.quantity }}</PdfTableCell>
            <PdfTableCell>{{ money(line.price) }}</PdfTableCell>
            <PdfTableCell>{{ money(line.quantity * line.price) }}</PdfTableCell>
          </PdfTableRow>
        </PdfTable>
      </PdfView>

      <PdfView class="totals">
        <PdfView class="total"><PdfText>Subtotal</PdfText><PdfText>{{ money(subtotal) }}</PdfText></PdfView>
        <PdfView class="total"><PdfText>VAT 20%</PdfText><PdfText>{{ money(vat) }}</PdfText></PdfView>
        <PdfView class="total due"><PdfText>Total due</PdfText><PdfText>{{ money(subtotal + vat) }}</PdfText></PdfView>
      </PdfView>
    </PdfPage>
  </PdfDocument>
</template>

<style>
:root { --foreground: #09090b; --muted: #71717a; --border: #e4e4e7; --accent: #2563eb; }
.page { padding: 48pt; font-family: Inter; font-size: 9.5pt; color: var(--foreground); }
.head { flex-direction: row; justify-content: space-between; align-items: center; margin-bottom: 28pt; }
.brand { font-size: 14pt; font-weight: 600; letter-spacing: -0.2pt; }
.badge { padding: 3pt 9pt; border: 1pt solid #bfdbfe; border-radius: 999pt; background-color: #eff6ff; }
.badge-text { font-size: 7.5pt; font-weight: 500; color: var(--accent); }
.meta { flex-direction: row; margin-bottom: 20pt; }
.meta-item { width: 160pt; }
.label { font-size: 7.5pt; font-weight: 500; color: var(--muted); margin-bottom: 3pt; }
.value { font-size: 11pt; font-weight: 500; }
.card { border: 1pt solid var(--border); border-radius: 10pt; }
.row { padding: 8pt 12pt; }
.header { font-size: 8pt; font-weight: 500; color: var(--muted); }
.line { border-top: 1pt solid var(--border); }
.totals { align-self: flex-end; width: 200pt; margin-top: 14pt; padding: 10pt 12pt;
  border: 1pt solid var(--border); border-radius: 10pt; background-color: #fafafa; }
.total { flex-direction: row; justify-content: space-between; padding: 3pt 0; color: var(--muted); }
.due { margin-top: 4pt; padding-top: 8pt; border-top: 1pt solid var(--border);
  font-size: 11pt; font-weight: 600; color: var(--foreground); }
</style>
`;

const report = `<script setup lang="ts">
definePdf({
  title: 'Field report',
  sampleData: { sections: 6 },
})

const props = defineProps<{ sections: number }>()

const paragraph = 'Observations were logged at each site twice a day. ' +
  'Counts held steady in the first weeks and rose once the meadow was mown in late June. ' +
  'The long text shows how paragraphs flow from one page to the next.'
</script>

<template>
  <PdfDocument language="en">
    <PdfPage size="A5" class="page">
      <!-- fixed: repeats on every page. Page tokens print that page's values. -->
      <PdfView fixed class="header">
        <PdfText>Field report 2026</PdfText>
        <PdfText>Page <PdfPageNumber /> of <PdfPageCount /></PdfText>
      </PdfView>

      <PdfText class="title">Pollinators on the north meadow</PdfText>
      <PdfText class="lead">Six sites, counted from May to August.</PdfText>

      <PdfView v-for="section in props.sections" :key="section" class="section">
        <PdfText class="heading" :keep-with-next="true">Site {{ section }}</PdfText>
        <PdfText class="body">{{ paragraph }} {{ paragraph }}</PdfText>
        <PdfText class="body">{{ paragraph }}</PdfText>
      </PdfView>

      <PdfText fixed class="footer">Made with Nuxt PDF</PdfText>
    </PdfPage>
  </PdfDocument>
</template>

<style>
:root { --foreground: #09090b; --muted: #71717a; --border: #e4e4e7; --accent: #2563eb; }
.page { padding: 36pt 40pt; font-family: Inter; font-size: 9pt; line-height: 1.55; color: var(--foreground); }
.header { flex-direction: row; justify-content: space-between; font-size: 7.5pt; color: var(--muted);
  border-bottom: 1pt solid var(--border); padding-bottom: 6pt; margin-bottom: 20pt; }
.title { font-size: 18pt; font-weight: 600; letter-spacing: -0.3pt; line-height: 1.2; }
.lead { color: var(--muted); margin: 4pt 0 16pt; }
.section { margin-bottom: 10pt; }
.heading { font-size: 10.5pt; font-weight: 600; color: var(--accent); margin-bottom: 3pt; }
.body { margin-bottom: 6pt; }
.footer { font-size: 7.5pt; color: var(--muted); text-align: center; margin-top: 12pt; }
</style>
`;

const chart = `<script setup lang="ts">
type Bar = { month: string, value: number }

definePdf({
  title: 'Monthly visits',
  sampleData: {
    bars: [
      { month: 'Jan', value: 42 }, { month: 'Feb', value: 55 }, { month: 'Mar', value: 61 },
      { month: 'Apr', value: 48 }, { month: 'May', value: 74 }, { month: 'Jun', value: 90 },
    ],
  },
})

const props = defineProps<{ bars: Bar[] }>()

// SVG units: the chart is 300 wide and 160 high.
const max = computed(() => Math.max(...props.bars.map(bar => bar.value)))
const slot = computed(() => 300 / props.bars.length)
const height = (value: number) => (value / max.value) * 130
</script>

<template>
  <PdfDocument language="en">
    <PdfPage size="A5" orientation="landscape" class="page">
      <PdfText class="title">Monthly visits</PdfText>
      <PdfText class="lead">Bars are SVG shapes, drawn as vectors in the PDF.</PdfText>
      <PdfView class="card">
        <PdfText class="label">Visits per month, in thousands</PdfText>
        <PdfSvg view-box="0 0 300 160" class="chart">
          <PdfLine x1="0" y1="140" x2="300" y2="140" stroke="#e4e4e7" stroke-width="1" />
          <PdfG v-for="(bar, index) in props.bars" :key="bar.month">
            <PdfRect
              :x="index * slot + 12"
              :y="140 - height(bar.value)"
              :width="slot - 24"
              :height="height(bar.value)"
              rx="4"
              :fill="bar.value === max ? '#2563eb' : '#d4d4d8'"
            />
            <PdfText :x="index * slot + slot / 2 - 7" y="154" fill="#71717a" :style="{ fontSize: 8 }">
              {{ bar.month }}
            </PdfText>
          </PdfG>
        </PdfSvg>
      </PdfView>
    </PdfPage>
  </PdfDocument>
</template>

<style>
:root { --foreground: #09090b; --muted: #71717a; --border: #e4e4e7; }
.page { padding: 32pt 44pt; font-family: Inter; color: var(--foreground); }
.title { font-size: 16pt; font-weight: 600; letter-spacing: -0.3pt; }
.lead { font-size: 9pt; color: var(--muted); margin: 3pt 0 14pt; }
.card { padding: 14pt 16pt; border: 1pt solid var(--border); border-radius: 10pt; }
.label { font-size: 7.5pt; font-weight: 500; color: var(--muted); margin-bottom: 8pt; }
.chart { width: 100%; }
</style>
`;

export const PLAYGROUND_EXAMPLES: readonly PlaygroundExample[] = [
  { id: "letter", label: "Text", source: letter },
  { id: "invoice", label: "Invoice", source: invoice },
  { id: "report", label: "Multi-page", source: report },
  { id: "chart", label: "Chart", source: chart },
];
