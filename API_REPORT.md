# Public API declaration report

This file is derived from the built declarations and is intentionally checked
in. Rebuild with `pnpm build && pnpm api:write`; CI verifies it with
`pnpm test:api`. Package code and generated `#pdf` registries remain the
canonical sources.

## Package root

Source: `dist/types.d.mts`

```ts
export { type RemoteAssetOptions } from '../dist/runtime/server/assets/remote.js'

export { type PdfLimitsOptions } from '../dist/runtime/server/render-limits.js'

export { type PdfFontDeclaration, type PdfFontStyle, type PdfFontWeight, type PdfFontWeightName } from '../dist/runtime/fonts.js'

export { type PdfLength, type PdfLengthOrPercentage, type PdfPercentage, type PdfStyle, type PdfStyleEntry, type PdfStyleValue } from '../dist/runtime/authoring.js'

export { type PdfBaseProps, type PdfBookmark, type PdfCircleProps, type PdfClipPathProps, type PdfDefsProps, type PdfDocumentProps, type PdfEllipseProps, type PdfGProps, type PdfImageProps, type PdfImageSource, type PdfLineProps, type PdfLinearGradientProps, type PdfLinkProps, type PdfNoteProps, type PdfPageDimension, type PdfPageProps, type PdfPageSize, type PdfPageSizeName, type PdfPageUnit, type PdfPathProps, type PdfPolygonProps, type PdfPolylineProps, type PdfRadialGradientProps, type PdfRectProps, type PdfStopProps, type PdfSvgLength, type PdfSvgNumber, type PdfSvgPresentationProps, type PdfSvgProps, type PdfSvgTransform, type PdfSvgTransformOperation, type PdfTextProps, type PdfTspanProps, type PdfViewProps } from '../dist/runtime/components/index.js'

export { default } from './module.mjs'

export { type ModuleOptions } from './module.mjs'
```

## Nuxt module

Source: `dist/module.d.mts`

```ts
import * as _nuxt_schema from '@nuxt/schema';
import { RemoteAssetOptions } from '../dist/runtime/server/assets/remote.js';
export { RemoteAssetOptions } from '../dist/runtime/server/assets/remote.js';
import { PdfLimitsOptions } from '../dist/runtime/server/render-limits.js';
export { PdfLimitsOptions } from '../dist/runtime/server/render-limits.js';
import { PdfFontDeclaration } from '../dist/runtime/fonts.js';
export { PdfFontDeclaration, PdfFontStyle, PdfFontWeight, PdfFontWeightName } from '../dist/runtime/fonts.js';
export { PdfLength, PdfLengthOrPercentage, PdfPercentage, PdfStyle, PdfStyleEntry, PdfStyleValue } from '../dist/runtime/authoring.js';
export { PdfBaseProps, PdfBookmark, PdfCircleProps, PdfClipPathProps, PdfDefsProps, PdfDocumentProps, PdfEllipseProps, PdfGProps, PdfImageProps, PdfImageSource, PdfLineProps, PdfLinearGradientProps, PdfLinkProps, PdfNoteProps, PdfPageDimension, PdfPageProps, PdfPageSize, PdfPageSizeName, PdfPageUnit, PdfPathProps, PdfPolygonProps, PdfPolylineProps, PdfRadialGradientProps, PdfRectProps, PdfStopProps, PdfSvgLength, PdfSvgNumber, PdfSvgPresentationProps, PdfSvgProps, PdfSvgTransform, PdfSvgTransformOperation, PdfTextProps, PdfTspanProps, PdfViewProps } from '../dist/runtime/components/index.js';

interface ModuleOptions {
    fonts?: readonly PdfFontDeclaration[];
    remote?: RemoteAssetOptions;
    /**
     * Canonical render, tree, image, remote-request, and output budgets. Every
     * field is an optional positive safe integer; omitted fields use the
     * documented built-in defaults.
     */
    limits?: PdfLimitsOptions;
}
declare const _default: _nuxt_schema.NuxtModule<ModuleOptions, ModuleOptions, false>;

export { _default as default };
export type { ModuleOptions };
```

## Test entry

