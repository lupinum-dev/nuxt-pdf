// The Nuxt PDF docs: Markdown in content/ (home.md and docs/), the frame from @lupinum/ginko-docs.
// The site reads only files; it never asks the Ginko platform.
import { defineSite } from "@lupinum/ginko";
import { components, docsCollection, docsHome } from "@lupinum/ginko-docs/config";
import site from "./site.json" with { type: "json" };

const locales = ["en"] as const;

export default defineSite({
  site: "nuxt-pdf-docs",
  name: site.name,
  url: site.url,
  timeZone: "Europe/Vienna",
  locales,
  currency: "EUR",
  seo: {
    description: site.description,
    color: "#00dc82",
    organization: { name: "Lupinum", url: "https://lupinum.com", logo: "/icon-light.svg", sameAs: [site.repository] },
  },
  agents: { description: "Use this site to author and render PDF documents with Nuxt PDF." },
  linkCheck: { anchors: "error" },
  pages: { home: { en: "/" } },
  components,
  bricks: {
    home: docsHome(),
    docs: docsCollection({ locales }),
  },
});
