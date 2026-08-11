import site from "../site.json" with { type: "json" };

// Identity and landing copy for the Nuxt PDF documentation site. Localized
// values use the `{ en }` shape the layer expects; this is an English-only site,
// so only `en` is populated.
export default {
  ginkoDocs: {
    site: {
      url: site.url,
      name: { en: site.name },
      description: {
        en: site.description,
      },
      logo: { light: "/logo.svg", dark: "/logo-dark.svg" },
      docsSidebarSwitcher: "tabs",
    },
    social: { github: site.repository, discord: site.discord },
    repository: {
      url: site.repository,
      branch: "main",
      contentDirectory: "docs/content",
    },
    landing: {
      eyebrow: { en: "Nuxt module · external alpha" },
      title: { en: "PDFs authored as Vue components." },
      description: {
        en: "Nuxt PDF renders documents on the server from ordinary Vue SFCs. It uses Vue for authoring and React PDF's framework-neutral layout and serialization engine for rendering — React itself is never a production dependency.",
      },
      primary: {
        label: { en: "Get started" },
        to: { en: "/docs/getting-started" },
      },
      secondary: {
        label: { en: "View on GitHub" },
        to: { en: site.repository },
      },
      hero: {
        media: {
          type: "code-tabs",
          tabs: [
            {
              label: { en: "Template" },
              icon: "lucide:file-text",
              filename: "pdfs/invoice.vue",
              language: "vue",
              code: [
                "<script setup lang=\"ts\">",
                "const props = defineProps<{ invoice: { number: string; total: string } }>()",
                "",
                "definePdf({",
                "  title: ({ invoice }) => `Invoice ${invoice.number}`,",
                "  filename: ({ invoice }) => `invoice-${invoice.number}.pdf`,",
                "})",
                "</script>",
                "",
                "<template>",
                "  <PdfDocument>",
                "    <PdfPage size=\"A4\" :style=\"{ padding: 48 }\">",
                "      <PdfText :style=\"{ fontSize: 24 }\">Invoice {{ props.invoice.number }}</PdfText>",
                "      <PdfText>Total: {{ props.invoice.total }}</PdfText>",
                "    </PdfPage>",
                "  </PdfDocument>",
                "</template>",
              ].join("\n"),
            },
            {
              label: { en: "Server route" },
              icon: "lucide:server",
              filename: "server/api/invoice.get.ts",
              language: "ts",
              code: [
                "import { pdf } from \"#pdf\";",
                "",
                "export default defineEventHandler(async () => {",
                "  const result = await pdf.invoice.render({",
                "    invoice: { number: \"INV-001\", total: \"EUR 1,250.00\" },",
                "  });",
                "  return result.response();",
                "});",
              ].join("\n"),
            },
            {
              label: { en: "Preview" },
              icon: "lucide:eye",
              filename: "terminal",
              language: "bash",
              code: [
                "# The template index, dev only",
                "open http://localhost:3000/_pdf",
                "",
                "# The browser preview with sample data and scenarios",
                "open http://localhost:3000/_pdf/invoice",
                "",
                "# The production-style route",
                "open http://localhost:3000/api/invoice",
              ].join("\n"),
            },
          ],
        },
      },
      install: { command: "pnpm add @lupinum/nuxt-pdf" },
      features: [
        {
          title: { en: "Vue authoring, PDF output" },
          description: {
            en: "Compose documents with typed props, v-if, keyed v-for, slots, and local components. A small set of thin primitives maps to the layout engine.",
          },
          icon: "lucide:component",
        },
        {
          title: { en: "Server-only rendering" },
          description: {
            en: "The engine is Node server-only, with no client build step. React PDF runtimes are absent from the client bundle and from production dependencies.",
          },
          icon: "lucide:server",
        },
        {
          title: { en: "Typed #pdf registry" },
          description: {
            en: "Discovered templates generate an inspectable #pdf module. Property access and literal names infer each SFC's props; a marked escape hatch covers runtime strings.",
          },
          icon: "lucide:braces",
        },
        {
          title: { en: "Contents, links, bookmarks" },
          description: {
            en: "A multi-pass layout loop resolves table-of-contents page numbers; #id links and a bookmark outline follow the component tree. Non-convergence fails closed.",
          },
          icon: "lucide:list-tree",
        },
        {
          title: { en: "Fail-closed resources" },
          description: {
            en: "Local images and fonts are signature-checked and embedded at build. Remote fetching is off until an operator sets an explicit allowlist.",
          },
          icon: "lucide:shield-check",
        },
        {
          title: { en: "Test with a real render" },
          description: {
            en: "@lupinum/nuxt-pdf/test renders a template through the real pipeline and asserts on extracted text, links, outline, page count, and raster baselines.",
          },
          icon: "lucide:flask-conical",
        },
      ],
      cta: {
        title: { en: "Render your first document." },
        secondary: {
          label: { en: "Read the docs" },
          to: { en: "/docs" },
        },
      },
    },
  },
};
