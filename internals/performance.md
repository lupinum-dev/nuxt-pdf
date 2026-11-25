# Performance evidence

## Work budget (in the suite)

The speed budget that must never flake is counted work, not time.
`test/work-budget.test.ts` renders the workloads of
`test/fixtures/performance/workloads.ts` in the test process and compares the
work of the second render with exact numbers:

- `pages` and `passes` of the render's diagnostics;
- `layouts`: full layouts of the document, each layout pass and each
  measuring layout (`layoutPdfTree`);
- `pagesLaidOut`: the pages those layouts produced, summed;
- `pageRelayouts`: pages and page parts that pagination laid out again
  (`layout/paginate`): each part of a split page, and each page whose page
  tokens it rendered;
- `nodesLaidOut`: nodes yoga laid out (`layout/dimensions`), in every
  layout and every relayout of pagination, so a rest laid out further than
  pagination reads shows;
- `rowSpanLayouts`: yoga calculations of a laid-out page again for cells
  over several rows (`layout/dimensions/row-spans.ts`), 0 without such a cell;
- `keepSteps`: siblings that `keepWithNext` walked (`endOfKeep`,
  `layout/paginate/split-keep.ts`); the walk stops one content box below the
  node, so a long chain costs at most a page of steps per node;
- `floatFills`: fills of an area again with one float more (`fillArea`,
  `layout/paginate/builder.ts`), 0 without a float;
- `runsShaped`: text runs a font shaped (`layout` of a fontkit font or a
  standard font), so text laid out again shows;
- `fontsEmbedded` and `imagesEmbedded`: subsets and image XObjects written.

The counters live in `src/runtime/server/engine/work.ts` and are bumped where
the work happens (layout-pass.ts, fonts.ts, standard-fonts.ts,
pdf/fonts.ts, pdf/images.ts, and the layout and pagination steps). A test
reads them with `countedWork`, which counts only the work of the call it
wraps; outside such a call nothing is counted. A change that alters a number either fixes waste (the number goes down)
or adds work on purpose: update the expectation and say why in the commit.

## Wall time (by hand, or in its own CI job)

Performance is measured by `pnpm test:performance`. The harness renders:

- the first invoice in a fresh test process;
- five warm invoices (reported as the median);
- one explicit 100-page document and one converging multi-pass report
  (median of three each after one render to warm up; until 2026-11-23 one
  render each, which the 1.38 times spread below comes from);
- the real-shaped invoice of the work budget (median of three after one
  render that loads its fonts);
- the general terms of the work budget in one column and in two (median of
  three each, alternating, after one render each); with the gate, the two
  columns may take at most 2 times the one column (R7 of the F6 design).
  Measured on a Mac at load 4 (2026-11-23, in process, median of 12): one
  column 76.9 ms, two columns 88.9 ms (1.16 times; 81.1 ms before balancing);
- then, with renders in the test process (`pdfRenderPlacement.inProcess`)
  so the engine's heap is visible: one invoice and one real invoice, the
  retained heap, three real invoices and 100 invoices, and the retained heap
  again.

It records render times, completed output sizes, process peak RSS, the
retained heap after warm-up (`retainedHeapBytes`) and what later renders add
to it (`retainedHeapGrowthBytes`) in `reports/performance.json`, and prints
the report to the log. The retained heap is the heap after two forced full
collections with a turn of the event loop between them; it repeats to 0.1 MB.
The test needs `--expose-gc` in its own process (`execArgv` in
`vitest.performance.config.ts`) and fails without it. CI runs it with `NUXT_PDF_PERF_GATE=1` in the
`performance` job, which is not a required check. By hand, run it the same way
in a Linux/Node 24 environment like the raster job's before you compare results
with the baseline.

