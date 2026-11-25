// The playground editor: CodeMirror 6 with Vue SFC highlighting in the docs'
// code colours (github-light by day, catppuccin-mocha by night). CodeEditor.vue
// loads this module in the browser only, so it stays out of the server bundle
// and out of every other docs page.
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { vue } from "@codemirror/lang-vue";
import { bracketMatching, HighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { type Diagnostic, lintGutter, setDiagnostics } from "@codemirror/lint";
import { EditorState, type Text } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { tags } from "@lezer/highlight";

/** A render error with a place in the source (1-based line and column). */
export interface Problem {
  line: number;
  column?: number;
  message: string;
}

const colour = (light: string, dark: string) => `light-dark(${light}, ${dark})`;

const highlight = HighlightStyle.define([
  { tag: [tags.angleBracket, tags.punctuation, tags.bracket], color: colour("#24292e", "#94e2d5") },
  { tag: tags.tagName, color: colour("#22863a", "#89b4fa") },
  { tag: tags.attributeName, color: colour("#6f42c1", "#f9e2af") },
  { tag: [tags.string, tags.attributeValue], color: colour("#032f62", "#a6e3a1") },
  { tag: [tags.keyword, tags.operatorKeyword, tags.modifier, tags.controlKeyword, tags.definitionKeyword], color: colour("#d73a49", "#cba6f7") },
  { tag: [tags.comment, tags.blockComment, tags.lineComment], color: colour("#6a737d", "#9399b2"), fontStyle: "italic" },
  { tag: [tags.number, tags.bool, tags.null, tags.unit], color: colour("#005cc5", "#fab387") },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: colour("#6f42c1", "#89b4fa") },
  { tag: [tags.typeName, tags.className], color: colour("#e36209", "#f9e2af") },
  { tag: tags.propertyName, color: colour("#005cc5", "#89dceb") },
  { tag: tags.special(tags.brace), color: colour("#d73a49", "#cba6f7") },
]);

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "13px", color: "var(--pg-fg)", backgroundColor: "var(--pg-code-bg)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "20px", fontVariantLigatures: "none" },
  ".cm-content": { padding: "12px 0", caretColor: "var(--foreground)" },
  ".cm-line": { padding: "0 16px 0 12px" },
  ".cm-gutters": {
    color: "color-mix(in oklab, var(--muted-foreground) 70%, transparent)",
    backgroundColor: "transparent",
    borderRight: "1px solid var(--border)",
  },
  ".cm-lineNumbers .cm-gutterElement": { minWidth: "2.5em", padding: "0 6px 0 8px" },
  ".cm-activeLine": { backgroundColor: "color-mix(in oklab, var(--foreground) 4%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--foreground)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "color-mix(in oklab, var(--primary) 30%, transparent) !important",
  },
  ".cm-matchingBracket": { backgroundColor: "color-mix(in oklab, var(--primary) 22%, transparent)", outline: "none" },
  ".cm-lintRange-error": { backgroundColor: "color-mix(in oklab, var(--pg-error) 14%, transparent)" },
  ".cm-tooltip": { border: "1px solid var(--border)", borderRadius: "6px", backgroundColor: "var(--card)", color: "var(--foreground)" },
  ".cm-diagnostic-error": { borderLeftColor: "var(--pg-error)" },
});

const extensions = (onChange: (text: string) => void) => [
  lineNumbers(),
  highlightActiveLineGutter(),
  history(),
  drawSelection(),
  indentOnInput(),
  bracketMatching(),
  closeBrackets(),
  highlightActiveLine(),
  indentUnit.of("  "),
  EditorState.tabSize.of(2),
  // Tab indents; Esc first lets Tab move focus on, as the hint under the editor says.
  keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
  vue(),
  syntaxHighlighting(highlight),
  lintGutter(),
  theme,
  EditorView.contentAttributes.of({
    "aria-label": "PDF template (Vue single-file component)",
    "aria-describedby": "pg-editor-hint",
    "spellcheck": "false",
    "autocapitalize": "off",
    "autocorrect": "off",
  }),
  EditorView.updateListener.of((update) => {
    if (update.docChanged) onChange(update.state.doc.toString());
  }),
];

/** The document offset of a 1-based line and column, kept inside the document. */
const offsetOf = (doc: Text, line: number, column = 1) => {
  const target = doc.line(Math.min(Math.max(1, line), doc.lines));
  return Math.min(target.from + Math.max(0, column - 1), target.to);
};

const diagnosticOf = (doc: Text, problem: Problem): Diagnostic => {
  const target = doc.line(Math.min(Math.max(1, problem.line), doc.lines));
  const from = problem.column ? offsetOf(doc, problem.line, problem.column) : target.from;
  // Mark the word at the column, or the whole line without one.
  const word = /^[\w$-]+/.exec(doc.sliceString(from, target.to))?.[0].length;
  return { from, to: problem.column && word ? from + word : target.to, severity: "error", message: problem.message };
};

export const createEditor = (options: { parent: HTMLElement, doc: string, onChange: (text: string) => void }) => {
  const make = (doc: string) => EditorState.create({ doc, extensions: extensions(options.onChange) });
  const view = new EditorView({ parent: options.parent, state: make(options.doc) });
  return {
    /** Replaces the text from outside (another example, Reset, a shared link); undo starts afresh. */
    setDoc(text: string) {
      if (text !== view.state.doc.toString()) view.setState(make(text));
    },
    setProblem(problem: Problem | undefined) {
      view.dispatch(setDiagnostics(view.state, problem ? [diagnosticOf(view.state.doc, problem)] : []));
    },
    focusAt(line: number, column?: number) {
      view.dispatch({ selection: { anchor: offsetOf(view.state.doc, line, column) }, scrollIntoView: true });
      view.focus();
    },
    destroy: () => view.destroy(),
  };
};

export type PlaygroundEditor = ReturnType<typeof createEditor>;
