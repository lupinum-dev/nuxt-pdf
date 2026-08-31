import { defineGinkoDocsConfig } from "@lupinum/ginko-docs/content";
import site from "./site.json" with { type: "json" };

export default defineGinkoDocsConfig({
  site: {
    name: "Nuxt PDF",
    description: "Author and render PDFs with Vue components in Nuxt.",
    whenToUse: "Use this site to author and render PDF documents with Nuxt PDF.",
  },
  locales: ["en"],
  blog: false,
});