The reviewed high-water values live in
`test/fixtures/performance/linux-node24.json`. The retained heap fails above
120% of the reviewed value, and the growth after warm-up fails above 5 MB
(an absolute limit: renders keep nothing, so there is no ratio to take).
Peak RSS fails above 1.5 times the reviewed value: it follows how far V8 lets
the heaps grow before it collects, not what a render keeps. PDF output and
package sizes fail above 110%. Wall time fails
only above 3 times the reviewed value of each `…Ms` metric that has one.
The factor: five
runs on one machine (macOS, load about 7.5, 2026-11-22) spread by up to 1.38
times (warm invoice 13.3 to 17.2 ms, 100 pages 34.8 to 47.9 ms, multi-pass
38.5 to 46.9 ms, real invoice 544 to 599 ms, cold 771 to 1005 ms); 3 times
leaves room for a slower runner and still catches a doubling of the work.
The earlier gate compared each workload with the same run's warm invoice
within 20%, which a noisy runner can fail; it is gone. Update the
file only after inspecting at least three clean fixed-environment runs and
explaining the change in the commit. `UPDATE_PERFORMANCE_BASELINE=1` is an
explicit maintenance action, never a normal CI mode.

These figures are regression evidence, not throughput promises. Host load,
font choice, image decoding, and document complexity materially affect render
time and memory.

## Pagination relayouts and the cut (P2 items (a) and (b), 2026-11-22; removed 2026-11-25)

The pagination before the page builder laid each rest of a page out again
for every split. Item (a) laid each rest out once instead of twice, and item
(b), the pagination cut (`layout/paginate/cut.ts`), laid a rest out only one
content area below its page end. Both left with that pagination in step 7
of the page builder: the builder
fills pages by measured sums and lays each page out once, as a check. The
measurements stay in the git history of this file.

## One pagination path (step 7, 2026-11-25)

`pnpm test:performance`, five runs before the deletion (`ca40ab65`) and five
after (`7f909158`), on one Mac; the load after was 30 to 43 (not recorded
before). Medians:

| metric | before | after | after/before |
|---|---:|---:|---:|
| `coldRenderMs` | 264.2 | 247.3 | 0.94 |
| `warmInvoiceMs` | 10.6 | 11.5 | 1.08 |
| `hundredPagesMs` | 30.5 | 33.2 | 1.09 |
| `multiPassReportMs` | 24.5 | 24.1 | 0.99 |
| `realInvoiceMs` | 588.3 | 588.9 | 1.00 |
| `termsMs` | 159.7 | 160.9 | 1.01 |
| `termsColumnsMs` | 168.2 | 159.8 | 0.95 |
| `peakRssBytes` | 723.3 MB | 663.2 MB | 0.92 |
| `retainedHeapBytes` | 56.6 MB | 54.9 MB | 0.97 |

Every output size is the same. The ranges of the five runs overlap for every
time (100 pages 29.3 to 32.4 ms before, 29.7 to 37.6 ms after; warm invoice
10.4 to 11.7 and 10.4 to 12.3 ms), so the deletion changes no time beyond
the noise: every workload already ran on the builder before it.

## Floats (D49, 2026-11-25)

A float adds no layout pass. Its cost is fills of the area that reaches its
anchor: one fill more for each float placed there (`floatFills`). A float
that is queued (it waits for a later area) costs nothing in the areas it
waits through. Each fill of an area runs in every try that fills it again:
each balancing try of a column row (`columnFill`), each footnote fit
(`noteFits`) and each pagination with a reserve. So the work of a page with
`k` floats reached in one area is about `(1 + k)` fills times the tries of
that page; a document without floats skips `fillArea` and does the same work
as before (the work-budget rows did not change).

Spanning floats add fills of the container's child list: one fill for a
container that fits whole (`withSpanningFloats`), one per split of a
container that goes on, and one more per spanning float reached there, again
times the tries of the page. A column container without a spanning float
takes the old paths. When a float waits because its note does not fit, the
note fit fills the page once more with only the floats that stay
(`Context.only`), so such a page costs one fill more; a page whose floats
all stay, or that has no float, does no extra fill.

A `PdfPageRef` whose digits change a height can move a float to another page
and so change page numbers. That is the existing pass loop: it settles or
ends at `maxPasses` with `PDF_LIMIT_EXCEEDED` (test "settles a page reference
that moves a float, and ends at the pass cap with a typed error" in
`test/floats.test.ts`).

