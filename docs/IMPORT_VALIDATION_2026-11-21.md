# Import-format validation, 2026-11-21

This batch adds classic Android method traces, bounded Java thread-dump ZIP
archives, broader large-file worker routing, and pprof metadata corrections.
See [format coverage and limitations](IMPORT_FORMATS.md) and
[ZIP limits](JAVA_THREAD_DUMP_ZIP.md). It does not make generic formats streaming
or the final profile model bounded in size.

## PLC regression

The private PLC gzip recording imported in 3,004 ms in one Node run on this
Windows ARM64 machine. This is a regression observation, not a controlled speedup
comparison or a browser timing guarantee. The export retained four profiles,
17,510 frames and 1,039,656 call events. Its baseline hash remains
`522de77afbfc4dd94f1f30c3a9551979d12db506305ffef999db9c910ae8eddb`.
The capture and benchmark artifacts remain uncommitted.

Browser checks used the built single-HTML app served over loopback HTTP with
external connections blocked by CSP. The PLC imported successfully, exposed
four profiles and rendered its call tree without console errors. The synthetic
Android dual-clock capture exposed non-idle CPU/wall totals of 20/40 microseconds for
the main thread and 7/20 microseconds for its worker. The two-snapshot Java ZIP
produced two raw samples and correctly disabled chronological Time Order.
These checks do not validate file:// loading or a real Android device capture.

## Automated verification

The final clean-cache Jest run passed 458 tests across 75 suites with 307 snapshots
using the official local Node 22.23.5 ARM64 runtime. System Node 24.19.0 ARM64
passed all five CLI/release-helper Node tests. Previous native crashes of full
Jest on this system's Node 24 ARM64 remain a local runtime limitation; no tests
were weakened to hide them. The CI matrix covers Node 22 and 24 on Windows and
Linux x64.

## Streaming and chooser follow-up

