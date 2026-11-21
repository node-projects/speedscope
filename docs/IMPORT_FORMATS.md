# Import formats and background processing

The [README](../README.md#supported-file-formats) lists supported sources.
This guide describes additional fork-specific behavior and its limits.

## Classic Android method traces

Open the classic concatenated key/data format emitted by Android method tracing:
a text key section followed by a little-endian `SLOW` binary section. Versions
1, 2 and 3 are supported, including version-3 record padding. The file can be
named `.trace` or renamed; detection uses the format signature.

The importer preserves method signatures, thread identities and available Java
source locations. Clock metadata is required. `thread-cpu` and `wall` clocks
remain distinct; version-3 `dual` input creates separate labeled CPU and wall
profiles for each thread. Version-1 `global` means wall time. All values use
microseconds. CPU clocks are local to their thread; wall offsets remain relative
to the trace origin, so leading unobserved time can appear as idle weight.
The absolute date in the binary header is not added to those offsets.

Initial method exits reconstruct calls already active at trace start. Calls
still open at EOF close at that thread's last observed event. These are clipped
observation windows and do not invent work before or after the recording.

Fixed records are scanned without retaining a second parsed-record array.
Temporary state includes key dictionaries and per-thread stacks, alongside the
output builders. Key text is decoded line by line with a 16 MiB section limit
and 1 MiB line limit. The input buffer and final profiles still occupy memory.

Raw binary-only/streaming traces, newer ART packet formats, Perfetto protobuf,
Android systrace HTML and wrapped timestamp recovery are unsupported. Unknown
clocks, partial records, invalid method actions and decreasing per-thread clocks
produce explicit errors. See the
[synthetic fixture, generation script and AOSP references](../sample/profiles/android-method-trace/README.md)
for the exact supported layouts and clock policy.

## Java thread-dump archives

Traditional HotSpot `jstack` / `Thread.print` text can be opened directly or as
an archive of captures from one JVM. Observed stacks contribute raw samples;
they do not measure elapsed time. The ZIP importer checks declared sizes and
actual expansion, feeds bounded UTF-8 lines into the parser and supports
cancellation without returning partial results.

See [text snapshot semantics](JAVA_THREAD_DUMPS.md) and the
[ZIP format and resource policy](JAVA_THREAD_DUMP_ZIP.md). Archive support is
limited to classic ZIP32 STORE/DEFLATE; it is not a generic archive extractor.

## pprof metric and source identity

pprof's `default_sample_type` selects a sample metric by its string-table
identity. Protobuf integer objects are compared by value. If the preferred
metric is absent or cannot be found, the existing last-metric fallback applies.
For example, a recording can prefer allocation counts even when a later sample
column measures bytes; the displayed unit follows the chosen metric.

Function IDs and location IDs retain their complete unsigned 64-bit identity.
They are not truncated to their low 32 bits or rounded through a JavaScript
number, so IDs that share a low word remain distinct. String-table positions
must fit safe nonnegative integers. Source lines must fit safe positive integers.

Each location retains its own source line, falling back to the function's
definition line when needed. One location no longer overwrites the shared
function metadata used by another location. The current importer retains the
outermost entry of an inline-location chain; expanding all inlined functions
is outside this change.

This does not add signed/differential flamegraphs, exact arithmetic for weights
larger than JavaScript's safe-integer range, or a metric chooser. Negative Go
heap delta weights remain a separate unsupported case. See the
[pprof schema used by the importer](../src/import/profile.proto).

## Background import for large recordings

### Streaming perf and folded stacks

UTF-8 folded stacks and `perf script` text now stream plain or gzip input into
the same incremental parsers used by ordinary imports. Supported suffixes are
`.folded`, `.collapsed`, `.stacks`, `.collapsedstack.txt`, `.perf`, `.perf.txt`
and `.linux-perf.txt`, optionally followed by `.gz`. Ordinary `.txt` files can
be detected as either format. Other names retain generic format detection.

The reader does not retain the complete expanded byte buffer, decoded text or
an array of all lines. It retains one bounded line and, for perf, one bounded
event. Input limits are 1 GiB expanded bytes, 1 Mi UTF-16 code units per line,
4 Mi code units per perf event, 65,536 stack frames and two million samples.
A limit failure stops import; it does not retry through an unbounded reader.
Malformed weights and existing perf ordering checks remain enforced.

This path also runs for small compressed inputs and when workers are unavailable.
It yields during parsing, exposes progress and supports cancellation. Gzip needs
native `DecompressionStream`; unavailable native decompression, UTF-16 input and
other recognized formats retain the generic fallback. Final trees, sample lists,
symbol processing and worker snapshots still scale with the recording.

### Worker routing and fallback

Inputs of at least **1 MiB** use a Web Worker when available, regardless of
filename extension. This includes perf, folded stacks, pprof, JFR, Android
method traces, supported ZIP archives and renamed captures. Format detection,
generic parsing, demangling and profile snapshot preparation happen away from
the main UI thread. Cancelling the task terminates its worker.

Recognized gzip perf/folded/text suffixes prefer a worker at any compressed
size: a tiny compressed file can expand into a large recording. Small plain
text stays on the main thread. The bounded text reader yields for cancellation
when a worker is blocked or unavailable; native gzip streaming requires
`DecompressionStream`. Unsupported encodings and unavailable streaming APIs use
the existing generic fallback, which can materialize the full input.

The worker first attempts the duration-trace and supported text streaming paths,
then uses the generic importer when those formats do not apply. Generic fallback
formats still read/materialize their input and retain their final model; routing them
through a worker does not make them streaming or out-of-core. Snapshot transfer,
geometry and final view construction still have memory costs proportional to
the recording. [Large-trace guidance](LARGE_TRACE_PERFORMANCE.md) describes the
duration-trace limits and measurements separately.

If workers are unavailable or blocked by a host's CSP, the app falls back to
the main-thread importer. DOM-dependent formats can also fall back after worker
detection. A transferred input buffer is returned before this fallback, so the
main thread does not attempt to parse an empty detached buffer. Synchronous
generic fallback parsing can block the UI until it returns; the streaming text
and asynchronous ZIP importers yield and check cancellation on the main thread.

Oversized supported ZIP files receive a four-byte signature preflight before
their complete body is read, both in the main importer and worker path. Other
formats retain their existing input/resource policies; the ZIP compressed-size
limit is not a blanket cap on every supported recording.

### Text-stream measurements

Three fresh Node 24.19.0 ARM64 processes per mode imported a synthetic file
containing one million copies of `root;worker;leaf 1`: 19,000,000 plain bytes
or 46,140 gzip bytes. All modes produced one profile with total weight 1,000,000.
The final model is deliberately tiny, which isolates temporary input costs;
these figures do not predict memory for a million distinct stacks.

| Mode | Plain median time / peak RSS | Gzip median time / peak RSS |
| --- | ---: | ---: |
| Generic materializing importer | 466 ms / 110 MiB | 853 ms / 300 MiB |
| Streaming with worker-style scheduling | 573 ms / 86 MiB | 629 ms / 66 MiB |
| Streaming with main-thread cooperative yields | 993 ms / 85 MiB | 1,092 ms / 66 MiB |

Peak RSS columns are medians of each fresh process's peak, not retained model
heap. Worker-style measurements skip unnecessary timer yields, as the worker
can be terminated externally. They time the parsing function over a Node file
stream, excluding actual worker startup, demangling, snapshot transfer and view
construction. The cooperative path permits UI cancellation when no worker is
available; Windows timer overhead makes it slower in this test. Plain-text
streaming trades some throughput for lower memory even without those yields.

Reproduce with `node scripts/benchmark-profile.mjs <path> import`,
`text-stream-import` (worker-style scheduling), or `text-stream-main-import`
(cooperative scheduling). Do not compare these folded-stack figures with PLC
duration-trace timings as if they used the same input or parser.
