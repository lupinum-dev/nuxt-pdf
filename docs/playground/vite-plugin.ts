// Lets the playground's Web Worker bundle the library source (`../src`) for the
// browser. The engine and the SFC compiler import a few Node built-ins and two
// native or file-system packages; for the modules of the library and the
// playground (and only those) this plugin points them at small browser shims
// in ./shims. The rest of the docs site resolves as before.
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(here, "../..");
const librarySource = join(workspace, "src") + sep;
const shim = (name: string) => join(here, "shims", `${name}.ts`);

// Browser packages of the docs app (docs/package.json) that stand in for Node
// modules. The library source lives outside the docs app, so they are resolved
// as if this folder imported them: Vite then picks their browser entries.
const DOCS_PACKAGES: Record<string, string> = {
  "buffer": "buffer",
  "node:buffer": "buffer",
  "fflate": "fflate",
};
const docsImporter = join(here, "render-core.ts");

const SHIMS: Record<string, string> = {
  "node:zlib": shim("zlib"),
  "node:crypto": shim("crypto"),
  "node:path": shim("path"),
  "node:fs": shim("fs"),
  "node:fs/promises": shim("fs"),
  "node:worker_threads": shim("node-runtime"),
  "node:async_hooks": shim("node-runtime"),
  "node:os": shim("node-runtime"),
  "esbuild": shim("esbuild"),
  "unimport": shim("unimport"),
};

// The part of Vite's plugin context this plugin uses. Typed structurally: the
// docs app does not depend on `vite` directly, so its types are not resolvable
// here. Nuxt checks the shape where the plugin is used.
interface ResolveContext {
  resolve: (id: string, importer: string, options: { skipSelf: boolean }) => Promise<{ id: string } | null>;
}

export const playgroundResolver = () => ({
  name: "nuxt-pdf-playground",
  enforce: "pre" as const,
  async resolveId(this: ResolveContext, id: string, importer: string | undefined) {
    if (!importer || !(id in SHIMS || id in DOCS_PACKAGES)) return null;
    const file = importer.split("?")[0]!;
    if (!file.startsWith(librarySource) && !file.startsWith(here + sep)) return null;
    if (id in SHIMS) return SHIMS[id];
    const resolved = await this.resolve(DOCS_PACKAGES[id]!, docsImporter, { skipSelf: true });
    if (!resolved) throw new Error(`[playground] ${DOCS_PACKAGES[id]} is missing. It is a dependency of docs/package.json; run pnpm install.`);
    return resolved.id;
  },
});