Source: `dist/test.d.mts`

```ts
import { PdfRenderResult } from '../dist/runtime/shared/template.js';
import { Component } from 'vue';
import { ModuleOptions } from './module.mjs';
import '@nuxt/schema';
import '../dist/runtime/server/assets/remote.js';
import '../dist/runtime/server/render-limits.js';
import '../dist/runtime/fonts.js';
import '../dist/runtime/authoring.js';
import '../dist/runtime/components/index.js';

/** Raw PDF (or PNG) bytes accepted by the low-level readers. */
type PdfData = ArrayBuffer | Uint8Array;
/** Anything the public `parsePdf`/`rasterizePdf` accept: bytes or a render result. */
type PdfInput = PdfData | PdfRenderResult;
interface PdfAnnotationReference {
    generation: number;
    number: number;
}
type PdfAnnotationDestination = string | Array<string | number | null | PdfAnnotationReference>;
interface PdfAnnotation {
    annotationType?: number;
    destination?: PdfAnnotationDestination;
    rect?: number[];
    subtype: string;
    unsafeUrl?: string;
    url?: string;
}
/** A link annotation flattened to the fields users assert against. */
interface ParsedPdfLink {
    /** 1-based page the link sits on. */
    page: number;
    /** Named internal destination (e.g. a `#id` target), when the link is internal. */
    destination?: string;
    /** External URL, when the link points outside the document. */
    url?: string;
}
/** A normalized PDF.js text run for tolerant layout and typography assertions. */
interface ParsedPdfTextRun {
    direction: string;
    fontName: string;
    fontSize: number;
    height: number;
    text: string;
    width: number;
    x: number;
    y: number;
}
interface ParsedPdfPage {
    annotations: PdfAnnotation[];
    height: number;
    number: number;
    rawText: string;
    text: string;
    textItems: string[];
    textRuns: ParsedPdfTextRun[];
    width: number;
}
interface PdfOutlineItem {
    title: string;
    /** Initial viewer state for entries with children. Absent on leaf entries. */
    expanded?: boolean;
    children: PdfOutlineItem[];
}
interface ParsedPdf {
    pageCount: number;
    pages: ParsedPdfPage[];
    /** Every link annotation in the document, flattened across pages. */
    links: ParsedPdfLink[];
    /** The bookmark tree (outline), including initial expansion state. */
    outline: PdfOutlineItem[];
}
interface RasterizePdfOptions {
    background?: string;
    scale?: number;
}
interface PdfPageImage {
    height: number;
    number: number;
    pixels: Uint8ClampedArray;
    png: Uint8Array;
    width: number;
}
interface PageImageComparison {
    changedPixelRatio: number;
    changedPixels: number;
    dimensionsMatch: boolean;
    matches: boolean;
    maxChannelDifference: number;
    pageNumbersMatch: boolean;
    totalPixels: number;
}
/** Resolve any accepted input (bytes or a `PdfRenderResult`) to raw PDF bytes. */
declare function toPdfBytes(input: PdfInput): Promise<Uint8Array>;
/** Parse stable, semantic information from every page of a PDF. */
declare function parsePdf(input: PdfInput): Promise<ParsedPdf>;
/** Rasterize every PDF page independently for deterministic page-level diffs. */
declare function rasterizePdf(input: PdfInput, options?: RasterizePdfOptions): Promise<PdfPageImage[]>;

/**
 * Error thrown by the `expectPdf` helpers. Named so test runners surface it like
 * their own assertion errors, without this module depending on any runner.
 */
declare class PdfAssertionError extends Error {
    constructor(message: string);
}
interface ToContainTextOptions {
    /** Restrict the search to a single 1-based page. */
    page?: number;
}
type LinkQuery = {
    destination: string;
    page?: number;
} | {
    url: string;
    page?: number;
} | {
    destination: string;
    url: string;
    page?: number;
};
/** A partial outline shape: title is required; state and children are optional. */
interface OutlineShape {
    title: string;
    expanded?: boolean;
    children?: OutlineShape[];
}
interface PdfExpectation {
    toHavePageCount(count: number): PdfExpectation;
    toContainText(text: string, options?: ToContainTextOptions): PdfExpectation;
    toHaveLink(query: LinkQuery): PdfExpectation;
    toHaveOutline(shape: OutlineShape[]): PdfExpectation;
}
/**
 * Fluent, runner-agnostic assertions over a `ParsedPdf`. Every method returns the
 * same expectation so calls chain, and throws a `PdfAssertionError` on failure
 * with a message naming what was expected and what the document actually holds.
 */
