<script setup lang="ts">
// The PDF drawn page by page with pdf.js, for phones and tablets: their browsers
// show a PDF in a frame as its first page only (iOS, iPadOS) or not at all
// (Android). pdf.js and its worker load on first use, on this page only.
import { onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = defineProps<{ pdf: ArrayBuffer }>();

const pages = ref<HTMLDivElement>();
const failed = ref(false);

let pdfjs: Promise<typeof import("pdfjs-dist")> | undefined;
let worker: Worker | undefined;
const load = () => pdfjs ??= import("pdfjs-dist").then((module) => {
  worker = new Worker(new URL("./pdf.worker.ts", import.meta.url), { type: "module" });
  module.GlobalWorkerOptions.workerPort = worker;
  return module;
});

// Only the newest PDF may replace the pages; an older render stops early.
let latest = 0;
/** The width the pages were drawn for; 0 while the pane is hidden (phone layout). */
let drawnWidth = 0;
const render = async (pdf: ArrayBuffer) => {
  const width = pages.value?.clientWidth ?? 0;
  // Hidden: the observer draws this PDF once the pane has a width again.
  drawnWidth = width;
  if (width === 0) return;
  const id = ++latest;
  const { getDocument } = await load();
  // pdf.js takes over the buffer it gets; the result keeps its own.
  const loading = getDocument({ data: new Uint8Array(pdf.slice(0)) });
  const document_ = await loading.promise;
  try {
    // At most 2×: Safari limits the memory of all canvases on a page, and a
    // long document at 3× would pass it on a phone. 2× is still sharp.
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const canvases: HTMLCanvasElement[] = [];
    for (let number = 1; number <= document_.numPages; number++) {
      const page = await document_.getPage(number);
      const size = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: (width / size.width) * ratio });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.aspectRatio = `${size.width} / ${size.height}`;
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", `Page ${number} of ${document_.numPages}`);
      await page.render({ canvas, viewport }).promise;
      if (id !== latest) return;
      canvases.push(canvas);
    }
    pages.value?.replaceChildren(...canvases);
    failed.value = false;
  }
  finally {
    await loading.destroy();
  }
};

const show = (pdf: ArrayBuffer) => render(pdf).catch(() => {
  failed.value = true;
});

let resize: ResizeObserver | undefined;

onMounted(() => {
  // Draw again when the pane appears or its width changes (rotation, resizing).
  resize = new ResizeObserver(() => {
    const width = pages.value?.clientWidth ?? 0;
    if (width > 0 && Math.abs(width - drawnWidth) > 24) show(props.pdf);
  });
  if (pages.value) resize.observe(pages.value);
  show(props.pdf);
});
watch(() => props.pdf, show);
onBeforeUnmount(() => {
  latest++;
  resize?.disconnect();
  worker?.terminate();
});
</script>

<template>
  <div class="pg-pages">
    <div ref="pages" />
    <p
      v-if="failed"
      class="pg-pages-failed"
    >
      The pages could not be drawn here. Use Open or Download above.
    </p>
  </div>
</template>

<style scoped>
.pg-pages {
  position: absolute;
  inset: 0;
  overflow: auto;
  padding: 12px;
  -webkit-overflow-scrolling: touch;
}

.pg-pages :deep(canvas) {
  display: block;
  width: 100%;
  height: auto;
  margin-bottom: 12px;
  background: #fff;
  border-radius: 2px;
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.25);
}

.pg-pages-failed {
  margin: 0;
  padding: 16px;
  text-align: center;
  color: var(--muted-foreground);
}
</style>
