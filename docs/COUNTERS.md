# Counter tracks

**Tracks** displays numeric observations alongside compatible stack timelines. Counter rows have an independent value axis and unit. They are not stack frames, call weights, elapsed durations, or values to sum across rows. Negative and fractional gauge values are supported.

Counter-only recordings open directly in Tracks. **Show counters** and **Show profiles** jump to the relevant virtual rows. Shared zoom, pan, clock selection and marker controls are described in [MULTI_TRACK.md](MULTI_TRACK.md). Stack views are unavailable when a recording contains no stack profiles; export remains available.

## Native format

Native files can contain a group-level `counterTracks` array independently of `profiles`:

```json
{
  "$schema": "https://www.speedscope.app/file-format-schema.json",
  "name": "Example counters",
  "shared": {"frames": []},
  "profiles": [],
  "counterTracks": [{
    "id": "heap-used",
    "name": "Heap used",
    "clock": "trace-event:wall",
    "timeUnit": "microseconds",
    "start": 1234567890000,
    "valueUnit": "bytes",
    "processId": "42",
    "threadId": "7",
    "category": "memory",
    "times": [0, 10, 20],
    "values": [1048576, 2097152, 1572864]
  }]
}
```

`id` uniquely identifies a series within the recording. `name` is a display label. Optional process/thread IDs and category are context, independent of stack-frame identity. `clock` is a recording-local clock name, not a promise that unrelated recordings are synchronized.

`start` is the finite raw source timestamp of counter-local zero. `times` contains finite, nonnegative offsets from that origin in `timeUnit`: `nanoseconds`, `microseconds`, `milliseconds`, or `seconds`. Times must be nondecreasing. `values` has exactly the same length and contains finite numbers, including signed gauges. Empty series are valid metadata but have no observed domain to display. Stable duplicate timestamps are permitted; the last observation at a timestamp determines its step value.

`valueUnit` is a separate, explicit label such as `bytes`, `count`, `percent`, or `unknown`. It is not inferred from the series name or `timeUnit`. The native example explicitly supplies bytes; a Chrome Trace Event counter with a similar name does not thereby acquire that unit.

Tracks groups counters and stack profiles only when their clock names and time units agree. It subtracts a common raw origin before drawing relative coordinates. Mixed-unit clock conversion and synchronization of unrelated captures are outside the current scope.

Native object export, chunked Blob export, worker snapshots, source-map changes and existing profile actions preserve group counter tracks. Counter-only groups retain `profiles: []`; they do not gain a synthetic stack profile. Internal numeric storage uses `Float64Array` for each series's times and values. Worker transport transfers those buffers with deduplication and validates the receiving data without making a second numeric copy. Completed group arrays are immutable by convention.

## Chrome Trace Event `C` input

The importer supports finite numeric observations in `ph: "C"` events in generic Trace Event JSON, the corresponding streaming duration importer, and Chrome Timeline inputs containing CPU profiles. Each numeric `args` key becomes its own series. Category, name, optional ID, process/thread IDs and argument key determine identity; numeric and string identifier types remain distinct. A short generated output ID does not merge otherwise distinct source series.

Timestamps come from source wall `ts` in microseconds, never `tts`. Generic Trace Event counters use the recording-local `trace-event:wall` clock; counters routed with Chrome Timeline CPU profiles use `chrome-timeline:wall`. Each series is sorted stably by timestamp. Repeated timestamps keep the last source observation for that series. A missing argument key supplies no observation: it is not filled with zero. Series are not stacked or summed.

Legacy `C` events do not supply a reliable general unit contract, so their `valueUnit` is **unknown**. The importer does not guess bytes from names such as Heap or Memory. Unsupported `id2` identities, malformed timestamps/labels/IDs, empty argument objects, or nonnumeric/nonfinite argument values fail explicitly. Numeric strings, booleans, nested objects and null values are not converted into measurements. This support does not include arbitrary Perfetto protobuf counters, ftrace schemas, counter-unit inference or causal event links.

The [authored fixture and pinned Chromium format evidence](../sample/profiles/trace-event/COUNTERS.md) document source provenance and a separate public real-input check.

## Markers and dense ranges

Each row displays its own observed minimum/maximum value axis. At a shared marker, the readout binary-searches the original observations and reports the raw value, its value unit and observation time. The step value is defined between the first and last observations, including the last observed point. There is no extrapolation before the first observation or beyond the last.

Dense views retain first/minimum/maximum/last actual observations in at most 1,024 time buckets per counter row, subject to a total 16,384-point budget across visible counter rows. Min/max envelopes are labeled overview summaries, not reconstructed sample paths or durations. Retained step segments use original adjacent observation intervals; omitted points are not reconnected into longer spikes. Markers continue to use the original observations rather than the decimated drawing. Zoom in for more complete steps.

## Resource limits

- At most 256 series, 2,000,000 observations in total, and 1,000,000 observations per series.
- At most 512 characters per label/ID, 128 per clock name, 64 per value-unit label, and 65,536 label characters in total. Labels must be nonempty and trimmed without control characters; absent optional context should be omitted.
- At most **32,000,000 bytes** of unique retained numeric backing buffers across counter tracks, approximately 30.5 MiB. Shared buffers count once. A tiny view into an oversized backing buffer is rejected rather than retaining that hidden allocation.

All limits apply together and fail explicitly. Trace Event import counts raw observations toward its caps before timestamp deduplication. Native JSON is parsed in memory before its numeric arrays are converted; the counter limits are not a streaming JSON or out-of-core guarantee. Counter input storage, parsed trace data, existing stack models and the exported artifact can coexist during processing. See [large-trace performance](LARGE_TRACE_PERFORMANCE.md) for broader limitations.

Generic compressed wrappers have a separate [512 MiB expanded-byte cap](IMPORT_FORMATS.md#generic-gzipzlib-decompression). They still materialize decoded input and JSON; final byte assembly can temporarily need roughly twice the expanded bytes, in addition to the counter buffers and other models. Supported streaming codecs retain their own independent guards.

Worker hydration and chunked export validate bounded data cooperatively, support cancellation and preserve buffer ownership. Chunked export writes numeric arrays in pieces, rather than materializing full JavaScript number arrays, and reports counter-specific progress. The synchronous object-export API deliberately materializes its JSON-compatible arrays.
