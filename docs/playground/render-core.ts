// The playground's renderer, loaded by render.worker.ts. It compiles the
// reader's PDF SFC with the library's own SFC compiler, evaluates it, and
// renders it with the library's own registry and engine, all inside the Web
// Worker in the reader's browser. No source text leaves the browser.
import "./shims/process";
import * as Vue from "vue";
import { babelParse } from "vue/compiler-sfc";
import { compilePdfSfc } from "../../src/build/sfc/compile";
import { PdfSfcCompileError } from "../../src/build/sfc/errors";
import type { BundledPdfFontDescriptor } from "../../src/runtime/fonts";
import { createPdfTemplate } from "../../src/runtime/server/registry";
import { pdfRenderPlacement } from "../../src/runtime/server/worker-pool";
import { NuxtPdfError, PDF_ERROR_CODES } from "../../src/runtime/shared/errors";
import { PDF_DEFINITION_PROPERTY, type PdfComponent } from "../../src/runtime/shared/template";
import type { PlaygroundRequest, PlaygroundResponse } from "./protocol";

// The worker is the thread: render in it, never start a render thread.
pdfRenderPlacement.inProcess = true;

const FILE = "/playground/Playground.vue";
const ROOT = "/playground";

const FONT_FILES = [
  // Text, labels and headings of the docs' sample PDFs, and bold: the engine
  // does not fall back to a nearby weight, so `font-weight: bold` needs 700.
  { family: "Inter", fontWeight: 400, file: "Inter-400.ttf" },
  { family: "Inter", fontWeight: 500, file: "Inter-500.ttf" },
  { family: "Inter", fontWeight: 600, file: "Inter-600.ttf" },
  { family: "Inter", fontWeight: 700, file: "Inter-700.ttf" },
] as const;

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
};

let fonts: Promise<BundledPdfFontDescriptor[]> | undefined;
const loadFonts = () => fonts ??= Promise.all(FONT_FILES.map(async (font) => {
  const response = await fetch(new URL(`/fonts/playground/${font.file}`, self.location.origin));
  if (!response.ok) throw new Error(`The playground font ${font.file} could not be loaded (${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { family: font.family, fontWeight: font.fontWeight, src: `data:font/ttf;base64,${toBase64(bytes)}` as const };
}));

type AstNode = { type: string; start: number; end: number; [key: string]: unknown };

const MODULES: Record<string, Record<string, unknown>> = { vue: Vue };

/**
 * The compiled module as a function body: its imports read from MODULES and
 * its default export is returned. The playground has one file, so `vue` is
 * the only module there is.
 */
const evaluateModule = (code: string): PdfComponent<object> => {
  const program = babelParse(code, { sourceType: "module" }).program as unknown as { body: AstNode[] };
  const edits: { start: number; end: number; text: string }[] = [];
  for (const statement of program.body) {
    if (statement.type === "ImportDeclaration") {
      const from = (statement.source as { value: string }).value;
      if (!(from in MODULES)) {
        throw new NuxtPdfError(PDF_ERROR_CODES.TemplateInvalid, `The playground has one file and cannot import "${from}". Vue APIs and PDF components need no import.`);
      }
      const names = (statement.specifiers as AstNode[]).map((specifier) => {
        const local = (specifier.local as { name: string }).name;
        if (specifier.type === "ImportNamespaceSpecifier") return { whole: local };
        const imported = specifier.type === "ImportDefaultSpecifier" ? "default" : (specifier.imported as { name: string }).name;
        return { pair: `${JSON.stringify(imported)}: ${local}` };
      });
      const pairs = names.flatMap((name) => name.pair ?? []);
      const wholes = names.flatMap((name) => name.whole ?? []);
      const text = [
        pairs.length > 0 ? `const { ${pairs.join(", ")} } = __modules[${JSON.stringify(from)}];` : "",
        ...wholes.map((local) => `const ${local} = __modules[${JSON.stringify(from)}];`),
      ].join(" ");
      edits.push({ start: statement.start, end: statement.end, text });
    }
    else if (statement.type === "ExportDefaultDeclaration") {
      const declaration = statement.declaration as AstNode;
      edits.push({ start: statement.start, end: declaration.start, text: "return " });
    }
  }
  let body = code;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    body = body.slice(0, edit.start) + edit.text + body.slice(edit.end);
  }

  return new Function("__modules", body)(MODULES) as PdfComponent<object>;
};

const errorOf = (error: unknown): Extract<PlaygroundResponse, { ok: false }>["error"] => {
  if (error instanceof PdfSfcCompileError) {
    return { code: PDF_ERROR_CODES.TemplateInvalid, message: error.detail, line: error.line, column: error.column };
  }
  if (error instanceof NuxtPdfError) {
    return { code: error.code, message: error.message, line: error.source?.line, column: error.source?.column };
  }
  return { code: PDF_ERROR_CODES.RenderError, message: error instanceof Error ? error.message : String(error) };
};

/** Compile and render one request; the PDF buffer is the one to transfer. */
export const renderRequest = async ({ id, source }: PlaygroundRequest): Promise<PlaygroundResponse> => {
  const started = performance.now();
  try {
    const compiled = await compilePdfSfc(source, FILE, "template", false, { dev: true, rootDir: ROOT });
    const component = evaluateModule(compiled.code);
    const compiledAt = performance.now();
    const template = createPdfTemplate("playground", component, {
      file: "Playground.vue",
      fonts: await loadFonts(),
      limits: { timeoutMs: 10_000, maxPages: 50 },
    });
    const props = component[PDF_DEFINITION_PROPERTY]?.sampleData ?? {};
    const result = await template.render(props);
    const bytes = await result.toUint8Array();
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return {
      id,
      ok: true,
      pdf: buffer,
      pageCount: result.diagnostics.pageCount,
      compileMs: compiledAt - started,
      renderMs: performance.now() - compiledAt,
      warnings: result.diagnostics.layoutWarnings.map((warning) => ({ ...warning })),
    };
  }
  catch (error) {
    return { id, ok: false, error: errorOf(error) };
  }
};