The next batch adds real plain/native-gzip perf/folded streaming, a click-open
thread chooser with bounded list rendering, same-tab function-link navigation,
and explicit linked-source-map preview/apply. The full clean-cache Node 22 ARM64
run passed **506 tests across 80 suites, with 307 snapshots**. All five Node
tests, type checking, lint, schema/backlog checks and the three builds passed.
See [text-stream measurements](IMPORT_FORMATS.md#text-stream-measurements) for
the memory improvement and throughput tradeoffs, including cooperative timer costs.

The private PLC recheck imported in 2,444 ms in one Node run and retained the
same four profiles, 17,510 exported frames, 1,039,656 events and baseline hash.
This is a regression observation rather than a controlled speed comparison.

Browser checks verified click-open/pointer thread selection, filtering, paging
205 profiles with at most 100 options rendered, End/Enter navigation and Escape
focus restoration. A sub-1-MiB gzip expanded to one million folded samples;
cancelling another such import preserved a different previously loaded recording.
Compressed-text worker preference is also covered by actual processor/snapshot
regressions; the cooperative browser cancellation check covers the fallback path.
The linked-map fixture changed a minified frame into `originalTask` at its
original source position without changing its 5 ms weight. Same-tab links and
Back restored two different function selections without reimport. The PLC also
loaded and its thread chooser stayed usable; no console errors were observed.

## Perf periods, OTLP and source-line indexing

The next batch corrects perf period attribution, adds current-schema OTLP
Profiles JSON and bounds embedded-source line indexes. The final clean-cache
Node 22.23.5 ARM64 run passed **563 tests across 81 suites, with 310 snapshots**.
All five Node tests, type checking, lint, schema/backlog checks, Pages/standalone/
single-HTML builds and npm dry-pack passed. Two new public format guides are
included in the package. The earlier Node 24 ARM64 Jest limitation remains;
this is not a claim that a full local Node 24 Jest run passed.

The public perf #393 reproduction now reports `265306119` ns for its 13-sample
DiscoveryClient thread; its timestamp span is not treated as CPU execution.
The complete public capture imports 44 profiles with `3469387710` ns total.
Generic and streaming exports match hash
`65120439b745f5a6d16f45fc1974d0c8301423c3e9356d404de8900774208857`.
Sixteen existing perf snapshots intentionally changed for corrected units,
weights, chronology and explicit missing-period labels. The new checked-in
regression has synthetic stacks and cites the original timestamp/period facts.

Browser checks imported the authored OTLP fixture as an aggregate 14 ns profile,
with an exact large thread ID, source positions and full inline chain. The perf
regression displayed 265.31 ms with Time Order disabled. Both worked without
console errors in the self-contained HTTP preview. These do not establish binary
OTLP, historical development layouts, scheduler idle intervals or file:// support.

The private PLC run took 2,534 ms and retained four profiles, 17,510 exported
frames, 1,039,656 events and the unchanged baseline export hash. This remains a
single-run regression observation, not a controlled before/after timing claim.
See [source-line indexing measurements](SOURCE_AND_LABELS.md#embedded-source-line-lookup)
for the separate deterministic local-source benchmark and its limits.

Type checking, linting, schema/backlog checks and Pages/standalone/single-HTML builds
passed. npm dry-pack includes the new format and ZIP resource-policy guides.
Targeted regressions cover ZIP expansion ceilings, cancellation, corrupt archives,
300 snapshots, Android record/clock validation, generic worker ownership and pprof
source identities. Pprof's existing fixture totals were reviewed after separating
source positions; frame cardinality can increase, while aggregate weights remain
unchanged. Signed negative pprof weights still require separate model support.

## A/B comparison and large OTLP worker throughput

The comparison batch adds Profile actions → Compare profiles: select a baseline
and candidate from the loaded recording or explicitly open a second recording.
The separate comparison model aligns full caller paths by source identity and
computes signed total/self deltas without changing either ordinary nonnegative
profile. Absolute mode requires identical units; normalized mode compares each
profile's composition, including idle weight, in percentage points. Positive
deltas are increases and negative deltas are decreases.

The graph uses a union envelope for width and signed red/blue differences for
color; width is not elapsed time. Selection, source details and subtree zoom are
available. The comparison model caps union nodes, visited input nodes and frame
identity storage; the dialog renders at most 101 options per profile chooser,
100 table rows per page and 100 search matches. Graph tiles are viewport-bounded.
Cancellation and underlying-recording changes abort pending work and discard
stale results. Both original recordings and the comparison model remain in
memory while the dialog is open; this does not make the complete application
memory usage independent of input size.

The full clean-cache Node 22.23.5 ARM64 Jest run passed **592 tests across
86 suites, with 310 snapshots**. All five Node CLI/release-helper tests passed.
Dialog tests cover real comparison
semantics, signed values, unit mismatch/normalization, bounded choices/results,
external-candidate loading, cancellation and changed-model invalidation. Graph
and model tests cover the separate layout and numeric semantics.

Comparing the private PLC profile with itself produced **160,613 comparison
nodes in 683 ms**, including the measured garbage collection, and retained
**47.45 MiB** for the comparison in this local run. Every signed delta was zero.
The original export hash remained
`522de77afbfc4dd94f1f30c3a9551979d12db506305ffef999db9c910ae8eddb`.
This is one regression observation rather than a browser timing or universal
memory guarantee. The private capture and benchmark artifacts are uncommitted.
Browser checks rendered the comparison with 481 graph tiles and 100 table rows;
these are observed viewport counts, not claims that all PLC paths were drawn at
once.

Current-schema OTLP Profiles JSON also avoids unnecessary timer waits inside
the dedicated import worker. The explicit worker option preserves main-thread
fallback yielding even without an AbortSignal. Million-sample JSON processing,
including parsing and snapshot construction, improved from 19.51–19.75 seconds
to 1.396–1.399 seconds in two fresh processes per case (about **14×**). Weights
and units stayed unchanged. This excludes browser worker startup and transfer;
high-water RSS increased in these measurements while retained heap was
comparable. It is a timing optimization, not a new memory reduction or a
streaming OTLP parser. See [the method and limitations](OTEL_PROFILES.md#worker-import-performance-check).

The reviewed A/B comparison scope resolves #511/#445 locally. Signed Go heap
delta inputs (#370) and Brendan Gregg differential-folded input (#228) remain
planned: displaying signed differences between two valid nonnegative recordings
does not add signed-input semantics to the ordinary profile model.

Type checking, lint, schema/backlog checks, all three release builds and npm dry-pack passed. The package includes the comparison guide. A final narrow-tile regression checks that CSS padding and borders cannot enlarge tiny calls beyond their layout widths.

## Native statistics, signed contributions, regex and producer colors

The next batch implements the reviewed scopes of #477, #370, #228, #547 and
#351. The final clean-cache Node 22.23.5 ARM64 run passed **635 tests across
94 suites, with 310 snapshots**. All five Node CLI/release-helper tests, type
checking, lint, schema/backlog checks, Pages/standalone/single-HTML builds and
npm dry-pack passed. The package includes the native cProfile and signed pprof
guides plus the re2js MIT notice; the single-HTML document embeds that notice.
The earlier local Node 24 ARM64 Jest limitation remains documented.

Native cProfile uses a restricted, nonexecuting marshal decoder with explicit
allocation/input budgets. Real CPython 3.14.3 fixtures and wire encodings 0–5
cover flat self time and immediate-caller attribution, recursion, references,
malformed objects, overflow, cancellation and raw-file preflight. Both browser
projections displayed the fixture's 26 ms total, with Time Order disabled and
the two-frame projection labeled as immediate callers rather than full stacks.
Generic compressed-wrapper expansion remains outside the native decoder bound.
See [native cProfile semantics](PYTHON_CPROFILE.md).

Differential folded tests cover explicit two-column parsing, numeric-symbol
ambiguity, fractional/Unicode values, added/removed paths, tiny chunks, plain/gzip
streaming without a whole-File read, actual worker snapshots, resource limits,
cancellation and export round trips. Browser import in the comparison dialog
retained the main recording and displayed -5, -2 and +9 changes for retained,
removed and added paths respectively. Baseline/candidate totals were 10.5/13.25.

Signed pprof tests preserve both contribution magnitudes, all-negative profiles,
same-path cancellation, units, exact-integer failures and round trips. A locally
authored Go 1.24.1 HTTP heap-delta recording also imported in the browser:
16,777,600 negative and 78,112 positive bytes produced -16,699,488 net bytes
(-15.93 MiB displayed). These are contribution projections, not reconstructed
historical heap snapshots. See [pprof interpretation and limits](PPROF_IMPORT.md).

Browser checks verified producer colors in dark/light main charts and minimaps,
Left Heavy zoom, search highlights and selected outlines. Data/GPU regressions
cover exact RGB serialization and worker ownership, color-aware combination,
contrast, packed palette boundaries, COPY metadata through atlas/direct paths,
resize/disposal and unchanged vertex stride. These checks do not replace the
separate full GPU pixel-regression backlog. The custom-color palette is bounded;
its documented overflow policy retains raw RGB but uses generated display colors.

Regex tests cover nested-quantifier inputs, full million-character symbols,
UTF-16 highlight offsets, precompile expansion rejection, unsupported syntax,
zero-width budgets and UI error recovery. The PLC browser search for `^.*`
reported the existing 10,000-match navigation limit explicitly, without console
errors. Separate local regex timing/retained-heap observations and their limits
are recorded in [search documentation](SEARCH_AND_LAYOUT.md#regular-expression-search).

The final PLC import regression took 2,652 ms in one local run and retained four
profiles, 17,510 exported frames and 1,039,656 events. Export SHA-256 stayed
`522de77afbfc4dd94f1f30c3a9551979d12db506305ffef999db9c910ae8eddb`.
This is a regression observation rather than a controlled speed comparison.
Private captures, generated Go recordings and local measurement artifacts are
excluded from Git.

## Shared-clock Tracks overview

The next batch adds explicit timeline origins and a synchronized Tracks view.
A clean-cache Node 22.23.5 ARM64 run passed **668 tests across 99 suites, with
310 snapshots**. The subsequent Canvas allocation/WebGL fallback fix passed
29 focused tests across the Tracks, layout and application suites. All five
Node tests, type checking, lint, schema/backlog checks, all three builds and
npm dry-pack passed. The package includes the Tracks guide. The existing local
Node 24 ARM64 full-Jest limitation remains; CI validates supported x64 runners.

Native origins describe raw source time at profile-local zero, with an explicit
clock and time unit. They survive native object/chunked export, worker transfer
and source-map cloning; changed-unit, aggregate and derived profiles do not keep
stale origins. Older native files gain no inferred alignment. Trace Event B/E/X
imports preserve their pre-rebasing origins, and Chrome Timeline CPU profiles
are marked only when explicit source starts establish common provenance.

The PLC recheck retained four profiles, 17,510 exported frames and 1,039,656
events. The four origin timestamps in microseconds are
`3753262088.152`, `3753300106.176`, `3753262088.152`, and `3753262004.664`.
The shared-data-plus-profile export hash intentionally changes to
`53b28f954a000a144a4b88d6806a8e20a79ee58b3ef748067d132232977bd75b`.
Removing only the new timeline fields exactly restores the prior hash
`522de77afbfc4dd94f1f30c3a9551979d12db506305ffef999db9c910ae8eddb`;
all original frame, call and weight data remains unchanged. A single streaming
plus export check took 3,299 ms, not a controlled speed comparison.

The initial geometry cap exposed a review bug: keeping the first closed calls
left later parts of dense rows blank. Bounded longest-interval retention now
keeps real intervals spanning the whole recording, including all top-level
calls (40/20/40/39 across the PLC rows). It still omits detail explicitly rather
than inventing occupancy bins or claiming complete coverage. Four-row results
retain 6,099 rectangles with a 3,000-per-row allocation from the 12,000 total
budget. Main-row extraction took 261–264 ms and retained results used about
0.94 MiB after collection in local runs. These exclude import/full profile
storage and do not establish browser latency or an out-of-core memory bound.

Browser checks verified aligned offsets, shared pan/zoom and keyboard markers,
per-row call readouts, individual-profile navigation, unanchored exclusions,
readable ticks, light/dark themes and the real PLC overview including late
activity. The authored fixture shows Main, Worker and Storage at distinct
source starts; at 510 ms the marker reports application, compute and read.
No console errors were observed. Viewport/recording changes cancel stale
extraction; same-clock replacements reset the range and marker. Moving a
crosshair does not reextract or repaint its geometry in focused regressions.

Tracks currently inspects 10,000 profiles, offers 64 clock groups, mounts up to
24 rows and displays eight call depths with bounded geometry/canvas dimensions.
Those limits, broader format clock coverage, mixed-unit conversion and nested
process grouping remain explicit. Issues #556/#473/#117 are therefore recorded
as partial rather than claiming universal multitrack support. Private PLC data
and ignored before/after diagnostic bundles remain excluded from Git.

## Counter charts and generic expansion limits

The final Node 22 local suite passed 716 tests across 105 suites with 310 snapshots.
Five Node tests, typecheck, lint, schema generation, all 134 backlog classifications,
standalone/Pages/single-file builds and npm dry-pack checks passed. Focused tests
cover counter-only import/export, worker ownership and unique backing-byte limits,
raw-observation limits, last duplicate values, dense extrema, fractional marker
boundaries, cancellation, native/fallback codecs and FileReader cleanup.

Browser checks loaded the private PLC as four profiles and four counters, and the
public issue #235 capture as 113 profiles and twelve counters with bounded dense
min/max envelopes. Native counter-only byte/signed-count series opened in Tracks
and exported zero profiles/two counters with the same observations and units.
The existing click-open thread selector was rechecked on deployed Pages: selecting
Worker succeeded and restored focus to the trigger. Its fix is already in f630315.

The forced generic PLC path retained 17,510 frames and 1,039,656 call events;
the shared-frame/profile payload SHA-256 remained
`53b28f954a000a144a4b88d6806a8e20a79ee58b3ef748067d132232977bd75b`.
This hash excludes group-level counters and does not imply identical whole exports.
A 10,000 one-byte gzip-member diagnostic measured about 160 MiB versus 16 MiB
peak ArrayBuffer growth after coalescing output into owned slabs; transient codec
allocation and GC remain part of that observation. Generic decode/JSON still
materializes input, and the 512 MiB expansion limit is not a process-memory cap.
Private traces, diagnostic bundles and screenshots remain ignored.

## Bounded late-range Tracks seeking

The final local Node 22 suite passed 731 tests in 107 suites with 310 snapshots.
Five Node tests, typecheck, lint, schema/backlog validation, standalone/Pages/
single-file builds and npm dry-pack checks passed. New regressions compare
original node identity, clipped coordinates, rectangle choices and depth notices
across full and indexed iteration, including fractional clocks, zero weights,
deep stacks, cancellation, stale builders and session cache eviction/replacement.
The dense-counter UI test forces multiple yields and waits for rendered status.

Three fresh alternating PLC pairs compared archived 899b138 against the new seek
path. All four rows retained the same geometry hashes, 3,341 tiles and 11,673
omitted intervals in the tested 94%–97% viewport. Event visits fell from
1,009,743 to 30,119, with 91,260 bytes of numeric indices across the four rows.
Warm main-profile median extraction was 299.70 ms versus 24.81 ms; observed
ranges and the comparable retained heap are recorded in LARGE_TRACE_PERFORMANCE.
This is a measured navigation improvement with bounded extra indexing, not a
claim that profile models are out of core or that browser latency is guaranteed.
The shared-frame/profile payload hash above is unchanged.

Browser checks covered rapid late-range zoom/pan, original call markers, source
replacement resetting range/marker, and the authored example at 505 ms showing
application/compute/read on the expected rows without console errors.

## Scoped instant-event tracks

The final local Node 22 run passed 779 tests across 112 suites with 310 snapshots.
Five Node tests, typecheck, lint, schema/backlog checks and all build/package
checks passed. Model/worker/native tests cover bounded ownership and frozen
metadata reuse, explicit omissions, cancellation and chunked export. Importer
regressions cover historical CPU routing, accessor-free detail reads, scope and
timestamp semantics, resource-versus-malformed errors, tiny gzip/plain streams
and the exact instant-only #402 input at 829 microseconds despite its ns display
hint. Its stack array remains unresolved inspectable text.

The public #235/#236 input still imports 113 profiles and 12 counter series with
406,923 observations; its 309,230 instant events exceed the new point budget and
are all explicitly omitted. The count/reason survives export and the browser
shows the notice in stack and Tracks views. A subsequent PLC import clears the
notice, retaining four profiles/four counters and both hashes recorded above.

Browser tests also covered thread/process/global lanes, coincident source order,
65 clock groups with 64 choices per page, original source origin/offset pairs,
Escape/focus restoration and native omission-only metadata. An authored dense
recording exposes all 25,000 events through 250 pages of at most 100 rows, draws
250 representative ticks with an explicit 24,750 not-individually-drawn count,
renders script-looking details as literal text, and exports all 25,000 points
without synthetic profiles. No console errors were observed. The app preserves
data or omission notices through stack actions, remapping, state and export.

Incremental streaming collection avoids retaining raw instant arguments beyond
the current record (plus the first bounded discriminator event). Resource
failures release normalized marker state while preserving exact recognized
counts. Mixed/pure error precedence, first-event Hermes behavior, late CPU
fallback, source argument mutation and tiny raw-retention budgets are covered.
Three fresh-process input pairs matched exact chunked export hashes: normalized
100k points peak RSS 116.3→94.0 MiB; excluded 300k points 289.5→91.0 MiB; public
#235 576.1→499.7 MiB. Forced-GC liveness checks are separate from timing and show
discarded argument objects released. Measurements and limits are detailed in
LARGE_TRACE_PERFORMANCE; diagnostic captures/archives remain ignored.