## Memory (measured 2026-11-22, after CI run 32)

CI run 32 failed `peakRssBytes` (606,711,808 against the reviewed 457,000,000
times 1.2). Measured on macOS, Node 24, one process per row (peak RSS is a
high-water mark), scratch scripts with the phases of `test/performance.test.ts`.

Cause of the jump: the real-shaped invoice workload, which `23ba062` added to
the same process. It is not the code of `23ba062`.

| Run (peak RSS, MB) | Before the real invoice | After it | End |
|---|---|---|---|
| current code, all phases | 343 to 377 | 614 to 689 | same |
| current code, without the real invoice | | | 428 to 438 |
| code of `0133984` (before `23ba062`: no shaping cache), all phases | 364 to 381 | 627 | 627 |
| the real invoice alone, current code | | 571 | |
| the real invoice alone, code of `0133984` | | 619 | |

Nothing keeps data after a render. Retained heap after two forced major GCs
with a turn of the event loop between them, renders in-process
(`pdfRenderPlacement.inProcess`) so the engine's heap is visible, two runs:

| After | Retained heap |
|---|---|
| start | 19.5 MB |
| 6 invoices | 41.2 MB |
| 100 pages, multi-pass | 41.3 MB |
| 4 real invoices | 52.4 MB (its three parsed fonts, kept per process by design) |
| 16 real invoices | 51.1 to 52.3 MB |
| 200 more invoices | 50.8 to 52.0 MB |

Heap snapshots after 4 and 12 real renders: 33.6 and 32.1 MB reachable.

Why the gate measured noise: `test:performance` runs
`node --expose-gc vitest.mjs`, but the test runs in a vitest fork that does
not get the flag (`typeof globalThis.gc` is `'undefined'` there), and
`globalThis.gc?.()` then does nothing. `heapTrendBytes` measured uncollected
garbage of the main thread (the engine runs in the render worker), and
`peakRssBytes` measures how far V8 lets the heaps grow before it collects. A
real render leaves a few hundred MB of garbage, so peak RSS grows with the
number of renders between collections: 494 MB after 4 real renders and 642 MB
after 16 (in-process), with the same retained heap.

Since then the test gets `--expose-gc` in its process and gates the retained
heap (above). A seeded leak (each layout kept in a module array) fails the
growth limit with 64 MB kept; the clean run keeps 0.85 MB. `heapTrendBytes`
is gone. `peakRssBytes`, `retainedHeapBytes` and `realInvoiceMs` got their reviewed
values from CI run 35 (Linux, Node 24.22.3, commit `7479089`):
596,676,608 bytes, 52,533,184 bytes and 772 ms (771.61). One CI run is one
sample: after the next two runs the reviewed value of each is the median of
the three. Medians of runs 35, 36 and 37 (round 13, values rounded up as for the
other wall times): hundredPagesMs 42 (41.88), multiPassReportMs 41 (40.30),
warmInvoiceMs 15 (14.49), peakRssBytes 596,676,608, retainedHeapBytes
52,533,184. realInvoiceMs was 470, the median of runs 36 to 38 after
pagination item (a) (448.48, 470.05, 485.02); run 35 ran before item (a), so
its 771.61 does not count. After the pagination cut (item (b)) it is 407, the
median of runs 40, 41 and 42 (641.74 on the slower runner of run 40, 407.27,
375.73). The output byte metrics keep their older, higher
values (CI gives 1,676, 45,201 and 2,774; the gate allows 1.1 times). `retainedHeapGrowthBytes` has its absolute limit (983,432 bytes
in run 35) and no reviewed value.

Since 2026-11-23 `hundredPagesMs` and `multiPassReportMs` are the median of
three renders after one render to warm up, so their reviewed values were taken
again: the medians of CI runs 78, 79 and 80, rounded up, are 51 (30.36, 54.46,
50.34) and 29 (17.26, 29.22, 28.95). Runs 79 and 80 ran on slower runners
(`realInvoiceMs` 629 and 560 against the reviewed 407), which the median of
three takes as it comes.

