// Writes our corrected copy of the layout step (D19 in internals/decisions.md):
// the published `@react-pdf/layout` files plus the exact edits below.
//
//   node scripts/vendor-layout.mjs           write src/runtime/server/engine/layout/
//   node scripts/vendor-layout.mjs --check   fail when the committed copy differs
//
// Update drill: src/runtime/server/engine/CONTRACTS.md, "Updating the engine".
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const sourceDir = join(root, 'node_modules/@react-pdf/layout')
const targetDir = join(root, 'src/runtime/server/engine/layout')

const PACKAGE = '@react-pdf/layout'
const VERSION = '4.6.1'
/** SHA-256 of the published files the edits were written against. */
const UPSTREAM_SHA256 = {
  'index.js': '2ffeffd20f99db9426b98d74bf09ea19e050e657dda5cbd1b6ac2f08754ccf34',
  'index.d.ts': 'd8f09359cd5286b317efc9983761e26d714dc3ea2b88116292ad5dbbd18399af',
}

/**
 * Each edit replaces one exact string that occurs once in the upstream file.
 * Causes and proof: internals/harness-r1/causes.md.
 */
const EDITS = [
  {
    file: 'index.js',
    reason: 'measureText: a text in a box narrower than its container keeps one box width, min(width, linesWidth), for its align offset and for every split part. A squeezed line is wider than the box by its natural advance, and a split part measured only its own lines, so lines sat off by up to a space (T3).',
    find: `            node.alignOffset = (width - linesWidth(node)) * alignFactor; // Compensate align in variable width containers
        }
        return {
            height: linesHeight(node),
            width: Math.min(width, linesWidth(node)),
        };`,
    replace: `            // The lines are aligned in \`width\`; the box is min(width, linesWidth)
            // wide. A squeezed line keeps its natural advance, wider than the box.
            // Split parts copy this width, so each part keeps the alignment of
            // the whole text instead of measuring only its own lines.
            node.alignedBoxWidth = Math.min(width, linesWidth(node));
            node.alignOffset = (width - node.alignedBoxWidth) * alignFactor; // Compensate align in variable width containers
        }
        return {
            height: linesHeight(node),
            width: Math.min(width, node.alignedBoxWidth ?? linesWidth(node)),
        };`,
  },
  {
    file: 'index.js',
    reason: 'getLineBreak: a text whose lines all fit keeps them all; the orphans and widows checks moved a short text in a box taller than its lines (a stretched table cell) to the next page entirely (T4).',
    find: `    if (slicedLine === 0) {
        return 0;
    }
    if (linesQuantity < orphans) {`,
    replace: `    if (slicedLine === 0) {
        return 0;
    }
    // Every line fits: the box is only taller than its lines (stretched).
    if (slicedLine >= linesQuantity) {
        return linesQuantity;
    }
    if (linesQuantity < orphans) {`,
  },
  {
    file: 'index.js',
    reason: 'getLineBreak: the lines of a text start below its top border and top padding, so the room for lines is the room below them. Measured from the box top, a padded text kept a last line that ended below the page edge by up to its top padding, and the line was lost (T5).',
    find: `    const top = node.box?.top || 0;
    const widows = node.props.widows || 2;`,
    replace: `    const top = (node.box?.top || 0) + (node.box?.borderTopWidth || 0) + (node.box?.paddingTop || 0);
    const widows = node.props.widows || 2;`,
  },
  {
    file: 'index.js',
    reason: 'splitNode: a min height no longer keeps a split part taller than the room left on the page (E2 overlap).',
    find: `    current.style.height = height - nodeTop;
    const nextHeight = hasFixedHeight(node)`,
    replace: `    current.style.height = height - nodeTop;
    // A min height must not keep the current part taller than the room left; the
    // next part keeps only what this page did not use.
    const minHeight = node.style?.minHeight;
    if (typeof minHeight === 'number') {
        current.style.minHeight = Math.min(minHeight, height - nodeTop);
    }
    const nextHeight = hasFixedHeight(node)`,
  },
  {
    file: 'index.js',
    reason: 'splitNode: the next part keeps the rest of the min height (E2 overlap).',
    find: `    if (nextHeight) {
        next.style.height = nextHeight;
    }
    return [current, next];`,
    replace: `    if (nextHeight) {
        next.style.height = nextHeight;
    }
    if (typeof minHeight === 'number') {
        next.style.minHeight = Math.max(0, minHeight - (height - nodeTop));
    }
    return [current, next];`,
  },
  {
    file: 'index.js',
    reason: 'shouldBreak: a nested forced break with no flow content before it on the page moves nothing, so pagination ends (F5).',
    find: `const shouldBreak = (child, futureElements, height, previousElements) => {`,
    replace: `const shouldBreak = (child, futureElements, height, previousElements, pageHasContent) => {`,
  },
  {
    file: 'index.js',
    reason: 'shouldBreak: ignore that pointless forced break (F5).',
    find: `    const breakingImprovesPresence = previousElements.filter((node) => !isFixed(node)).length > 0;
    return (getBreak(child) ||`,
    replace: `    const breakingImprovesPresence = previousElements.filter((node) => !isFixed(node)).length > 0;
    // Nested: a forced break with no flow content before it on this page moves nothing.
    const breakingIsPointless = pageHasContent === false && !breakingImprovesPresence;
    return ((getBreak(child) && !breakingIsPointless) ||`,
  },
  {
    file: 'index.js',
    reason: 'splitNodes: pass down whether the page already has content above this container (E1, E2, F5); the children of a row split side by side, each one in both parts, a row with nothing to show below other content moves whole, and a next part of blank parts only is dropped (T4).',
    find: `const splitNodes = (height, contentArea, nodes) => {`,
    replace: `// The children of a row container sit side by side, not one below the other.
const isRowContainer = (node) => typeof node.style?.flexDirection === 'string' && node.style.flexDirection.startsWith('row');
// A node paints something: a text with a line, a leaf other than a view, or a
// container with such a node inside.
const showsContent = (node) => {
    if (isText$1(node))
        return Array.isArray(node.lines) && node.lines.length > 0;
    if (Array.isArray(node.children) && node.children.length > 0)
        return node.children.some(showsContent);
    return node.type !== P.View;
};
const emptyRowParts = new WeakSet();
// A view paints its own box: a background or a border.
const paintsBox = (node) => Boolean(node.style?.backgroundColor)
    || ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'].some((key) => (node.box?.[key] || 0) > 0);
// A node that is known to paint nothing: an empty row part, a text with no line,
// or a view with no background or border whose children are all blank. Only
// such parts may be dropped, so a coloured box is never lost at a page end.
const isBlank = (node) => {
    if (emptyRowParts.has(node))
        return true;
    if (isText$1(node))
        return !paintsBox(node) && !(Array.isArray(node.lines) && node.lines.length > 0);
    if (node.type !== P.View || paintsBox(node))
        return false;
    return (node.children || []).every((child) => isFixed(child) || isBlank(child));
};
// The part of a row child on a page where it has nothing to show: the box keeps
// its width and its place, so the children after it keep their columns. It has
// no render callback, so resolvePageIndices cannot lay it out again with lines.
const emptyRowPart = (node) => {
    const style = omit(['height', 'minHeight'], Object.assign({}, node.style, {
        marginTop: 0,
        paddingTop: 0,
        borderTopWidth: 0,
        borderTopLeftRadius: 0,
        borderTopRightRadius: 0,
    }));
    const part = Object.assign({}, node, {
        box: Object.assign({}, node.box, { top: 0, height: 0, borderTopWidth: 0 }),
        style,
        props: omit('render', node.props || {}),
    });
    if (isText$1(node))
        part.lines = [];
    else
        part.children = [];
    emptyRowParts.add(part);
    return part;
};
// Where a row child's content ends. A row stretches its children to its height,
// so a text box can be taller than its lines; a text whose lines fit stays whole
// (getLineBreak would move a short text below its orphans and widows entirely).
const rowChildEnd = (node) => isText$1(node) && Array.isArray(node.lines)
    ? getTop(node) + (node.box.borderTopWidth || 0) + (node.box.paddingTop || 0) + heightAtLineIndex(node, node.lines.length)
    : getTop(node) + node.box.height;
// The children of a row split side by side: each one is in both parts, split,
// whole, or as an empty part, so every child keeps its column on both pages
// (T4). A row with nothing to show on this page moves whole below other
// content: the caller sees no current children (and the orphan rule then sees
// a header alone). On a page with no content above it, moving gains nothing and
// the caller would keep the whole row there, so its content below the page end
// would be lost; the row splits instead.
const splitRowNodes = (height, contentArea, nodes, pageHasContent) => {
    const currentChildren = [];
    const nextChildren = [];
    for (const child of nodes) {
        if (isFixed(child)) {
            currentChildren.push(child);
            nextChildren.push(child);
            continue;
        }
        const nodeTop = getTop(child);
        if (height <= nodeTop) {
            const box = Object.assign({}, child.box, { top: child.box.top - height });
            currentChildren.push(emptyRowPart(child));
            nextChildren.push(Object.assign({}, child, { box }));
            continue;
        }
        if (height + SAFETY_THRESHOLD < rowChildEnd(child)) {
            const [currentChild, nextChild] = split(child, height, contentArea, pageHasContent);
            currentChildren.push(currentChild);
            // A view that ended on this page has no next part (splitView).
            nextChildren.push(nextChild || emptyRowPart(child));
            continue;
        }
        currentChildren.push(child);
        nextChildren.push(emptyRowPart(child));
    }
    if (pageHasContent && !currentChildren.some((node) => !isFixed(node) && showsContent(node)))
        return [[], nodes];
    // Everything ended on this page: the blank parts make no next part.
    if (nextChildren.every((node) => isFixed(node) || isBlank(node)))
        return [currentChildren, nextChildren.filter(isFixed)];
    return [currentChildren, nextChildren];
};
const splitNodes = (height, contentArea, nodes, pageHasContent, inRow) => {
    if (inRow)
        return splitRowNodes(height, contentArea, nodes, pageHasContent);`,
  },
  {
    file: 'index.js',
    reason: 'splitNodes: shouldBreak gets that page state (F5).',
    find: `        const shouldBreak$1 = shouldBreak(child, futureNodes, height, currentChildren);`,
    replace: `        const shouldBreak$1 = shouldBreak(child, futureNodes, height, currentChildren, pageHasContent);`,
  },
  {
    file: 'index.js',
    reason: 'splitNodes: a nested container is kept whole on the page only when the page is really empty, so no text is lost (E1, E2); a text with no line on this page moves whole, so it is not painted again on the next page (F4).',
    find: `            const [currentChild, nextChild] = split(child, height, contentArea);
            // All children are moved to the next page, it doesn't make sense to show the parent on the current page
            if (child.children.length > 0 && currentChild.children.length === 0) {
                // But if the current page is empty then we can just include the parent on the current page
                if (currentChildren.length === 0) {`,
    replace: `            const contentBefore = Boolean(pageHasContent) || currentChildren.some((node) => !isFixed(node));
            const [currentChild, nextChild] = split(child, height, contentArea, contentBefore);
            // A text with no line on this page moves whole: an empty fragment would keep
            // its id (a destination on the wrong page) and its render callback (it is
            // laid out again with all its lines by resolvePageIndices). Only below other
            // content, so a line higher than the page cannot move forever. Rows split
            // in splitRowNodes, where a text keeps its place.
            if (isText$1(child) && currentChild.lines.length === 0 && contentBefore) {
                nextChildren.push(nextChild);
                continue;
            }
            // All children are moved to the next page, it doesn't make sense to show the parent on the current page
            if (child.children.length > 0 && currentChild.children.length === 0) {
                // But if the current page is empty then we can just include the parent on the current page
                if (currentChildren.length === 0 && !pageHasContent) {`,
  },
  {
    file: 'index.js',
    reason: 'splitNodes: a page end drops the bottom margin of a child kept whole above it, as split parts already lose theirs; otherwise a page-number text is measured again in the room above that margin and loses its line (G1).',
    find: `        currentChildren.push(child);
    }
    return [currentChildren, nextChildren];`,
    replace: `        // The box fits but its bottom margin crosses the page end. The current part of
        // the parent is as high as the room left, so a dynamic text, laid out again by
        // resolvePageIndices, would get only the room above that margin and could drop
        // its last line. Like a split part, it loses the whole margin: a margin cut to
        // the exact room leaves no slack for Yoga's float rounding.
        const marginBottom = child.box.marginBottom || 0;
        if (marginBottom > 0 && nodeTop + nodeHeight + marginBottom > height + SAFETY_THRESHOLD) {
            const style = Object.assign({}, child.style, { marginBottom: 0 });
            currentChildren.push(Object.assign({}, child, { style }));
            continue;
        }
        currentChildren.push(child);
    }
    return [currentChildren, nextChildren];`,
  },
  {
    file: 'index.js',
    reason: 'splitPage: the page is laid out again after its page-number texts render with no fixed height, so the content they add does not shrink every box on the page below its lines (G3).',
    find: `    const dynamicPage = resolveDynamicPage({ pageNumber }, page, fontStore, yoga);`,
    replace: `    // The box height is the content height of the last layout, in which the
    // page-number texts had no lines yet. Rendered, they are higher; laid out
    // again at the old height, the content would overflow it and Yoga would
    // shrink every box (flexShrink defaults to 1) below its lines.
    const unsplitPage = Object.assign({}, page, { box: omit('height', page.box) });
    const dynamicPage = resolveDynamicPage({ pageNumber }, unsplitPage, fontStore, yoga);`,
  },
  {
    file: 'index.js',
    reason: 'splitPage: a page starts with no flow content, so a forced break on its first flow element is ignored there too and adds no empty page (G2, D20).',
    find: `    const [currentChilds, nextChilds] = splitNodes(wrapArea, contentArea, dynamicPage.children);`,
    replace: `    const [currentChilds, nextChilds] = splitNodes(wrapArea, contentArea, dynamicPage.children, false, isRowContainer(dynamicPage));`,
  },
  {
    file: 'index.js',
    reason: 'splitChildren, splitView, split: thread the page state into nested containers (E1, E2, F5); a view whose flow children all ended on the page has no next part, so a table header does not start a page alone (T4).',
    find: `const splitChildren = (height, contentArea, node) => {
    const children = node.children || [];
    const availableHeight = height - getTop(node);
    return splitNodes(availableHeight, contentArea, children);
};
const splitView = (node, height, contentArea) => {
    const [currentNode, nextNode] = splitNode(node, height);
    const [currentChilds, nextChildren] = splitChildren(height, contentArea, node);`,
    replace: `const splitChildren = (height, contentArea, node, pageHasContent) => {
    const children = node.children || [];
    const availableHeight = height - getTop(node);
    return splitNodes(availableHeight, contentArea, children, pageHasContent, isRowContainer(node));
};
const splitView = (node, height, contentArea, pageHasContent) => {
    const [currentNode, nextNode] = splitNode(node, height);
    const [currentChilds, nextChildren] = splitChildren(height, contentArea, node, pageHasContent);
    // All flow children ended on this page, and no height carries over: no next
    // part. Otherwise a box whose bottom padding crosses the page end would start
    // a page with only its fixed children, such as a table header (T4).
    const flow = (nodes) => nodes.some((child) => !isFixed(child));
    if (flow(node.children || []) && flow(currentChilds) && !flow(nextChildren)
        && node.style?.height === undefined && node.style?.minHeight === undefined) {
        return [assingChildren(currentChilds, currentNode), null];
    }`,
  },
  {
    file: 'index.js',
    reason: 'split: pass the page state to splitView (E1, E2, F5).',
    find: `const split = (node, height, contentArea) => isText$1(node) ? splitText(node, height) : splitView(node, height, contentArea);`,
    replace: `const split = (node, height, contentArea, pageHasContent) => isText$1(node) ? splitText(node, height) : splitView(node, height, contentArea, pageHasContent);`,
  },
  {
    file: 'index.d.ts',
    reason: 'The package does not ship the globals.d.ts this line points to; next to our sources it would be a missing file.',
    find: `/// <reference path="../globals.d.ts" />\n`,
    replace: '',
  },
]

