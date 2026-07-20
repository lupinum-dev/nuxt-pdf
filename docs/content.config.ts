import { defineGinkoDocsConfig } from "@lupinum/ginko-docs/content";
import site from "./site.json" with { type: "json" };

export default defineGinkoDocsConfig({
  site: {
    name: "Nuxt PDF",
    description: "Author server-rendered PDFs as ordinary Vue components in Nuxt.",
    url: site.url,
  },
  locales: ["en"],
  defaultLocale: "en",
  blog: false,
});
