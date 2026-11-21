# Instant-event tracks

Instant events are observations at a timestamp. Tracks displays them separately from stack intervals and numeric counters. They have **no measured duration or sample weight**. An event's name, category and details do not become frame identity, create a call stack, or affect stack/counter totals.

Choose **Tracks** to inspect compatible clocks. Instant-only recordings are valid and do not require a synthetic stack profile. Equal-time events remain separate in source order; unlike numeric counter updates, they are not deduplicated into a last value.

## Native metadata

A native file can contain group-level `instantTracks` independently of `profiles` and `counterTracks`:

```json
{
  "$schema": "https://www.speedscope.app/file-format-schema.json",
  "name": "Request markers",
  "shared": {"frames": []},
  "profiles": [],
  "instantTracks": [{
    "id": "request-marks",
    "name": "Request markers",
    "clock": "trace-event:wall",
    "timeUnit": "microseconds",
    "start": 1000,
    "scope": "thread",
    "processId": "42",
    "threadId": "7",
    "times": [0, 10, 10],
    "events": [
      {"name": "received", "category": "request"},
      {"name": "cache miss", "details": "Request id: abc"},
      {"name": "retry scheduled"}
    ]
  }]
}
```

`id` is unique within the recording; `name` labels the lane. `clock` is a recording-local clock, not evidence that separate recordings are synchronized. `start` is the finite raw source timestamp of local zero, in the explicit time unit. `times` contains finite, nonnegative, nondecreasing offsets from that origin. Supported units are nanoseconds, microseconds, milliseconds and seconds. Equal times preserve all corresponding events. Empty lanes are valid metadata but have no observed points to display.

`scope` is explicitly `thread`, `process` or `global`. Optional process/thread IDs provide context. Each timestamp has exactly one `events` entry with a required name and optional category/details text. Details are plain text, including multiline text; they are not HTML, executable data, or a promise that embedded stack-looking data describes measured execution. Unknown event-object fields are not retained by model validation.

Native object/chunked exports, worker snapshots and source-map/profile-action group changes preserve instant tracks. Internal timestamps use `Float64Array`; worker transfer deduplicates backing buffers and hydration validates ownership without copying the numeric array. Event metadata is copied and frozen when native/worker data becomes a completed model. Later validation/export reuses owned frozen metadata; timestamp arrays remain immutable by ownership convention and are still fully validated.

## Trace Event input scope

The supported point phases are `i`, historical `I`, and `R`. Scope `s: "t"` (or omitted) selects a thread lane; `s: "p"` selects a process lane, and `s: "g"` selects a global lane. Source lane identity preserves numeric versus string identifiers. Scope-irrelevant identifiers remain in details rather than artificially splitting a global/process lane into threads.

Timestamps use wall `ts` in microseconds, not `tts` or the trace's display-unit hint. Generic Trace Event points share the source-local `trace-event:wall` clock. Where points accompany supported Chrome Timeline CPU profiles, they use `chrome-timeline:wall`. Only matching explicit clocks and time units align with stack/counter rows.

Selected source fields (`pid`, `tid`, `id`, `id2`, `args`, `stack`, `sf`, `tts`) are preserved as bounded JSON **text** in details when present. An input such as `stack: ["a", "b", "c"]` remains inspectable metadata; it does not become invented duration or a weighted sampled profile. Malformed imported point timestamps/scopes/labels or unsupported details fail explicitly. Resource exclusions in mixed recordings follow the separate whole-set policy below.

Recognized historical `CpuProfile` payloads retain their existing sampled-CPU routing, even when a producer uses an instant phase. V8 `JitCodeAdded`/`JitCodeMoved` records are excluded from ordinary markers; this feature does not newly decode standalone JIT records. Asynchronous begin/end spans, flow/causal links, arbitrary metadata attached to existing call occurrences and manual annotation creation remain separate work.

