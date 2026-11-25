// The page side of the render worker: starts it, sends the source a moment
// after the reader stops typing, keeps the newest result, and restarts the
// worker when a template never finishes (an endless loop in setup, say).
import { onBeforeUnmount, onMounted, ref, shallowRef, watch, type Ref } from "vue";
import type { PlaygroundRequest, PlaygroundResponse } from "./protocol";

export type PlaygroundError = Extract<PlaygroundResponse, { ok: false }>["error"];

export interface PlaygroundResult {
  url: string;
  /** The PDF itself, for the pdf.js viewer. */
  pdf: ArrayBuffer;
  bytes: number;
  pageCount: number;
  compileMs: number;
  renderMs: number;
  warnings: Extract<PlaygroundResponse, { ok: true }>["warnings"];
}

const DEBOUNCE_MS = 250;
/** Longer than the render limit (10 s) plus the first download of the renderer. */
const STALL_MS = 20_000;

export const usePlaygroundRenderer = (source: Ref<string>) => {
  const result = shallowRef<PlaygroundResult>();
  const error = shallowRef<PlaygroundError>();
  const rendering = ref(false);
  /** The first render downloads the compiler, engine and fonts. */
  const ready = ref(false);

  let worker: Worker | undefined;
  let latest = 0;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let stall: ReturnType<typeof setTimeout> | undefined;

  const onMessage = (event: MessageEvent<PlaygroundResponse>) => {
    const response = event.data;
    // A response to an older request: the reader has typed since.
    if (response.id !== latest) return;
    clearTimeout(stall);
    rendering.value = false;
    ready.value = true;
    if (!response.ok) {
      error.value = response.error;
      return;
    }
    error.value = undefined;
    if (result.value) URL.revokeObjectURL(result.value.url);
    result.value = {
      url: URL.createObjectURL(new Blob([response.pdf], { type: "application/pdf" })),
      pdf: response.pdf,
      bytes: response.pdf.byteLength,
      pageCount: response.pageCount,
      compileMs: response.compileMs,
      renderMs: response.renderMs,
      warnings: response.warnings,
    };
  };

  const start = () => {
    worker = new Worker(new URL("./render.worker.ts", import.meta.url), { type: "module" });
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", () => {
      clearTimeout(stall);
      rendering.value = false;
      error.value = { code: "PDF_RENDER_ERROR", message: "The playground could not start its renderer. Reload the page to try again." };
    });
  };

  const send = () => {
    if (!worker) return;
    const request: PlaygroundRequest = { id: ++latest, source: source.value };
    rendering.value = true;
    worker.postMessage(request);
    clearTimeout(stall);
    stall = setTimeout(() => {
      worker?.terminate();
      start();
      rendering.value = false;
      error.value = {
        code: "PDF_LIMIT_EXCEEDED",
        message: `The template did not finish within ${STALL_MS / 1000} seconds, so the playground stopped it. Look for a loop that never ends.`,
      };
    }, STALL_MS);
  };

  const schedule = () => {
    clearTimeout(debounce);
    debounce = setTimeout(send, DEBOUNCE_MS);
  };

  onMounted(() => {
    start();
    send();
  });
  watch(source, schedule);
  onBeforeUnmount(() => {
    clearTimeout(debounce);
    clearTimeout(stall);
    worker?.terminate();
    if (result.value) URL.revokeObjectURL(result.value.url);
  });

  return { result, error, rendering, ready };
};
