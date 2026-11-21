# Large trace performance follow-up

## Bounded late-range Tracks seeking (2026-11-21)

Tracks can now seek into an existing sample sequence instead of replaying every
call event before a late viewport. A lazy index records at most 4,096 sample
ordinals and their exact sequential clocks, using at most 49,152 numeric bytes
per profile. A session LRU caches at most 32 completed indices (1.5 MiB of
checkpoint arrays), and releases them on recording/clock replacement or leaving
Tracks. It does not retain a stack per checkpoint, add a full interval tree or
change exported profiles. Existing profile models and temporary active stacks
still scale with recording size and depth.

Cold index construction scans weights once and yields cooperatively; later
viewports binary-search a nearby checkpoint and reconstruct its existing stack.
Clipping, original node identities, rectangle ranking and omission counts remain
the same. Cancellation and stale-builder detection reject incomplete indices.
Zero-duration deep samples also no longer trigger a false hidden-depth notice.

The maintained `node scripts/benchmark-profile.mjs <capture> stream-tracks`
command compares ten late ranges of the first aligned profile using both full
and indexed extraction. It checks exact tile identity/order/coordinates, depth
flags and omission counts, and reports cold build time, numeric index bytes,
retained heap, event visits and raw per-range timings. Index arrays are reported
separately from JS heap. This measures extraction after import, not browser
frame rate, whole-app memory or out-of-core storage.

Three alternating fresh-process Windows/Node runs compared archived `899b138`
with this change on the private PLC trace. The viewport covered 94%–97% of the
shared recording span, with four visible profiles and 3,000 rectangles per row.
Cold indexed extraction includes index construction; warm extractions reuse it.

| Metric | Full iteration | Bounded seek |
| --- | ---: | ---: |
| Main-profile events visited | 996,783 | 29,433 |
| Four-profile events visited | 1,009,743 | 30,119 |
| Warm main-profile median | 299.70 ms | 24.81 ms |
| Warm main-profile observed range | 245.11–409.81 ms | 13.32–233.23 ms |
| Cold main-profile observed range | 269.51–408.41 ms | 20.02–263.21 ms |
| Four-profile retained JS heap, including extracted tiles | 0.429–0.498 MiB | 0.433–0.543 MiB |

All runs retained the same 3,341 rectangles, omitted the same 11,673 intervals
and preserved original nodes/coordinates, ordering and hidden-depth flags.
The four numeric indices occupy 91,260 bytes, separately from the retained JS
heap measurement. This is an extraction-speed improvement with a small explicit
index allocation, not a claim of lower overall heap. Timing ranges include OS
and runtime outliers and do not guarantee browser latency.

The PLC still has four stack profiles, 17,510 frames and 1,039,656 call events.
The shared-frame/profile payload SHA-256 remains
`53b28f954a000a144a4b88d6806a8e20a79ee58b3ef748067d132232977bd75b`;
that comparison excludes group-level counter metadata. Browser checks exercised
rapid late-range zoom/pan and markers, then recording replacement and the
authored shared-clock example without errors. Private input and ignored
benchmark archives are excluded from Git.

Validation passed 731 tests across 107 Jest suites with 310 snapshots, five Node
tests, type checking, linting, schema/backlog checks, all three builds and npm
contents checks. Regressions cover sequential floating clocks, zero weights,
20,000-level stack reconstruction, checkpoint/cache limits, cancellation,
stale-builder rejection and source/clock ownership. The dense counter UI test
forces cooperative yields and waits for observable rendering completion.

## Counter charts and bounded generic decompression (2026-11-21)

[Counter tracks](COUNTERS.md) preserve independent numeric observations instead
of creating stack frames or measured durations. Counter-only groups, native
roundtrips, worker transfer/hydration and chunked export are supported. Internal
counter data is capped at 256 series, two million observations and 32,000,000
unique numeric backing bytes. Hidden oversized backing buffers are rejected;
shared buffers count once. Tracks retains at most 16,384 visible counter points
across virtual rows and uses explicit min/max envelopes for dense ranges.
Markers still read original observations. These bounds do not bound the input
JSON, other stack models or the exported artifact.

Generic gzip/zlib decoding now caps cumulative expansion at **512 MiB**, using
bounded input/output chunks in native and fallback codecs. Owned 16 KiB slabs
avoid retaining large codec buffers behind tiny output views. Concatenated
members share one budget; cancellation/limit failures cannot retry through an
unlimited path. Supported streaming duration/text paths retain their own guards.

