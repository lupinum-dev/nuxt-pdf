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

export { type PdfInvoiceIssue, type PdfSourcePosition } from '../dist/runtime/shared/errors.js'

export { type PdfImageWarning, type PdfLayoutWarning, type PdfRichTextWarning, type PdfRichTextWarningCode } from '../dist/runtime/shared/template.js'

export { type PdfLength, type PdfLengthOrPercentage, type PdfPercentage, type PdfStyle, type PdfStyleEntry, type PdfStyleValue } from '../dist/runtime/authoring.js'

export { type PdfTableCellProps, type PdfTableColumn, type PdfTableColumnOptions, type PdfTableColumnWidth, type PdfTableHeaderProps, type PdfTableProps, type PdfTableRowProps } from '../dist/runtime/components/table.js'

export { type PdfAttachmentProps, type PdfAttachmentRelationship, type PdfBaseProps, type PdfBookmark, type PdfCheckboxProps, type PdfCircleProps, type PdfClipPathProps, type PdfConformance, type PdfContentsProps, type PdfContentsStyles, type PdfDefsProps, type PdfDocumentProps, type PdfEllipseProps, type PdfFacturXProfile, type PdfFacturXProps, type PdfFacturXRelationship, type PdfFixedPages, type PdfFootnoteProps, type PdfFootnoteStyles, type PdfGProps, type PdfImageProps, type PdfImageSource, type PdfLeaderProps, type PdfLeaderStyle, type PdfLeaderStyleEntry, type PdfLineProps, type PdfLinearGradientProps, type PdfLinkProps, type PdfNoteProps, type PdfPageCountProps, type PdfPageDimension, type PdfPageNumberProps, type PdfPageProps, type PdfPageRefProps, type PdfPageSize, type PdfPageSizeName, type PdfPageUnit, type PdfPathProps, type PdfPermissions, type PdfPolygonProps, type PdfPolylineProps, type PdfPrintingPermission, type PdfProtection, type PdfRadialGradientProps, type PdfRadioProps, type PdfRectProps, type PdfRunning, type PdfRunningAt, type PdfRunningTextProps, type PdfSelectProps, type PdfStopProps, type PdfSvgLength, type PdfSvgNumber, type PdfSvgPresentationProps, type PdfSvgProps, type PdfSvgTransform, type PdfSvgTransformOperation, type PdfTextFieldProps, type PdfTextProps, type PdfTextTag, type PdfTspanProps, type PdfViewProps, type PdfViewTag } from '../dist/runtime/primitives.js'

export { type DecimalInput, type EInvoice, type EInvoiceAddress, type EInvoiceBuyer, type EInvoiceContact, type EInvoiceDelivery, type EInvoiceDocumentAllowanceCharge, type EInvoiceDocumentType, type EInvoiceElectronicAddress, type EInvoiceIssue, type EInvoiceLine, type EInvoiceLineAllowanceCharge, type EInvoiceLineTotals, type EInvoicePayment, type EInvoicePaymentMeans, type EInvoicePeriod, type EInvoicePrecedingInvoice, type EInvoiceProfile, type EInvoiceSeller, type EInvoiceTotals, type EInvoiceUnit, type EInvoiceUnitName, type EInvoiceVat, type EInvoiceVatBreakdown, type EInvoiceVatCategory, type RenderEInvoiceXmlOptions, type ValidateEInvoiceOptions } from '../dist/runtime/einvoice/index.js'

export { type PdfRichBlock, type PdfRichBreak, type PdfRichCode, type PdfRichComponent, type PdfRichFootnote, type PdfRichHeading, type PdfRichImage, type PdfRichInline, type PdfRichJsonValue, type PdfRichLink, type PdfRichList, type PdfRichParagraph, type PdfRichQuote, type PdfRichRule, type PdfRichTable, type PdfRichTableCell, type PdfRichTextIssue, type PdfRichTextRun } from '../dist/runtime/rich-text/index.js'

