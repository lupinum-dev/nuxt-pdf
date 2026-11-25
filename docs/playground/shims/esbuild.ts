// `esbuild` for the playground worker. The SFC compiler calls `transform` only
// to remove TypeScript syntax; the module stays ESM. esbuild is native code, so
// the worker blanks the type-only syntax out of Babel's AST instead (Babel
// ships inside Vue's SFC compiler). Columns and lines stay where they were.
import { babelParse } from "vue/compiler-sfc";

type Node = { type: string; start: number; end: number; [key: string]: unknown };
type Range = [start: number, end: number];

const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && typeof (value as Node).type === "string";

const TYPE_ONLY_STATEMENTS = new Set([
  "TSTypeAliasDeclaration",
  "TSInterfaceDeclaration",
  "TSDeclareFunction",
  "TSModuleDeclaration",
]);

/** The source ranges that only TypeScript reads. */
const typeRanges = (program: Node): Range[] => {
  const ranges: Range[] = [];
  const visit = (node: Node, parent?: Node): void => {
    if (node.type === "TSEnumDeclaration") {
      throw new SyntaxError("enum is not supported in the playground. Use a union of strings.");
    }
    if (TYPE_ONLY_STATEMENTS.has(node.type) || (node.type === "ImportDeclaration" && node.importKind === "type")) {
      ranges.push([node.start, node.end]);
      return;
    }
    if (node.type === "ExportNamedDeclaration" && (node.exportKind === "type" || (isNode(node.declaration) && TYPE_ONLY_STATEMENTS.has(node.declaration.type)))) {
      ranges.push([node.start, node.end]);
      return;
    }
    if (node.type === "ImportSpecifier" && node.importKind === "type") {
      ranges.push([node.start, node.end]);
      return;
    }
    if (
      node.type === "TSTypeAnnotation"
      || node.type === "TSTypeParameterDeclaration"
      || node.type === "TSTypeParameterInstantiation"
    ) {
      ranges.push([node.start, node.end]);
      return;
    }
    if (node.type === "TSAsExpression" || node.type === "TSSatisfiesExpression") {
      const expression = node.expression as Node;
      ranges.push([expression.end, node.end]);
      visit(expression, node);
      return;
    }
    if (node.type === "TSNonNullExpression") {
      ranges.push([node.end - 1, node.end]);
      visit(node.expression as Node, node);
      return;
    }
    // `name?: Type` in a parameter list: the question mark is TypeScript's.
    if (node.type === "Identifier" && node.optional === true && parent && parent.type !== "OptionalMemberExpression") {
      const annotation = node.typeAnnotation as Node | undefined;
      const nameEnd = node.start + String(node.name).length;
      ranges.push([nameEnd, annotation ? annotation.start : node.end]);
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "loc" || key === "leadingComments" || key === "trailingComments" || key === "innerComments") continue;
      if (Array.isArray(value)) {
        for (const child of value) if (isNode(child)) visit(child, node);
      }
      else if (isNode(value)) visit(value, node);
    }
  };
  visit(program);
  return ranges;
};

/** `import { a, type B } from 'x'` leaves `import { a,  } from 'x'`, which is valid JavaScript. */
const blank = (code: string, ranges: Range[]): string => {
  // Babel's offsets count UTF-16 code units, as `split('')` does.
  const chars = code.split("");
  for (const [start, end] of ranges) {
    for (let index = start; index < end; index++) {
      if (chars[index] !== "\n") chars[index] = " ";
    }
  }
  return chars.join("");
};

export const stripTypes = (code: string): string => {
  const program = babelParse(code, { sourceType: "module", plugins: ["typescript"] }).program as unknown as Node;
  return blank(code, typeRanges(program));
};

export const transform = async (code: string, options: { loader?: string }) => ({
  code: options.loader === "ts" ? stripTypes(code) : code,
  map: "",
  warnings: [],
});