## Cold render (measured 2026-11-22, after CI run 35)

CI run 35 reported `coldRenderMs` 1,146 against the reviewed 99. Not
re-recorded: the two numbers measure different things.

- The 99 ms is from `4f0e795` (2026-07-22): React PDF, rendered in the test
  process, whose modules vitest had already loaded. The render worker came
  later (`e294db6`, 2026-11-12). The performance test was not in CI before
  round 9, so no run judged the number.
- Today the first render of the test starts a pool worker. From the test,
  the worker loads the engine from TypeScript source: Node strips the types
  of each file and a resolve hook (`worker-pool.ts`, `SOURCE_RESOLVE_HOOK`)
  retries each extensionless import with `.ts`. A built package does neither.

Local numbers (macOS, Node 24, load about 7, fresh process per run; scratch
scripts with the invoice workload):

| Path | Cold render | Warm render |
|---|---|---|
| source, pool worker (what the test measures) | 425 to 450 ms | 13 ms |
| source, in-process | 200 to 240 ms | 11 to 12 ms |
| built runtime (`nuxt-module-build build`), pool worker | 228 to 244 ms | 12 to 14 ms |
| built runtime, in-process | 127 to 129 ms | 11 to 12 ms |

CI runs the warm invoice about 2 times slower than this machine (24 against
12 ms), so 1,146 ms fits the source path. Where the source path spends its
time (main-thread CPU profile): about 114 ms waiting for the resolve hook and
about 74 ms in Node's type stripper (amaro). Of the built cold render: about
90 ms loading the engine modules (file reads, resolution and compilation of
many small files; library tables of linebreak and unicode-properties,
hyphenation patterns, fontkit about 45 ms on its own), about 50 ms of
one-time work in the first render (yoga loads its WASM through `fetch` of a
data URL, about 12 ms with undici; bidi tables; Vue's renderer; standard-font
metrics 2 ms) and the worker start. No eager work of our own showed: the
cold invoice parses no font file, the instance subset module loads in 1 ms,
and comark (Markdown) loads only when a document has Markdown. A Nitro build bundles the worker into one chunk,
so a deployed app loads fewer files than the unbundled build measured here.


Decision (steering, 2026-11-22): one number, measuring what users run.
`coldRenderMs` is now the first render in a fresh Node process that loads
the built runtime from `dist/` and renders through the render worker
(`test/fixtures/performance/cold-render.mjs`, plain JavaScript; the test
checks that its document has the byte length of `invoice` in
`workloads.ts`). The source-path number is gone. The CI performance job
runs `nuxt-module-build build` (the module only, not the docs). Locally the
metric skips itself with one line when `dist/` holds no build; with
`NUXT_PDF_PERF_GATE=1` a missing build fails. The reviewed value in
`linux-node24.json` is 339 ms, the median of CI runs 38, 39 and 40 (338.80,
330.20, 475.52; run 40 ran on a runner about 1.45 times slower in every wall
time). It is about 1.4 times the local built-worker number above (240 ms), as
for the other wall times. The yoga WASM loader (about 12 ms) and the fontkit load (about 45 ms)
stay as they are: not our code, and once per worker.

## Build compile (rounds 14 and 15, 2026-11-23)

Measured by a throwaway script outside the repo that runs `compilePdfSfc` on
every `.vue` file under `playground/` and `test/fixtures/` (44 files) in
development and production mode, 88 compiles, and hashes `code` and `map`.

Calls per template, counted with a mock of the compiler-sfc exports
(deterministic): Babel parses of `<script setup>` 5 to 1 (components 4 to 1),
SFC parses 3 to 2 (3 when the metadata hoist trial runs), `compileScript` 44
to 32 over the 24 templates.

Wall time of the 88 compiles, median of three paired runs on one machine at a
load near 6: 632 ms before (`e181822`) and 599 ms after (`e387928`), about 5%
faster. Single runs spread from 593 to 651 ms, so the time gain is near the
noise; the call counts are the evidence. The module split of round 15 emits
the same bytes for all 88 compiles.
