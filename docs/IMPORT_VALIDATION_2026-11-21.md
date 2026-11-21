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
