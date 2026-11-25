<script setup lang="ts">
// The playground: a PDF template on the left, the PDF it renders on the right.
// The template compiles and renders in a Web Worker in the reader's browser
// (docs/playground/render.worker.ts); nothing is sent to a server.
import CodeEditor from "../../playground/CodeEditor.vue";
import PdfPages from "../../playground/PdfPages.vue";
import { PLAYGROUND_EXAMPLES } from "../../playground/examples";
import { shareHash, sourceFromHash } from "../../playground/share";
import { usePlaygroundRenderer } from "../../playground/use-renderer";

useGinkoSeo({
  title: "Playground",
  description: "Edit a Nuxt PDF template and see the PDF as you type. It renders in your browser.",
});

const SHARED = "shared";
const DRAFTS_KEY = "nuxt-pdf-playground:drafts";

const originals = Object.fromEntries(PLAYGROUND_EXAMPLES.map((example) => [example.id, example.source]));
// The reader's edits per example (and of a shared link), so switching examples loses nothing.
const drafts = reactive<Record<string, string>>({ ...originals });
const current = ref(PLAYGROUND_EXAMPLES[0]!.id);
const source = computed({
  get: () => drafts[current.value] ?? "",
  set: (value: string) => {
    drafts[current.value] = value;
  },
});
const edited = computed(() => current.value !== SHARED && drafts[current.value] !== originals[current.value]);

const { result, error, rendering, ready } = usePlaygroundRenderer(source);

// Small screens show one pane at a time.
const view = ref<"code" | "pdf">("code");
// Touch devices (whose browsers show a framed PDF as one page, or not at all) and
// browsers without a PDF viewer get the pages drawn by pdf.js; desktops a frame.
const drawPages = ref(false);

onMounted(async () => {
  drawPages.value = matchMedia("(pointer: coarse)").matches || navigator.pdfViewerEnabled === false;
  try {
    Object.assign(drafts, JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? "{}"));
  }
  catch {
    // Storage is a convenience; without it the examples start fresh.
  }
  const shared = await sourceFromHash(location.hash);
  if (shared !== undefined) {
    drafts[SHARED] = shared;
    current.value = SHARED;
  }
});

watch(drafts, () => {
  try {
    const changed = Object.fromEntries(Object.entries(drafts).filter(([id, text]) => id !== SHARED && text !== originals[id]));
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(changed));
  }
  catch {
    // Private windows may refuse storage.
  }
});

const reset = () => {
  drafts[current.value] = originals[current.value]!;
};

const shareLabel = ref("Copy link");
const share = async () => {
  const hash = await shareHash(source.value);
  history.replaceState(history.state, "", hash);
  try {
    await navigator.clipboard.writeText(location.href);
    shareLabel.value = "Link copied";
  }
  catch {
    shareLabel.value = "Link in address bar";
  }
  setTimeout(() => {
    shareLabel.value = "Copy link";
  }, 2000);
};

const editor = ref<InstanceType<typeof CodeEditor>>();
const problem = computed(() =>
  error.value?.line ? { line: error.value.line, column: error.value.column, message: error.value.message } : undefined);
const showErrorInEditor = () => {
  if (!error.value?.line) return;
  view.value = "code";
  nextTick(() => editor.value?.focusAt(error.value!.line!, error.value!.column));
};

// Two frames: the next PDF loads in the hidden one and replaces the visible one once
// it has loaded, so the preview does not flash white on every keystroke.
const frames = ref<[string | undefined, string | undefined]>([undefined, undefined]);
const visibleFrame = ref(0);
// PDF open parameters: no thumbnail sidebar, page fitted to the width (Chrome reads both).
const frameUrl = (url: string) => `${url}#navpanes=0&view=FitH`;
watch(() => result.value?.url, (url) => {
  if (!url) return;
  const hidden = 1 - visibleFrame.value;
  frames.value[hidden] = frameUrl(url);
  if (frames.value[visibleFrame.value] === undefined) visibleFrame.value = hidden;
  // A viewer that reports no load event still gets shown.
  else setTimeout(() => onFrameLoad(hidden), 1500);
});
const onFrameLoad = (index: number) => {
  // Only the frame holding the newest PDF may take over.
  if (result.value && frames.value[index] === frameUrl(result.value.url)) visibleFrame.value = index;
};

