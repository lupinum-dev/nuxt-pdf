# Site standard record

- **Standard:** lupinum-website `0.1-draft` (commit `8b84e1f`, 2026-11-12)
- **Adoption level:** pilot for library docs sites. This is an open-source library's docs, so lupinum-oss
  owns the repository and the docs structure; the website standard covers SEO, performance, security
  headers, measurement and search engines.
- **Stage:** Live (site online since 2026-08; Ginko 0.16 deployed 2026-11-12, #88)
- **Production URL:** https://nuxt-pdf.lupinum.com
- **Owner at Lupinum:** Matthias · **Client:** Lupinum itself (no external client)

## Profile

| Flag | Set | Reason |
| --- | --- | --- |
| `local` | no | A software library; no place to visit. |
| `relaunch` | yes | Ginko 0.16 moved the pages from `/docs/<section>/<page>` to `/docs/<page>`; every old address redirects with 301 (`redirectFrom`). |
| `languages` | no | English only. |
| `forms` | no | No forms. |
| `editorial` | no | No blog or changelog page; releases live in GitHub and CHANGELOG.md. |
| `cms` | no | Markdown files in Git. |
| `commerce` | no | Free, open source. |
| `bafg` | no | No product sale. |
| `cookies` | no | Plausible only. |
| `maintained` | yes | Lupinum maintains its own library. |

## Exceptions

- **SEO-02 alternate host:** `www.nuxt-pdf.lupinum.com` does not exist and needs no redirect; a library
  subdomain has no `www` form.
- **PERF-02 logo size:** the docs layer renders the header logo as `<img>` without `width` and `height`.
  It sits in a fixed-height header, so it does not shift the layout. Fix belongs in `@lupinum/ginko-docs`.
- **Legal pages:** the footer links the Lupinum Impressum and privacy page at lupinum.com (`app/app.config.ts`).

## Launch evidence

### Built and release

- UX-07 proven 2026-11-12 — the start page ends with the template/route/preview code and a link to Quickstart; every docs page has previous/next links.
- SEC-06 proven 2026-11-12 — `NUXT_PUBLIC_PLAUSIBLE_SCRIPT_ID` set in the Vercel project `nuxt-pdf-docs`, Production scope only (checked with the Vercel API).
- CON-07 proven 2026-11-12 — local production build: the only third-party host is plausible.io (SEC-05); the CSP allows nothing else.

### Live

- MEAS-01 proven 2026-11-12 — after the Ginko 0.16 deploy, a visit to /docs/quickstart shows in the Plausible realtime view. Goals: 404 (sent by app/plugins/plausible.ts), Outbound Link: Click, File Download.
- SRCH-01 proven 2026-11-12 — covered by the Search Console domain property `lupinum.com` (DNS verified); sitemap submitted and read (Success); indexing requested for `/`, `/docs/getting-started`, `/docs/quickstart`, `/docs/installation`.
- SRCH-02 proven 2026-11-12 — Bing Webmaster Tools: site verified by the `msvalidate.01` meta tag, sitemap submitted (processing).

## Checks

- `pnpm test:docs` (snippets, contracts, `ginko check`, types) and `pnpm --dir docs build`.
- `node ~/Git/0_libs/lupinum-website/tools/check-launch.mjs https://nuxt-pdf.lupinum.com --profile relaunch --repo .`
  On 2026-11-12 against production: 24 pass, SEO-02 fails only on the missing `www` host and PERF-02 warns
  on the layer logo (both exceptions above). Startup JavaScript fell from 259 kB to 98 kB gzip.
- After the first indexing (about 1–2 weeks): POST-01 in Search Console (pages indexed, no 404 spike from the
  old addresses).