export { type PdfRichTextProps, type PdfRichTextStyleKey, type PdfRichTextStyles } from '../dist/runtime/components/rich-text.js'

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
export { PdfInvoiceIssue, PdfSourcePosition } from '../dist/runtime/shared/errors.js';
export { PdfImageWarning, PdfLayoutWarning, PdfRichTextWarning, PdfRichTextWarningCode } from '../dist/runtime/shared/template.js';
export { PdfLength, PdfLengthOrPercentage, PdfPercentage, PdfStyle, PdfStyleEntry, PdfStyleValue } from '../dist/runtime/authoring.js';
export { PdfTableCellProps, PdfTableColumn, PdfTableColumnOptions, PdfTableColumnWidth, PdfTableHeaderProps, PdfTableProps, PdfTableRowProps } from '../dist/runtime/components/table.js';
export { PdfAttachmentProps, PdfAttachmentRelationship, PdfBaseProps, PdfBookmark, PdfCheckboxProps, PdfCircleProps, PdfClipPathProps, PdfConformance, PdfContentsProps, PdfContentsStyles, PdfDefsProps, PdfDocumentProps, PdfEllipseProps, PdfFacturXProfile, PdfFacturXProps, PdfFacturXRelationship, PdfFixedPages, PdfFootnoteProps, PdfFootnoteStyles, PdfGProps, PdfImageProps, PdfImageSource, PdfLeaderProps, PdfLeaderStyle, PdfLeaderStyleEntry, PdfLineProps, PdfLinearGradientProps, PdfLinkProps, PdfNoteProps, PdfPageCountProps, PdfPageDimension, PdfPageNumberProps, PdfPageProps, PdfPageRefProps, PdfPageSize, PdfPageSizeName, PdfPageUnit, PdfPathProps, PdfPermissions, PdfPolygonProps, PdfPolylineProps, PdfPrintingPermission, PdfProtection, PdfRadialGradientProps, PdfRadioProps, PdfRectProps, PdfRunning, PdfRunningAt, PdfRunningTextProps, PdfSelectProps, PdfStopProps, PdfSvgLength, PdfSvgNumber, PdfSvgPresentationProps, PdfSvgProps, PdfSvgTransform, PdfSvgTransformOperation, PdfTextFieldProps, PdfTextProps, PdfTextTag, PdfTspanProps, PdfViewProps, PdfViewTag } from '../dist/runtime/primitives.js';
export { DecimalInput, EInvoice, EInvoiceAddress, EInvoiceBuyer, EInvoiceContact, EInvoiceDelivery, EInvoiceDocumentAllowanceCharge, EInvoiceDocumentType, EInvoiceElectronicAddress, EInvoiceIssue, EInvoiceLine, EInvoiceLineAllowanceCharge, EInvoiceLineTotals, EInvoicePayment, EInvoicePaymentMeans, EInvoicePeriod, EInvoicePrecedingInvoice, EInvoiceProfile, EInvoiceSeller, EInvoiceTotals, EInvoiceUnit, EInvoiceUnitName, EInvoiceVat, EInvoiceVatBreakdown, EInvoiceVatCategory, RenderEInvoiceXmlOptions, ValidateEInvoiceOptions } from '../dist/runtime/einvoice/index.js';
export { PdfRichBlock, PdfRichBreak, PdfRichCode, PdfRichComponent, PdfRichFootnote, PdfRichHeading, PdfRichImage, PdfRichInline, PdfRichJsonValue, PdfRichLink, PdfRichList, PdfRichParagraph, PdfRichQuote, PdfRichRule, PdfRichTable, PdfRichTableCell, PdfRichTextIssue, PdfRichTextRun } from '../dist/runtime/rich-text/index.js';
export { PdfRichTextProps, PdfRichTextStyleKey, PdfRichTextStyles } from '../dist/runtime/components/rich-text.js';

interface ModuleOptions {
    fonts?: readonly PdfFontDeclaration[];
    remote?: RemoteAssetOptions;
    /**
     * Canonical render, tree, image, remote-request, and output budgets. Every
     * field is an optional whole number from 1 (time limits up to
     * 2,147,483,647 ms); omitted fields use the documented built-in defaults.
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
import { PdfRenderResult, PdfComponentProps } from '../dist/runtime/shared/template.js';
export { PdfComponentProps } from '../dist/runtime/shared/template.js';
import { Component } from 'vue';
import { ModuleOptions } from './module.mjs';
import '@nuxt/schema';
import '../dist/runtime/server/assets/remote.js';
import '../dist/runtime/server/render-limits.js';
import '../dist/runtime/fonts.js';
import '../dist/runtime/shared/errors.js';
import '../dist/runtime/authoring.js';
import '../dist/runtime/components/table.js';
import '../dist/runtime/primitives.js';
import '../dist/runtime/einvoice/index.js';
import '../dist/runtime/rich-text/index.js';
import '../dist/runtime/components/rich-text.js';

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
interface ParsePdfOptions {
    /**
     * The open or owner password of a protected PDF. Without the right one,
     * pdf.js fails with a `PasswordException`.
     */
    password?: string;
}
/** Parse stable, semantic information from every page of a PDF. */
declare function parsePdf(input: PdfInput, options?: ParsePdfOptions): Promise<ParsedPdf>;
interface ParsedPdfAttachment {
    filename: string;
    description: string;
    content: Uint8Array;
}
/** Read the embedded files of the document, in the order the PDF lists them. */
declare function getPdfAttachments(input: PdfInput): Promise<ParsedPdfAttachment[]>;
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

