import site from "../site.json" with { type: "json" };

// Options of the docs layer. Link texts live in i18n/en.json (`docs.footer.<id>`).
export default defineAppConfig({
  docs: {
    logo: { light: "/logo-light.svg", dark: "/logo-dark.svg" },
    social: [
      { icon: "docs:github", href: site.repository, label: "GitHub" },
      { icon: "docs:discord", href: site.discord, label: "Discord" },
    ],
    repository: { url: site.repository, branch: "main", editUrl: "{url}/edit/{branch}/docs/{source}" },
    footer: {
      links: [
        { id: "imprint", href: "https://lupinum.com/impressum" },
        { id: "privacy", href: "https://lupinum.com/datenschutz" },
      ],
    },
  },
});
