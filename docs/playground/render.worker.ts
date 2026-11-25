// The playground's render worker. It runs the reader's template in the
// reader's browser and nowhere else. The worker is served with its own
// Content-Security-Policy (docs/nuxt.config.ts): it may evaluate the compiled
// template and instantiate yoga's WebAssembly, and it may connect only to this
// site, for the fonts.
//
// This entry stays small and loads the renderer lazily. If the compiler and
// engine were in this chunk, the engine's lazy chunks would import it back by
// URL, and a second copy of this module (with a second listener) would run.
import type { PlaygroundRequest, PlaygroundResponse } from "./protocol";

const core = import("./render-core");

// Renders run one at a time. While one runs, only the newest request waits:
// the reader typed past the others.
let running = false;
let waiting: PlaygroundRequest | undefined;

const post = (response: PlaygroundResponse) => {
  if (response.ok) self.postMessage(response, { transfer: [response.pdf] });
  else self.postMessage(response);
};

const drain = async () => {
  if (running) return;
  running = true;
  try {
    while (waiting) {
      const request = waiting;
      waiting = undefined;
      const renderer = await core.catch((error: unknown) => error instanceof Error ? error : new Error(String(error)));
      if (renderer instanceof Error) {
        post({ id: request.id, ok: false, error: { code: "PDF_RENDER_ERROR", message: `The playground could not load its renderer: ${renderer.message}` } });
        continue;
      }
      post(await renderer.renderRequest(request));
    }
  }
  finally {
    running = false;
  }
};

self.addEventListener("message", (event: MessageEvent<PlaygroundRequest>) => {
  waiting = event.data;
  void drain();
});
