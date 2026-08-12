import site from "./site.json" with { type: "json" };

// The documentation site is a thin consumer of the @lupinum/ginko-docs layer.
// The layer owns the application shell, navigation, search, SEO, and content
// pipeline; this app owns only its identity, landing copy, and Markdown.
export default defineNuxtConfig({
  extends: ["@lupinum/ginko-docs"],
  site: { defaultLocale: "en-US", url: site.url },
  i18n: {
    baseUrl: site.url,
    locales: [{ code: "en", language: "en-US", name: "English" }],
  },
  fonts: {
    families: [
      { name: "Public Sans", provider: "local" },
      { name: "JetBrains Mono", provider: "none" },
    ],
    providers: {
      adobe: false,
      bunny: false,
      fontshare: false,
      fontsource: false,
      google: false,
      googleicons: false,
      npm: false,
    },
  },
});
