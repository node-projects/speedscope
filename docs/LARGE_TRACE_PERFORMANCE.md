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

## Worker import and search follow-up

Large input files (at least 1 MiB of input bytes) named `.json`, `.trace`,
`.cpuprofile` or `.heapprofile`, optionally gzip-compressed, now use a browser
worker when available. The existing format detector is reused, preserving its
dispatch order. HTTP/profileURL, local File and CLI base64 loading use this path.
Input buffers and numeric profile tables transfer ownership instead of being
JSON-serialized or cloned as full call-tree objects. File inputs can be read in
the worker. Symbols are demangled there before returning immutable profile data.

The UI shows import progress and cancellation. Cancellation terminates the worker;
new loads and unmounts cancel old imports, and stale results cannot replace newer
profiles or clear their loading state. The worker is released before UI object
reconstruction, which yields between bounded batches so it can also be cancelled.
Worker creation blocked by a host can fall back to the ordinary importer. An
unexpected worker crash reports an error rather than trying a detached buffer.
Small files and other filename extensions retain the ordinary importer; that
synchronous fallback cannot be interrupted during parsing.

The worker code is embedded by the build plugin, so both HTTP and offline builds
can create it without fetching a worker script or WASM from an external host.
The transport is an internal implementation detail, not a public interchange API.

Tests cover numeric/string frame identity, recursion, source locations, formatting,
aggregate/derived flags, idle ranges, transferred buffers, deep trees, invalid
references, cancellation, worker cleanup, host fallback and stale-load races.
The PLC worker import was cancelled interactively while parsing, then completed;
its exported JSON matched the ordinary importer exactly (four profiles, 17,510
frames and 1,039,656 call events). A local snapshot smoke check measured 214 ms to
encode the PLC profiles and 34,602,732 bytes of numeric tables (excluding frame
strings and metadata). Browser elapsed-time/peak-RSS speedups are not claimed.

Search also supports literal whole-word and exact matching. Patterns are reused
per query and file-only checks avoid allocating name highlight ranges. Unicode
word boundaries, punctuation, escaped metacharacters and full-name/path matching
have regressions. User-provided regex is still not enabled.

Profile trees and rendering remain in-memory operations. Unsupported formats
still use the original full-document importer. UI hydration and rendering have
costs, and transferring work can increase overall elapsed time even while making
the interface responsive. This does not fix every OOM report. Derived
transformations remain synchronous. Export retains the final
Blob bytes and source profile while bounding temporary serialization chunks
(apart from an individually huge string). An out-of-core model, heap budgets,
worker-backed transforms, signed comparisons and synchronized timelines remain
separate follow-ups in [the maintained backlog](ISSUE_BACKLOG.md).

## Streaming duration traces

Large duration-event `.json`/`.trace` files, optionally gzip-compressed, now use
incremental parsing inside the worker. A local File is streamed without reading
its whole contents; transferred ArrayBuffers are consumed in 64 KiB slices.
Native `DecompressionStream` inflates gzip incrementally. The streaming parser
([@streamparser/json](https://github.com/juanjoDiaz/streamparser-json), pinned at
0.0.26) releases completed event objects from its parent array. We retain the
duration events, naming metadata and first event needed by the existing Hermes
discriminator, dropping unused event fields and ignored events. Event arguments
remain intact because they participate in frame identities.

This avoids a full inflated byte buffer, a whole JSON string and a complete
parsed input object. Out-of-order traces still need stable sorting, so retained
events and constructed trees continue to scale with the capture. This is not an
out-of-core profile store or a hard bound on total JavaScript/browser memory.

The streaming path rejects excessive input complexity before returning a profile:

| Limit | Default |
| --- | ---: |
| Decompressed input | 1 GiB |
| Pending event/metadata bytes between completed events | 16 MiB |
| Retained event source bytes | 256 MiB |
| Input events, including ignored events | 2,000,000 |
| JSON nesting depth | 128 |

Checks run before bounded parser writes and while tokens/events are emitted.
The pending-byte check is conservative at chunk boundaries. These are source
complexity limits, not heap accounting: object overhead, expanded Unicode,
sorting, call-tree nodes, numeric snapshots, hydration and GPU resources have
additional costs. A limit failure stops with an actionable error; it never
silently truncates the trace or retries the full importer. Cancellation releases
the reader and terminates the worker; source cancellation failures cannot hide
the original error.

Native CPU/heap/speedscope files and known filename overrides retain their
detector. CPU markers anywhere in the stream, sample tables, duplicate root
`traceEvents` properties and unrecognized wrapper properties return to that
detector, preserving their original semantics. Those fallback formats do not
gain these streaming budgets. Gzip also falls back when native decompression is
unavailable. URL/CLI loading still buffers the input response before transfer;
local File streaming avoids that buffer. Tolerated trailing commas and missing
final `]` after complete array events remain supported. Incomplete values and
corrupt gzip fail rather than producing a partial result.

Validation includes every duration-trace fixture against the ordinary importer,
one-byte UTF-8/escape boundaries, late metadata, argument identity, unordered and
anonymous events, sampled/CPU fallback, ignored payloads, gzip File imports with
whole-file reads forbidden, resource-limit failures, and cancellation races.
The PLC capture exported identically: four profiles, 17,510 frames, 1,039,656
call events and matching totals. Fresh-process Windows/Node 24 import-only runs:

| Path | Import time | Peak RSS | Heap after import |
| --- | ---: | ---: | ---: |
| Ordinary importer | 2,281 ms | 999 MiB | 572 MiB |
| Streaming duration importer | 4,311 ms | 623 MiB | 437 MiB |

This single capture/run measured about 38% lower peak RSS at a latency cost.
Browser peak memory, rendering and worker hydration are not represented by this
Node benchmark. Results vary by machine, input and garbage collection. Reproduce
each path in its own process with `node scripts/benchmark-profile.mjs <capture>
import` and `node scripts/benchmark-profile.mjs <capture> stream-import`.

Issues #519, #347, #478, #386 and #404 remain **partial** in the backlog: the
specific original reproductions and a general bounded-memory profile model still
need work.