Primary scope/phase evidence: [Chromium Catapult's pinned instant importer](https://github.com/catapult-project/catapult/blob/6fd8bbe723677254ff1130a1a416988b8b3e285e/tracing/tracing/extras/importer/trace_event_importer.html#L657), including its historical CPU/JIT distinctions. The fork renders explicit points rather than manufacturing a positive-duration slice.

## Overview and inspection

Instant lanes use bounded glyphs at source observation times. Dense ranges group
points into time buckets, retaining at most 4,096 representative glyphs across
visible instant lanes. Counts make omitted/coincident events explicit; they are
not counts of measured calls or an invented duration. The display does not
connect points into a continuous activity interval.

Use **Inspect events** on a lane to read the original events in the selected
viewport. The list is paged at 100 events, retains equal-time entries in order,
and expands details for one event at a time. Details are selectable plain text.
Inspection reads original arrays rather than treating overview representatives
as the complete data. Shared clock and navigation behavior is described in
[MULTI_TRACK.md](MULTI_TRACK.md).
Clock choices are paged 64 at a time; changing clock pages selects that page's
first group. Replacing the source clears stale event details and clock paging.

The inspector shows source origin and local offset separately. A computed source
timestamp is explicitly labeled as potentially rounded, and is omitted if its
sum is nonfinite. Overview readouts distinguish exact source-time coincidences
from different offsets that collide at shared floating-point display precision.

## Resource exclusions in mixed recordings

Trace recordings that already contain stack profiles or counters keep that data
when instant events exceed a supported resource budget. The importer excludes
the **entire** instant-event set and attaches a persistent notice with the count
of recognized instant events and the reason. It never returns a partial marker
array or represents the retained subset as complete.

Mixed-recording preflight can count more than 250,000 recognized instant events
and exclude them before building their metadata. **Excluded marker records are
not fully validated.** The same whole-set policy applies when track, metadata or
details budgets are exceeded. Stack/counter validation is unchanged; malformed
marker data being imported still fails. A pure instant-only recording over a
resource limit fails rather than becoming an empty successful import.

The streaming duration reader normalizes instant metadata as each record arrives
instead of retaining a second raw marker/argument array. On the first marker
failure it releases collected lane data and continues counting recognized
points. Errors are resolved after the stack/counter group is known, preserving
the same mixed/pure policy and late CPU-format fallback. Only the first bounded
source event is also retained for the existing Hermes discriminator. Existing
input-byte, per-record pending-byte, event-count, JSON-depth and cancellation
guards still apply. Stack/counter raw records retain their existing sorting
budget; normalized marker state uses the separate point/metadata budgets below.
Generic full-array import keeps its count-first shortcut for oversized mixed
marker sets, but still materializes that original input array.

The notice survives native export and worker transport as optional group-level
metadata, for example:

```json
"instantEventOmission": {"count": 309230, "reason": "point-limit"}
```

The reason is one of `point-limit`, `track-limit`, `metadata-limit` or
`details-limit`; the count must be a positive safe integer. No retained instant
tracks accompany an omission summary. The summary preserves the fidelity
warning when a mixed recording is exported; it cannot reconstruct omitted data.
Native model data and worker payloads are validated strictly, including summary
counts/reasons and contradictory retained-track/omission fields.
Native `instantTracks` are never automatically omitted: malformed or over-limit
model data fails validation even when the native file also contains stacks.

## Resource and export policy

- At most 256 lanes and 250,000 points in total.
- At most 512 characters per label, 16,384 details characters per point, and 4,194,304 metadata characters in total. The total includes lane IDs/names/clocks/context plus event names/categories/details; shared labels count per observation. Labels are nonempty, trimmed and contain no control characters. Details can contain ordinary multiline text.
- At most 2,000,000 bytes of unique retained timestamp backing buffers. Aliases count once; a tiny view into an oversized buffer is rejected.
- Trace Event details are checked before serialization, with nesting depth at most eight and at most 4,096 visited values. Custom serializers, getters, cycles and nonfinite numeric details are unsupported.

Caps apply together. Metadata character counts use JavaScript UTF-16 string lengths. Timestamp/model arrays, parsed input, metadata objects and the exported artifact still occupy memory; these are resource limits, not a whole-process or out-of-core guarantee. Generic gzip/zlib fallback retains its [separate expansion limit](IMPORT_FORMATS.md#generic-gzipzlib-decompression).

Worker hydration and chunked Blob export yield periodically, support cancellation and report instant-specific export progress. Blob export writes timestamp and event entries in pieces, preserving owned metadata without constructing a full JavaScript number array. The synchronous object-export API deliberately materializes JSON-compatible arrays.