const sha256 = text => createHash('sha256').update(text).digest('hex')

const header = (file) => {
  const reasons = EDITS.filter(edit => edit.file === file).map(edit => ` *  - ${edit.reason}`)
  return [
    '/*',
    ` * ${PACKAGE} ${VERSION}, lib/${file}, with the edits listed below.`,
    ' * Source: https://github.com/diegomura/react-pdf (packages/layout).',
    ' * License: MIT (the "license" field of the published package.json); the full',
    ' * license text is in THIRD_PARTY_NOTICES.md, section "React PDF".',
    ' *',
    ' * Generated by scripts/vendor-layout.mjs. Do not edit by hand.',
    ...(reasons.length > 0 ? [' *', ' * Edits:', ...reasons] : []),
    ' */',
    '',
  ].join('\n')
}

const build = () => {
  const outputs = {}
  for (const [file, expected] of Object.entries(UPSTREAM_SHA256)) {
    const upstream = readFileSync(join(sourceDir, 'lib', file), 'utf8')
    const actual = sha256(upstream)
    if (actual !== expected) {
      throw new Error(`${PACKAGE}/lib/${file} has SHA-256 ${actual}, expected ${expected} (version ${VERSION}). `
        + 'Upstream changed: follow "Updating the engine" in src/runtime/server/engine/CONTRACTS.md.')
    }
    let text = upstream
    for (const edit of EDITS.filter(edit => edit.file === file)) {
      const count = text.split(edit.find).length - 1
      if (count !== 1) {
        throw new Error(`Edit "${edit.reason}" matches ${count} times in ${file}; it must match exactly once.`)
      }
      text = text.replace(edit.find, () => edit.replace)
    }
    outputs[file] = header(file) + text
  }
  return outputs
}