Generic fallback still materializes the expanded output and often parses a full
JSON document. Slabs and final contiguous output can coexist during assembly,
temporarily requiring roughly twice the expanded bytes, plus compressed input,
codec state, parsed objects and final models. Uncompressed raw input is not
covered by the decompression cap. This remains bounded decompression rather
than an out-of-core viewer or total-process memory guarantee; see
[the generic policy](IMPORT_FORMATS.md#generic-gzipzlib-decompression).

Established focused checks cover native counter-only object/chunked roundtrips,
zero-copy worker hydration, transfer-list deduplication, malformed observations,
sample/label/backing-byte caps and export cancellation/progress. Generic codec
regressions cover native/fallback gzip/zlib byte parity, concatenated-member
budgets and cancellation without turning a limit error into raw-data success.
The authored counter fixture and separately checked public #235 capture are
documented in [counter provenance](../sample/profiles/trace-event/COUNTERS.md).
The private PLC browser check loaded four stack profiles and four counter series
(two COM-load and two cycle-time series) on the same `trace-event:wall`
microsecond clock; Show counters exposed those rows. An authored counter-only
native recording with byte and signed-count series opened directly in Tracks
with stack tabs disabled, read original values at the marker, and exported zero
profiles/two counters with values and units intact. These are browser smoke
checks, not a claim that every large counter recording fits in memory.
Earlier exact export-hash comparisons below predate the new explicit clock and
counter fields; current full native exports preserve that additional data.

A single local before/after reproduction with 10,000 one-byte gzip members
(about 210 KB compressed input and 10 KB expanded output) measured peak
`ArrayBuffers` at **161.80 MiB → 15.57 MiB** after owned-slab retention replaced
codec-view retention. This peak includes transient allocations and garbage
collection timing; it is not retained-memory accounting or a process-wide bound.

A final local Node 22 run passed 105 suites, 716 tests and 310 snapshots.
Type checking, schema checks, five Node tests, prepack/Pages/single-file builds
and npm dry-pack checks also passed; the package includes the counter guide.
Regressions include empty-member cancellation, FileReader cleanup and
fractional shared-timestamp boundaries.
Counter steps use the primary foreground with a 1.5-pixel stroke for legibility;
their observed values and step durations are unchanged.

## Long-timeline GPU precision (2026-11-21)

The renderer previously uploaded absolute time coordinates as float32. Near
6,000 seconds in a microsecond recording, endpoints 100 microseconds apart could
round to the same GPU value, making a call disappear at high zoom. A synthetic
[late-call recording](../sample/profiles/speedscope/long-late-calls.speedscope.json)
reproduces that failure, including early and late rectangles in one wide batch.

Rectangles are now clipped against the current atlas/source tile using CPU
doubles, then normalized before upload. The shader transforms unit coordinates
to the destination. Profile times, range-tree bounds, atlas keys, hit testing,
frame colors and measured durations retain their existing identities and values.
Each batch keeps one buffer and one full source-rectangle cache key; a shared
staging allocation is capped at 1,200,000 bytes for 10,000 rectangles. Switching
an uncached tile can require another bounded CPU normalization/upload; cached
tiles and unchanged source rectangles reuse their data. Final profile and GPU
buffer storage still scale with the recording.

Five regressions check real uploaded float32 coordinates and the renderer's
uniform transform, adjacent late calls, negative/spanning clipping, source
origin/extent changes, shared staging ownership, buffer lifecycle and limits.
Browser QA showed both 100-microsecond calls near 6,000 seconds, including after
overview reset/refocus. The private PLC imported four profiles and rendered
Time Order, Left Heavy and Sandwich's inverted callers/callees correctly during
pan/zoom checks, with no browser errors.

A warmed Node smoke using a preallocated-copy mock upload and source rectangles
covering almost all 10,000 rectangles measured about 0.19 ms per repack and
2.6 ms for 100,000 unchanged-source requests, with one buffer allocation. These are local CPU
measurements, not browser/GPU frame-rate claims. This addresses the demonstrated
float32 failure associated with [#467](https://github.com/jlfwong/speedscope/issues/467);
the original upstream capture remains unavailable for direct comparison. These
buffer/matrix tests also extend [#125](https://github.com/jlfwong/speedscope/issues/125),
but do not replace a browser/GPU pixel-regression harness.

Final local verification passed all 418 Jest tests in 72 suites with 307
snapshots on checksum-verified Node 22.23.5 ARM64 using a clean Jest cache.
The five Node tests, type checking, lint, schema and backlog checks passed
separately on the system Node runtime. Two full Jest runs on local Node 24.19.0
ARM64 exited with native access violations without an assertion failure, so a
green local Node 24 full-suite result is not claimed. GitHub's Windows/Linux
Node 22/24 matrix validates the branch independently before merge.

## Fixed-height Sandwich list geometry (2026-11-21)

Sandwich already rendered a viewport window. It now calculates that window and
initial scroll offset directly from row count/height, removing the size object
per frame and full-list geometry scans. A single cached selected-frame/index
replaces the frame-index Map: repeated, adjacent and wrap-around navigation are
constant time; unrelated new selections scan the existing sorted array once.
Missing results are cached. Element resizing updates the viewport and filtering
clamps stale scroll offsets, even without a browser-generated scroll event.

Tests cover 100,000-row selection/navigation, billion-row arithmetic without a
row allocation, visible-row bounds, filter shrink, resize and cleanup. The
billion-row case tests arithmetic only: browser scroll-height limits still apply.
The sorted row array, model, sorting and graph/color geometry remain proportional
to the recording. These changes reduce auxiliary storage and repeated work;
they do not establish a fully bounded-memory viewer.

Combined validation passed 410 Jest tests in 71 suites (307 snapshots), five
Node tests, type checking, lint, schema/backlog checks and both builds. The
private PLC gzip still exported four profiles, 17,510 frames and 1,039,656 call
events with the established SHA-256
`522de77afbfc4dd94f1f30c3a9551979d12db506305ffef999db9c910ae8eddb`.
The local Node streaming smoke took about 4.3 seconds to import; this is not a
browser performance guarantee or a claim of faster importing in this batch.
In browser QA the first PLC profile's 16,231-frame table rendered 40 rows at the
scroll end, clamped to zero when filtered to one row, and updated to 49 rendered
rows after a viewport resize. A generated local function link restored its
selection after reopening the same PLC recording in another tab.

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
transformations other than frame filtering remain synchronous. Frame filtering
visits grouped paths and yields during traversal, with cancellation; final tree
sorting remains synchronous. See [filter behavior and limits](PROFILE_FILTERS.md).
Export retains the final
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
duration/counter events, naming metadata and first event needed by the existing Hermes
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

## Faster streaming event parsing

CPU profiling of the first streaming implementation showed substantial time in
token parsing, per-property assignment, selector matching and callbacks. The
worker now scans structural bytes to frame each complete event object, then
decodes and parses that one object with native `JSON.parse`. The token parser
still validates the wrapper/array grammar and handles other values. The bounded
event framing scan tracks string escapes and nesting; it does not interpret
fields or split on text delimiters. A rare permissive retry retains the existing
trailing-comma behavior.

No whole-document string or inflated buffer is introduced. Events spanning read
boundaries use a temporary buffer for that one event. The existing decompressed,
pending, retained, event-count and depth limits remain in force, including while
framing native records. Truncated later records cannot be silently dropped when
repairing a producer's omitted final array bracket. Additional regressions cover
all small chunk sizes, large records, split UTF-8/escapes, malformed inner and
outer grammar, and the existing fallback/cancellation/limit cases.

Three alternating fresh-process runs of the same PLC capture on Windows/Node 24
compared the previous streaming bundle (`39b264b`) with native event framing:

| Metric | Previous streaming | Native event framing |
| --- | ---: | ---: |
| Import times | 4,255 / 4,336 / 4,423 ms | 2,493 / 2,563 / 2,445 ms |
| Median import time | 4,336 ms | 2,493 ms |
| Peak RSS | 612 / 613 / 615 MiB | 579 / 573 / 581 MiB |
| Median peak RSS | 613 MiB | 579 MiB |

That is about 43% faster while retaining (and slightly improving) the previous
memory reduction. These are import-only process measurements, not browser
rendering or hydration measurements. Each revision's `benchmark-profile.ts` was
bundled separately with esbuild (Node/CommonJS, ES2020, binary WASM) and run with
the capture path and `stream-import` action, alternating revisions without
explicit garbage collection. Captures and timing logs are not committed.
The full exported profiles match the ordinary importer, including all four
profiles, 17,510 frames, 1,039,656 call events and profile totals.

The same follow-up fixes issue #199's deep-zoom axis labels: formatting receives
the visible tick interval, tick generation clamps below floating-point precision,
and overlapping labels are skipped. V8 source-path extraction and exact-first
sourcemap matching (with empty maps ignored) improve #446, which remains partial
because automatic linked map discovery/loading is still separate work. The
maintained backlog records these completion boundaries explicitly.

## Smaller duration queues and bounded selected-stack details

The 2026-11-20 follow-up reuses complete (`X`) events as begin records rather
than spreading every event into another full object. Synthesized end records
retain only their timestamp, name and shared arguments. Source positions and
argument-based frame identity remain unchanged. Queues already ordered by time
skip stable-sort workspace; unordered queues still use the existing stable sort,
including equal-timestamp and epoch-rounding behavior. No additional event index
is retained. The streaming limits are unchanged.

Three alternating fresh-process runs on Windows/Node 24 compared `f6c5d43`
against this change, using the same ES2020 CommonJS benchmark bundle options:

| Capture / metric | Before | After |
| --- | ---: | ---: |
| PLC import times (ms) | 2,609 / 2,524 / 2,579 | 2,562 / 2,546 / 2,562 |
| PLC median peak RSS (MiB) | 576 | 576 |
| Complete-event fixture import times (ms) | 1,131 / 833 / 822 | 986 / 767 / 779 |
| Complete-event fixture median peak RSS (MiB) | 362 | 295 |
| Complete-event fixture median heap at import (MiB) | 224 | 155 |

The synthetic fixture contains 250,000 sequential complete events with 5,000
distinct argument-based frame keys. Its median peak RSS fell about 19%; PLC
performance remained essentially unchanged. These are process import measurements,
not browser hydration/rendering or hard heap bounds. Separate full-export checks
matched the baseline hash for both captures. PLC still exports four profiles,
17,510 frames and 1,039,656 call events. Captures and benchmark artifacts are not
committed. Reproduce import measurements with `node scripts/benchmark-profile.mjs
<capture> stream-import`; do not include export validation in import-only RSS.

Selected-stack details now retain/render at most 100 ancestor rows and follow
parent pointers only as pages are requested, without building the full ancestor
list. All scopes remain reachable through older-page and reset controls. Clicking
one selects the exact ancestor instance; see [stack navigation](SEARCH_AND_LAYOUT.md#navigate-selected-stack-ancestors).
Tests include a 100,000-level chain with a guarded page boundary. The PLC's
deepest seven-scope stack was paged without changing the export hash.

Issues #519, #478, #386, #347 and #404 remain partial: the final profile model,
worker snapshots, unordered sorts and graph rendering still grow with capture
size. This work reduces specific temporary allocations and bounds the details
panel, without claiming an out-of-core viewer or fixing every reported OOM.

Validation passed 339 Jest tests across 58 suites (307 snapshots), five Node
tests, type checking, linting, schema/backlog checks, both builds and a dry-run
npm contents check. Browser smoke checks used a 220-level profile to verify
100-row pages, access to the root, reset controls, Enter/Space selection and
visible ancestor highlighting below the time axis, without console errors.

## Bounded graph-search state

On 2026-11-21, graph search stopped eagerly caching every source symbol and
allocating navigation geometry/index entries for every matching call. Per query,
boolean frame results are capped at 4,096 entries and drawn-label ranges at
512 entries with at most 64 ranges each. Time Order/Left Heavy navigation keeps
the first 10,000 matches and checks for one further match to establish
truncation. The search UI displays a `+` lower bound and a visible refinement
notice; it never claims the truncated count is complete. Matching/highlighting
can continue beyond that navigation window.

Three alternating fresh-process Windows/Node 24 runs compared `a72d309` with
bounded search on the PLC's first profile (513,009 graph frames), using a broad
single-space query:

| Search-only metric | Before | After |
| --- | ---: | ---: |
| Initialization times (ms) | 96 / 89 / 94 | 3 / 3 / 4 |
| Retained search heap after explicit GC (MiB) | 119.60 / 119.60 / 119.60 | 0.907 / 0.907 / 0.906 |
| Retained navigation matches | 513,009 | 10,000 (explicitly limited) |

This is a deliberate navigation-limit tradeoff, not equivalent full-result
enumeration. Separate single-run checks found the same 40 `GroupCalls` matches
(14 → 22 ms) and zero matches for a nonexistent symbol (14 → 25 ms). Those sparse
queries retain about half as much search heap, but can be slower because cached
entries are recomputed. These are Node search measurements after import and graph
construction, not whole-app memory caps or browser latency guarantees.
The measured initialization counts results and opens the first ten; it does not
draw labels or measure browser rendering.

The PLC import/export check still reports four profiles, 17,510 source frames
and 1,039,656 call events, with the unchanged baseline export hash. Captures and
benchmark artifacts remain private/uncommitted. The maintained benchmark adds
`node scripts/benchmark-profile.mjs <capture> stream-search [query]` for streaming
import followed by bounded search of the first profile; its default query is a
single space. It reports the navigation limit and retained search heap separately
from input/model memory. Graph creation, worker snapshots, sorting, Sandwich
row lists and the final model remain proportional to recording size; the OOM
backlog stays partial.

Validation passed all 354 Jest tests across 62 suites (307 snapshots), five Node
tests, type checking, linting, schema/backlog checks, both builds and package
contents. Regressions cover cache eviction, dense-symbol range limits, exact
limit detection, late sparse matches, depth-first order and 25,000-level graphs.
Browser checks on 20,050 calls verified the visible limit notice, both keyboard
wrap directions, narrowing to a late result, and the root-label axis fix,
without console errors.