const size = (bytes: number) => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} KB`);
const pages = (count: number) => (count === 1 ? "1 page" : `${count} pages`);

const status = computed(() => {
  if (!ready.value) return error.value ? "Could not render" : "Loading the renderer…";
  if (rendering.value) return "Rendering…";
  if (error.value) return result.value ? "Showing the last PDF that rendered" : "Not rendered";
  if (!result.value) return "";
  return `${pages(result.value.pageCount)} · ${size(result.value.bytes)} · ${Math.round(result.value.compileMs + result.value.renderMs)} ms`;
});
const stateClass = computed(() => (error.value ? "is-error" : rendering.value || !ready.value ? "is-busy" : "is-ok"));
</script>

<template>
  <div class="pg">
    <header class="pg-bar">
      <div class="pg-intro">
        <h1>Playground</h1>
        <p>
          Edit the template and the PDF follows. It compiles and renders right here in your
          browser, with the same engine your Nuxt server uses.
        </p>
      </div>
      <div
        class="pg-examples"
        role="group"
        aria-label="Examples"
      >
        <button
          v-for="example in PLAYGROUND_EXAMPLES"
          :key="example.id"
          type="button"
          :aria-pressed="current === example.id"
          @click="current = example.id"
        >
          {{ example.label }}
        </button>
        <button
          v-if="drafts[SHARED] !== undefined"
          type="button"
          :aria-pressed="current === SHARED"
          @click="current = SHARED"
        >
          Shared
        </button>
      </div>
    </header>

    <div
      class="pg-switch"
      role="group"
      aria-label="Show"
    >
      <button
        type="button"
        :aria-pressed="view === 'code'"
        @click="view = 'code'"
      >
        Template
      </button>
      <button
        type="button"
        :aria-pressed="view === 'pdf'"
        @click="view = 'pdf'"
      >
        PDF
        <span
          class="pg-dot"
          :class="stateClass"
          aria-hidden="true"
        />
      </button>
    </div>

    <div
      class="pg-panes"
      :data-view="view"
    >
      <section
        class="pg-pane pg-source"
        aria-label="Template"
      >
        <div class="pg-pane-bar">
          <span class="pg-file">
            <svg
              viewBox="0 0 256 221"
              aria-hidden="true"
            ><path
              fill="#41b883"
              d="M204.8 0H256L128 220.8L0 0h97.92L128 51.2L157.44 0z"
            /><path
              fill="#41b883"
              d="m0 0l128 220.8L256 0h-51.2L128 132.48L50.56 0z"
            /><path
              fill="#35495e"
              d="M50.56 0L128 133.12L204.8 0h-47.36L128 51.2L97.92 0z"
            /></svg>
            Playground.vue
          </span>
          <span class="pg-tools">
            <button
              v-if="edited"
              type="button"
              class="pg-tool"
              @click="reset"
            >Reset</button>
            <button
              type="button"
              class="pg-tool"
              @click="share"
            >{{ shareLabel }}</button>
          </span>
        </div>
        <div class="pg-editor-wrap">
          <CodeEditor
            ref="editor"
            v-model="source"
            :problem="problem"
          />
        </div>
        <div
          class="pg-problems"
          aria-live="polite"
        >
          <div
            v-if="error"
            class="pg-problem"
          >
            <code>{{ error.code }}</code>
            <p>{{ error.message }}</p>
            <button
              v-if="error.line"
              type="button"
              class="pg-tool"
              @click="showErrorInEditor"
            >
              Line {{ error.line }}<template v-if="error.column">
                , column {{ error.column }}
              </template>
            </button>
          </div>
          <div
            v-else-if="result?.warnings.length"
            class="pg-problem is-warning"
          >
            <code>{{ result.warnings[0]!.code }}</code>
            <p>
              Layout warning<template v-if="result.warnings[0]!.pageNumber">
                on page {{ result.warnings[0]!.pageNumber }}
              </template>.
              <template v-if="result.warnings.length > 1">
                {{ result.warnings.length - 1 }} more.
              </template>
              See <NuxtLink to="/docs/errors-and-debugging">Diagnose render failures</NuxtLink>.
            </p>
          </div>
        </div>
        <p
          id="pg-editor-hint"
          class="pg-hint"
        >
          Tab indents. Press Esc, then Tab, to leave the editor.
        </p>
      </section>

      <section
        class="pg-pane pg-preview"
        aria-label="PDF"
      >
        <div class="pg-pane-bar">
          <span
            class="pg-status"
            role="status"
          >
            <span
              class="pg-dot"
              :class="stateClass"
              aria-hidden="true"
            />
            {{ status }}
          </span>
          <span
            v-if="result"
            class="pg-tools"
          >
            <a
              class="pg-tool"
              :href="result.url"
              target="_blank"
              rel="noopener"
            >Open</a>
            <a
              class="pg-tool"
              :href="result.url"
              download="playground.pdf"
            >Download</a>
          </span>
        </div>
        <div
          class="pg-stage"
          :class="{ 'is-stale': error && result }"
        >
          <PdfPages
            v-if="drawPages && result"
            :pdf="result.pdf"
          />
          <template v-else-if="!drawPages">
            <template
              v-for="(frame, index) in frames"
              :key="index"
            >
              <iframe
                v-if="frame"
                :src="frame"
                :title="index === visibleFrame ? 'Rendered PDF' : 'Next PDF, loading'"
                :class="{ 'is-hidden': index !== visibleFrame }"
                :tabindex="index === visibleFrame ? 0 : -1"
                @load="onFrameLoad(index)"
              />
            </template>
          </template>
          <p
            v-if="!result"
            class="pg-waiting"
          >
            {{ ready || error ? 'No PDF yet. Fix the template to render it.' : 'Loading the compiler and the PDF engine (about 600 KB) for the first render…' }}
          </p>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.pg {
  --pg-error: light-dark(#c62828, #ff8a80);
  --pg-code-bg: light-dark(#fbfbfc, color-mix(in oklab, var(--muted) 55%, var(--background)));
  --pg-fg: var(--foreground);
  --pg-gutter: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: calc(100dvh - var(--docs-header));
  min-height: 560px;
  padding: 16px var(--pg-gutter) var(--pg-gutter);
  max-width: var(--docs-max);
  margin: 0 auto;
}

.pg-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 24px;
  align-items: flex-end;
  justify-content: space-between;
}

.pg-intro h1 {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 650;
  letter-spacing: -0.01em;
}

.pg-intro p {
  margin: 4px 0 0;
  max-width: 44rem;
  font-size: 0.875rem;
  color: var(--muted-foreground);
}

.pg-examples,
.pg-switch {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--border);
  border-radius: var(--docs-r-box);
  background: var(--muted);
}

.pg-examples button,
.pg-switch button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 12px;
  border: 0;
  border-radius: var(--docs-r-control);
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--muted-foreground);
  background: none;
  cursor: pointer;
}

.pg-examples button:hover,
.pg-switch button:hover {
  color: var(--foreground);
}

.pg-examples button[aria-pressed='true'],
.pg-switch button[aria-pressed='true'] {
  color: var(--foreground);
  background: var(--background);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.08), 0 0 0 1px var(--border);
}

:is(.pg-examples, .pg-switch, .pg-tools) :is(button, a):focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 1px;
}

.pg-switch {
  display: none;
}

.pg-panes {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
  flex: 1;
  min-height: 0;
}

.pg-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--docs-r-panel);
  background: var(--card);
}

.pg-pane-bar {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 42px;
  padding: 0 8px 0 14px;
  border-bottom: 1px solid var(--border);
  font-size: 0.8125rem;
  color: var(--muted-foreground);
}

.pg-file {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-mono);
  font-size: 0.75rem;
}

.pg-file svg {
  width: 14px;
  height: 12px;
}

.pg-tools {
  display: inline-flex;
  gap: 4px;
}

.pg-tool {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--docs-r-control);
  font: inherit;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--foreground);
  background: var(--background);
  text-decoration: none;
  white-space: nowrap;
  cursor: pointer;
}

.pg-tool:hover {
  background: var(--muted);
}

.pg-editor-wrap {
  flex: 1;
  min-height: 0;
}

/* CodeMirror draws no focus ring of its own; show one for keyboard focus. */
.pg-editor-wrap:has(:focus-visible) {
  outline: 2px solid var(--ring);
  outline-offset: -2px;
}

.pg-problems:empty {
  display: none;
}

.pg-problem {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 10px;
  align-items: start;
  max-height: 12rem;
  overflow: auto;
  padding: 10px 14px;
  border-top: 1px solid color-mix(in oklab, var(--pg-error) 35%, var(--border));
  background: color-mix(in oklab, var(--pg-error) 7%, var(--card));
  font-size: 0.8125rem;
}

.pg-problem code {
  padding: 1px 6px;
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--pg-error);
  background: color-mix(in oklab, var(--pg-error) 12%, transparent);
}

.pg-problem p {
  margin: 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.pg-problem .pg-tool {
  grid-column: 2;
  justify-self: start;
}

.pg-problem.is-warning {
  border-top-color: color-mix(in oklab, var(--warning) 40%, var(--border));
  background: color-mix(in oklab, var(--warning) 8%, var(--card));
}

.pg-problem.is-warning code {
  color: var(--warning);
  background: color-mix(in oklab, var(--warning) 12%, transparent);
}

.pg-problem a {
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.pg-hint {
  flex: none;
  margin: 0;
  padding: 6px 14px;
  border-top: 1px solid var(--border);
  font-size: 0.6875rem;
  color: var(--muted-foreground);
}

.pg-status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.pg-dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--success);
}

.pg-dot.is-busy {
  background: var(--warning);
  animation: pg-pulse 1s ease-in-out infinite alternate;
}

.pg-dot.is-error {
  background: var(--pg-error);
}

@keyframes pg-pulse {
  to {
    opacity: 0.35;
  }
}

@media (prefers-reduced-motion: reduce) {
  .pg-dot.is-busy {
    animation: none;
  }
}

.pg-stage {
  position: relative;
  flex: 1;
  min-height: 0;
  background: light-dark(#e9ebee, #2a2a2e);
}

.pg-stage iframe {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
  transition: opacity 0.2s ease;
}

.pg-stage iframe.is-hidden {
  visibility: hidden;
}

.pg-stage.is-stale iframe {
  opacity: 0.45;
}

.pg-waiting {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin: 0;
  padding: 24px;
  font-size: 0.875rem;
  text-align: center;
  color: var(--muted-foreground);
}

@media (max-width: 899px) {
  .pg {
    height: auto;
    min-height: 0;
  }

  .pg-switch {
    display: flex;
    align-self: stretch;
  }

  .pg-switch button {
    flex: 1;
    justify-content: center;
  }

  .pg-panes {
    display: block;
  }

  .pg-pane {
    height: max(420px, calc(100dvh - var(--docs-header) - 120px));
  }

  .pg-panes[data-view='code'] .pg-preview,
  .pg-panes[data-view='pdf'] .pg-source {
    display: none;
  }

  .pg-hint {
    display: none;
  }
}
</style>
