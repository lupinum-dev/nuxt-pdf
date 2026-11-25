// `unimport` for the playground worker: the Vue auto-imports a PDF SFC gets in
// a Nuxt app (`computed`, `ref`, ...). The real package reads the file system
// to build its presets; the playground needs only the Vue names.
import { babelParse } from "vue/compiler-sfc";

const VUE_AUTO_IMPORTS = new Set([
  "computed", "customRef", "defineAsyncComponent", "defineComponent", "effectScope", "getCurrentInstance",
  "getCurrentScope", "h", "inject", "isProxy", "isReactive", "isReadonly", "isRef", "markRaw", "nextTick",
  "onBeforeMount", "onBeforeUnmount", "onBeforeUpdate", "onMounted", "onScopeDispose", "onUnmounted",
  "onUpdated", "provide", "reactive", "readonly", "ref", "resolveComponent", "shallowReactive",
  "shallowReadonly", "shallowRef", "toRaw", "toRef", "toRefs", "toValue", "triggerRef", "unref",
  "useAttrs", "useId", "useSlots", "watch", "watchEffect", "watchPostEffect", "watchSyncEffect",
]);

type Node = { type: string; [key: string]: unknown };

const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && typeof (value as Node).type === "string";

/** Names the code reads and names it declares anywhere (a shadowing local wins). */
const namesOf = (code: string) => {
  const used = new Set<string>();
  const declared = new Set<string>();
  const declare = (node: unknown): void => {
    if (!isNode(node)) return;
    if (node.type === "Identifier") declared.add(String(node.name));
    else if (node.type === "ObjectPattern") for (const property of node.properties as Node[]) declare(property.type === "RestElement" ? property.argument : property.value);
    else if (node.type === "ArrayPattern") for (const element of node.elements as Node[]) declare(element);
    else if (node.type === "AssignmentPattern") declare(node.left);
    else if (node.type === "RestElement") declare(node.argument);
  };
  const visit = (node: Node, parent?: Node, key?: string): void => {
    if (node.type === "Identifier") {
      const isPropertyName = (parent?.type === "MemberExpression" && key === "property" && !parent.computed)
        || ((parent?.type === "ObjectProperty" || parent?.type === "ObjectMethod") && key === "key" && !parent.computed);
      if (!isPropertyName) used.add(String(node.name));
    }
    if (node.type === "VariableDeclarator") declare(node.id);
    if (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") declare(node.id);
    if (node.type === "ImportSpecifier" || node.type === "ImportDefaultSpecifier" || node.type === "ImportNamespaceSpecifier") declare(node.local);
    if (node.type.includes("Function")) for (const param of (node.params as Node[] | undefined) ?? []) declare(param);
    for (const [childKey, value] of Object.entries(node)) {
      if (childKey === "loc") continue;
      if (Array.isArray(value)) {
        for (const child of value) if (isNode(child)) visit(child, node, childKey);
      }
      else if (isNode(value)) visit(value, node, childKey);
    }
  };
  visit(babelParse(code, { sourceType: "module", plugins: ["typescript"] }).program as unknown as Node);
  return { used, declared };
};

const mapOf = (source: string) => ({
  toString: () => JSON.stringify({ version: 3, file: source, mappings: "", names: [], sources: [source] }),
});

export const createUnimport = () => ({
  async injectImports(code: string, filename: string) {
    const { used, declared } = namesOf(code);
    const names = [...VUE_AUTO_IMPORTS].filter((name) => used.has(name) && !declared.has(name));
    const text = names.length > 0 ? `import { ${names.join(", ")} } from 'vue';\n${code}` : code;
    return { s: { toString: () => text, generateMap: () => mapOf(filename) } };
  },
});
