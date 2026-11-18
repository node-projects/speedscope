# Large trace performance follow-up

Baseline: `eb93425`, reviewed 2026-11-18. These changes continue the open-issue
review, prioritizing large profiles and the export request in issue #89.

## Changes

- Both profile builders index grouped children once a node reaches 16 children.
  Narrow nodes keep the small linear scan; construction indexes are released at
  build completion. Wide/inverted trees no longer scan thousands of siblings for
  every sample. Existing frame identities are reused without allocating candidates.
- Evented builders skip frame/node weight updates when the timestamp delta is zero.
  Deep enter/leave sequences at identical timestamps avoid repeated depth scans.
- Folded input produces samples one at a time. Text readers also yield lines
  lazily across decoded chunks, avoiding arrays of every line/sample in the file.
- V8 heap profiles use an iterative, allocation-driven traversal instead of
  recursive indexing/size passes and materialized ancestor paths. Empty branches
  stay empty, and the importer no longer retains call-frame objects in a global
  cache. A 20,000-level heap regression verifies depth handling and byte totals.
- Interactive export uses a lazy call-event iterator and JSON Blob chunks. It
  yields every 16,384 events and 4,096 source frames using message tasks (with a
  timer fallback), reports progress and supports
  cancellation. It does not construct another full event-object tree or a single
  trace-sized JSON string. Downloads release their object URLs after starting.
- Known aggregate importers (folded, Callgrind, pprof, Haskell, PMCStat, Instruments
  table copies and V8 heap trees) and derived aggregate profiles disable Time Order. Optional
  `isChronological` and `isDerived` fields in this fork's file format retain those
  properties through export/reimport. Existing files default to chronological,
  original captures when metadata is absent. Cloning/export no longer loses derived provenance and causes
  combined views to be counted again when originals are combined.

## Local measurements

Single-process Node smoke measurements on this Windows machine; timings and
garbage collection vary. The PLC capture contains 1,039,851 input events and four
profiles. Its export contains 1,039,656 call events and 17,510 source frames.
Private capture data is not committed.

| Operation | Baseline | Updated |
| --- | ---: | ---: |
| Combine PLC profiles | 427 ms | 368 ms |
| Invert combined PLC stacks | 5,315 ms | 562 ms |
| Group combined PLC stacks by file | 29 ms | 26 ms |
| Import 500,000 repeated folded stacks | 657 ms | 451 ms |
| Folded import heap at completion | 276 MiB | 62 MiB |
| Folded process peak RSS | 449 MiB | 177 MiB |

The folded fixture is 500,000 repetitions of `root;main;worker;leaf 1`. It
isolates temporary parsing allocations; real captures with many distinct stacks
retain more call-tree data. Both implementations produce total weight 500,000.
The PLC transformations preserve the combined busy weight exactly.

For the 52,619,139-byte PLC JSON export, the legacy blocking serializer on the
current profile model took 410 ms with sampled peak JS heap of 301 MiB. The new
cooperative serializer took 857 ms with sampled peak heap of 237 MiB and 73
progress updates. Starting heap after forced collection was 131 MiB in each case.
This reduces sampled additional export heap from 170 to 106 MiB, with higher elapsed
time in exchange for responsive progress and cancellation. Process peak RSS stayed
around 984–987 MiB because input parsing dominates it. These samples do not prove
a hard memory bound or a cross-browser speedup.

To reproduce against an available capture:

```powershell
node scripts/benchmark-profile.mjs "C:\path\capture.trace.gz" all
node scripts/benchmark-profile.mjs "C:\path\capture.trace.gz" import
node scripts/benchmark-profile.mjs "C:\path\capture.trace.gz" legacy-export
node scripts/benchmark-profile.mjs "C:\path\capture.trace.gz" export
```

The wrapper bundles the existing importer with embedded WASM and runs a separate
Node process. `all` measures aggregate transforms; `import` reports completion heap
and peak RSS. Export modes force collection after import before measuring export.
Run benchmarks without other CPU/memory-heavy jobs. `legacy-export` remains a
benchmark comparison; interactive downloads use cooperative serialization.

## Verification and remaining limits

Regression tests cover wide-node lookup bounds and frame identity, restarting
construction after sorting, deep recursive weight accounting, lazy Unicode line
iteration, exact JSON/export round trips, cancellation before/during event and
source-frame batches, URL cleanup, aggregate navigation and persisted provenance.

Browser testing with the PLC capture verified visible progress, cancellation,
completed download, disabled Time Order for aggregates and combined-stack
inversion. The downloaded JSON was compared exactly with the standard exporter,
then reimported with all profile totals preserved.

Import parsing and derived transformations still run on the main thread. They
remain in-memory operations; lazy folded parsing does not make JSON or binary
imports streaming. Export retains the final Blob bytes and source profile, while
bounding temporary serialization chunks (apart from an individually huge string).
Worker-backed import/transforms, cancellation during import, signed comparisons
and synchronized multitrack timelines remain separate architectural follow-ups.
