<script setup lang="ts">
// The template editor. CodeMirror (./codemirror.ts) loads in the browser after
// the page; until then, and in the server-rendered page, the source shows as
// plain text in the same place.
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import type { PlaygroundEditor, Problem } from "./codemirror";

const props = defineProps<{ problem?: Problem }>();
const source = defineModel<string>({ required: true });

const host = ref<HTMLDivElement>();
const editor = shallowRef<PlaygroundEditor>();

onMounted(async () => {
  const { createEditor } = await import("./codemirror");
  if (!host.value) return;
  editor.value = createEditor({
    parent: host.value,
    doc: source.value,
    onChange: (text) => {
      source.value = text;
    },
  });
  editor.value.setProblem(props.problem);
});

onBeforeUnmount(() => editor.value?.destroy());

watch(source, (text) => editor.value?.setDoc(text));
watch(() => props.problem, (problem) => editor.value?.setProblem(problem));

/** Puts the caret at a 1-based line and column and scrolls it into view. */
const focusAt = (line: number, column?: number) => editor.value?.focusAt(line, column);

defineExpose({ focusAt });
</script>

<template>
  <div class="pg-editor">
    <div
      ref="host"
      class="pg-editor-host"
    />
    <pre
      v-if="!editor"
      class="pg-editor-fallback"
    >{{ source }}</pre>
  </div>
</template>

<style scoped>
.pg-editor {
  position: relative;
  height: 100%;
  min-height: 0;
  background: var(--pg-code-bg);
}

.pg-editor-host {
  height: 100%;
}

.pg-editor-fallback {
  position: absolute;
  inset: 0;
  overflow: hidden;
  margin: 0;
  padding: 12px 16px 12px calc(2.5em + 26px);
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 20px;
  white-space: pre;
  color: var(--pg-fg);
  background: none;
  border: 0;
  border-radius: 0;
}
</style>