declare function expectPdf(parsed: ParsedPdf): PdfExpectation;

/** User-shaped render policy, matching the corresponding Nuxt module options. */
type RenderPdfTemplateOptions = Pick<ModuleOptions, 'limits' | 'remote'>;
interface RenderedPdfTemplate {
    /** The rendered PDF bytes. */
    bytes: Uint8Array;
    /** The parsed document, ready for `expectPdf`. */
    parsed: ParsedPdf;
    /** The underlying completed result (diagnostics, bytes, buffer, and response). */
    result: PdfRenderResult;
}
/**
 * Render a Vue PDF component through the real Nuxt PDF pipeline — mount, asset
 * resolution, font registration, single- or multi-pass layout — without booting
 * Nuxt, then parse the bytes so a test can assert against them immediately.
 */
declare function renderPdfTemplate<Props extends object>(component: Component, props: Props, options?: RenderPdfTemplateOptions): Promise<RenderedPdfTemplate>;

/** User-shaped SFC render configuration, matching the Nuxt module options. */
type RenderPdfSfcOptions = RenderPdfTemplateOptions & Pick<ModuleOptions, 'fonts'>;
/** Compile a real PDF SFC graph with the same compiler used by the Nuxt module. */
declare function loadPdfSfc(filename: string): Promise<Component>;
/** Compile and render a real `pdfs/*.vue` template with production resource handling. */
declare function renderPdfSfc<Props extends object>(filename: string, props: Props, options?: RenderPdfSfcOptions): Promise<RenderedPdfTemplate>;

interface ComparePdfSnapshotOptions {
    /** Directory for expected, actual, diff, and JSON failure artifacts. */
    artifactDir?: string;
    /** Maximum ratio of changed pixels allowed per page (default 0.005). */
    threshold?: number;
    /** Maximum per-channel RGBA difference for a matching pixel (default 25). */
    channelThreshold?: number;
    /** Raster scale (default 1). */
    scale?: number;
    /**
     * Write the current render as the reviewed baseline instead of comparing.
     * Defaults to `process.env.UPDATE_PDF_BASELINES === '1'`.
     */
    update?: boolean;
}
interface PdfSnapshotResult {
    /** Whether the render matched the reviewed baseline. */
    matches: boolean;
    /** Whether the baseline was (re)written this run. */
    updated: boolean;
    /** Per-page comparison detail (empty when the baseline was written). */
    pages: PageImageComparison[];
}
/**
 * Compare a rendered PDF against a directory of reviewed per-page PNG baselines,
 * following the `UPDATE_PDF_BASELINES` review policy. With `update` (or the env
 * flag) set, it (re)writes the baselines and returns; otherwise it rasterizes the
 * document, checks every page against `baselineDir/page-N.png`, and throws a
 * `PdfAssertionError` on any mismatch.
 */
declare function comparePdfSnapshot(input: PdfInput, baselineDir: string, options?: ComparePdfSnapshotOptions): Promise<PdfSnapshotResult>;

export { PdfAssertionError, comparePdfSnapshot, expectPdf, loadPdfSfc, parsePdf, rasterizePdf, renderPdfSfc, renderPdfTemplate, toPdfBytes };
export type { ComparePdfSnapshotOptions, LinkQuery, OutlineShape, ParsedPdf, ParsedPdfLink, ParsedPdfPage, ParsedPdfTextRun, PdfExpectation, PdfInput, PdfOutlineItem, PdfPageImage, PdfSnapshotResult, RasterizePdfOptions, RenderPdfSfcOptions, RenderPdfTemplateOptions, RenderedPdfTemplate, ToContainTextOptions };
```