const installed = JSON.parse(readFileSync(join(sourceDir, 'package.json'), 'utf8'))
if (installed.version !== VERSION) {
  throw new Error(`Installed ${PACKAGE} is ${installed.version}, the edits are for ${VERSION}.`)
}

const outputs = build()
if (process.argv.includes('--check')) {
  const stale = Object.entries(outputs).filter(([file, text]) => {
    let committed
    try {
      // Git may check the copy out with CRLF line ends on Windows.
      committed = readFileSync(join(targetDir, file), 'utf8').replaceAll('\r\n', '\n')
    }
    catch {
      return true
    }
    return committed !== text
  })
  if (stale.length > 0) {
    console.error(`The layout copy differs from ${PACKAGE} ${VERSION} plus the edits: ${stale.map(([file]) => `src/runtime/server/engine/layout/${file}`).join(', ')}. Run pnpm vendor:layout.`)
    process.exit(1)
  }
  console.log(`The layout copy matches ${PACKAGE} ${VERSION} plus ${EDITS.length} edits.`)
}
else {
  mkdirSync(targetDir, { recursive: true })
  for (const [file, text] of Object.entries(outputs)) writeFileSync(join(targetDir, file), text)
  console.log(`Wrote src/runtime/server/engine/layout/ from ${PACKAGE} ${VERSION} with ${EDITS.length} edits.`)
}
