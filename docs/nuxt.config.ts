import ginko from "./ginko.config.ts";

const isDev = process.env.NODE_ENV === "development";

// Website standard P-10: the browser may load code and send data only to this site and Plausible.
// `frame-ancestors` comes from Ginko, which sets it on every page (server/plugins/csp.ts adds the rest).
const contentSecurityPolicy = (frameAncestors: string) =>
  [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    frameAncestors && `frame-ancestors ${frameAncestors}`,
    "form-action 'self'",
    "connect-src 'self' https://plausible.io",
    `script-src 'self' 'unsafe-inline' https://plausible.io${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "media-src 'self'",
    "frame-src 'none'",
    isDev ? "" : "upgrade-insecure-requests",
  ]
    .filter(Boolean)
    .join("; ");

// The docs frame, search, navigation and Markdown components come from @lupinum/ginko-docs.
// This app brings the content (content/), the options (app/app.config.ts) and its texts (i18n/).
export default defineNuxtConfig({
  compatibilityDate: "2026-10-01",
  extends: ["@lupinum/ginko-docs"],
  modules: ["@lupinum/ginko/nuxt"],
  ginko,
  css: ["~/assets/css/main.css"],
  // P-06: Plausible loads on production only; the ID is set in Vercel's Production scope.
  runtimeConfig: {
    // The policy without frame-ancestors, which server/plugins/csp.ts puts in front of Ginko's header.
    contentSecurityPolicy: contentSecurityPolicy(""),
    public: { plausibleScriptId: "" },
  },
  app: {
    head: {
      link: [
        { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
        { rel: "icon", type: "image/png", sizes: "96x96", href: "/favicon-96x96.png" },
        { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
        { rel: "manifest", href: "/site.webmanifest" },
      ],
      // Bing Webmaster Tools ownership of nuxt-pdf.lupinum.com (website standard SRCH-02). Keep it.
      meta: [{ name: "msvalidate.01", content: "4CB09A52107555BFCD3AF624D1E4DF95" }],
    },
  },
  routeRules: {
    "/**": {
      headers: {
        "Content-Security-Policy": contentSecurityPolicy("'self'"),
        "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "SAMEORIGIN",
      },
    },
  },
  hooks: {
    // S-14: only the entry chunk gets a preload hint; its imports follow once it arrives.
    "build:manifest": (manifest) => {
      for (const chunk of Object.values(manifest)) {
        if (!chunk.isEntry)
          Object.assign(chunk, { preload: false, prefetch: false });
      }
    },
  },
});
