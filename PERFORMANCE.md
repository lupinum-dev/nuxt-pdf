# Performance evidence

Performance is measured by `pnpm test:performance`. The harness renders:

- the first invoice in a fresh test process;
- five warm invoices (reported as the median);
- one explicit 100-page document;
- one converging multi-pass report;
- 100 sequential invoices for retained-heap evidence.

It records render times, completed output sizes, process peak RSS, and heap trend
in `reports/performance.json`. Scheduled CI runs the harness in the same pinned
Linux/Node 24 environment as raster evidence and uploads that report.

The reviewed high-water values live in
`test/fixtures/performance/linux-node24.json`. Time and memory fail above 120%
of the reviewed value; PDF output and package sizes fail above 110%. Update the
file only after inspecting at least three clean fixed-environment runs and
explaining the change in the commit. `UPDATE_PERFORMANCE_BASELINE=1` is an
explicit maintenance action, never a normal CI mode.

These figures are regression evidence, not throughput promises. Host load,
font choice, image decoding, and document complexity materially affect render
time and memory.