/**
 * User-shaped render policy, matching the corresponding Nuxt module options,
 * and the password that opens a protected PDF for parsing.
 */
type RenderPdfTemplateOptions = Pick<ModuleOptions, 'limits' | 'remote'> & Pick<ParsePdfOptions, 'password'>;
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
declare function renderPdfTemplate<C extends Component>(component: C, props: PdfComponentProps<C>, options?: RenderPdfTemplateOptions): Promise<RenderedPdfTemplate>;

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

export { PdfAssertionError, comparePdfSnapshot, expectPdf, getPdfAttachments, loadPdfSfc, parsePdf, rasterizePdf, renderPdfSfc, renderPdfTemplate, toPdfBytes };
export type { ComparePdfSnapshotOptions, LinkQuery, OutlineShape, ParsePdfOptions, ParsedPdf, ParsedPdfAttachment, ParsedPdfLink, ParsedPdfPage, ParsedPdfTextRun, PdfExpectation, PdfInput, PdfOutlineItem, PdfPageImage, PdfSnapshotResult, RasterizePdfOptions, RenderPdfSfcOptions, RenderPdfTemplateOptions, RenderedPdfTemplate, ToContainTextOptions };
```

## Standalone build entry

Source: `dist/build.d.mts`

```ts
import { PdfFontDeclaration } from '../dist/runtime/fonts.js';
import { RemoteAssetOptions } from '../dist/runtime/server/assets/remote.js';
import { PdfLimitsOptions } from '../dist/runtime/server/render-limits.js';

interface BuildPdfRegistryOptions {
    /** Trusted application root containing pdfs/. Not request input. */
    rootDir: string;
    /** Dedicated generated directory inside rootDir and outside pdfs/. */
    outDir: string;
    fonts?: readonly PdfFontDeclaration[];
    limits?: PdfLimitsOptions;
    remote?: RemoteAssetOptions;
}
/** Compile trusted templates and embed admitted resources before deployment. */
declare function buildPdfRegistry(options: BuildPdfRegistryOptions): Promise<void>;

export { buildPdfRegistry };
export type { BuildPdfRegistryOptions };
```

## Standalone server entry

Source: `dist/server.d.mts`

```ts
export { PdfRegistry, PdfRegistryEntries, createPdfRegistry, createPdfTemplate } from '../dist/runtime/server/registry.js';
export { NuxtPdfError, PDF_ERROR_CODES, PdfErrorCode, PdfInvoiceIssue, PdfSourcePosition } from '../dist/runtime/shared/errors.js';
export { DecimalInput, EInvoice, EInvoiceAddress, EInvoiceBuyer, EInvoiceContact, EInvoiceDelivery, EInvoiceDocumentAllowanceCharge, EInvoiceDocumentType, EInvoiceElectronicAddress, EInvoiceIssue, EInvoiceLine, EInvoiceLineAllowanceCharge, EInvoiceLineTotals, EInvoicePayment, EInvoicePaymentMeans, EInvoicePeriod, EInvoicePrecedingInvoice, EInvoiceProfile, EInvoiceSeller, EInvoiceTotals, EInvoiceUnit, EInvoiceUnitName, EInvoiceVat, EInvoiceVatBreakdown, EInvoiceVatCategory, RenderEInvoiceXmlOptions, ValidateEInvoiceOptions, computeEInvoice, renderEInvoiceXml, validateEInvoice } from '../dist/runtime/einvoice/index.js';
export { ParseRichTextMarkdownOptions, PdfRichBlock, PdfRichBreak, PdfRichCode, PdfRichComponent, PdfRichFootnote, PdfRichHeading, PdfRichImage, PdfRichInline, PdfRichJsonValue, PdfRichLink, PdfRichList, PdfRichParagraph, PdfRichQuote, PdfRichRule, PdfRichTable, PdfRichTableCell, PdfRichTextIssue, PdfRichTextRun, parseRichTextHtml, parseRichTextMarkdown, validateRichText } from '../dist/runtime/rich-text/index.js';
export { PdfComponentProps, PdfDefinition, PdfImageWarning, PdfLayoutWarning, PdfRenderResult, PdfTemplate } from '../dist/runtime/shared/template.js';
```
