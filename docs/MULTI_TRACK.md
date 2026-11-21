# Synchronized profile tracks

Choose **Tracks** in the toolbar, press **5**, or use `#view=tracks` to view eligible threads/profiles on a shared time axis. Tracks uses the original chronological profiles. It does not construct recursion-flattened copies, combine their weights, or infer a common start from similar names or durations.

Profiles must explicitly identify a compatible source clock. Groups with different clock names or time units remain separate; select a clock group to inspect it. A recording with no eligible origins explains why synchronization is unavailable. You can continue to inspect its profiles in the existing individual views.

Use **Zoom in/out**, **Pan earlier/later**, and **Full range** for the shared viewport. Dragging pans; Ctrl/⌘ plus the mouse wheel zooms. With the timeline viewport focused, Left/Right pan, +/− zoom, Home resets, and Up/Down move the shared crosshair. Scroll vertically to inspect other rows. **Open profile** on a row opens that original profile in its individual view for deeper stacks and existing function-selection tools. Tracks does not change an individual profile's stored zoom or selection.

At the time marker, each visible row identifies its deepest displayed retained
call, or explicitly says that detail is omitted, no call is recorded, or the
marker is outside the recording. A blank interval is not a claim that the CPU
was idle. Tracks uses Canvas 2D independently of WebGL; if WebGL is unavailable,
**Open profile** uses the Call Tree. Canvas allocation failures are reported
without hiding the row's profile navigation.

Numeric counter rows share a compatible clock while retaining independent value
axes and units. **Show counters** and **Show profiles** navigate between the row
types. Counter-only captures open directly in Tracks, with export available and
stack tabs disabled. Markers read original observations; dense ranges use
bounded min/max envelopes rather than reconstructed values or longer spikes.
See [counter charts and native metadata](COUNTERS.md) for the exact model and
separate point/storage budgets.

## Explicit origin metadata

Trace Event B/E/X duration imports retain the earliest importable wall-clock
timestamp for each thread before its existing local rebasing, under
`trace-event:wall`. Plain/gzip streaming and generic imports use the same path.
Metadata and thread-CPU timestamps do not replace that origin. Chrome Timeline
CPU profiles use `chrome-timeline:wall` when the source actually supplies their
profiling start timestamp; a synthesized default of zero does not establish a
shared clock. Standalone CPU profiles remain unanchored. These are source clock
labels, not claims of UTC synchronization between independent captures.

The optional native profile metadata is:

```json
{
  "timeline": {
    "clock": "trace-event:wall",
    "start": 1234567890000
  }
}
```

`timeline.start` is the raw source timestamp corresponding to **profile-local zero**, in that profile's time unit. A native profile's events are still normalized by its existing `startValue` on import. The explicit origin already describes that normalized zero: it must not have `startValue` added or subtracted again. Exports reset `startValue` to zero and preserve the explicit origin unchanged.

Clock names are scoped to the containing recording/file group. Matching names in independently loaded recordings do not promise globally synchronized clocks. The initial Tracks implementation requires the same clock name **and the same time unit** within a group. It subtracts a common origin before display conversion, retaining the distinctions available in the source numbers rather than first converting large epoch timestamps to a lower-precision display scale.

Origins require an original chronological profile with a time unit (`nanoseconds`, `microseconds`, `milliseconds`, or `seconds`), a finite timestamp, and a nonempty trimmed clock name of at most 128 characters without control characters. Metadata is copied and immutable inside the profile model. Worker snapshots, native object/chunked exports, imports and source-map style shallow clones preserve it. Changing units, marking a profile nonchronological, or marking it derived clears the origin. Current crop/aggregate/invert/recursion-flattened transforms do not gain a synthetic origin.

Older native files without `timeline` remain unaligned, even if their `startValue` fields look comparable. Aggregate inputs such as pprof, folded stacks, cProfile projections and thread-dump snapshots do not become chronological merely because they use seconds or contain thread names.

The [authored native example](../sample/profiles/speedscope/synchronized-threads.speedscope.json)
contains three aligned threads, one unanchored profile and aggregate counts so
that both alignment and exclusion behavior can be reviewed.

## Bounded rendering and current scope

Tracks inspects metadata for at most 10,000 profiles and offers at most 64 clock-group choices. Profiles without an origin, nonchronological/derived profiles, non-time units and invalid durations are excluded. Limits and incomplete rendering are reported explicitly.

The shared viewport has one time range across visible rows. Rows are virtualized: at most 24 rows are mounted, with up to the first eight call depths displayed per row. A viewport retains at most 12,000 extracted rectangles in total, and its canvas is capped at 4,096 by 2,048 pixels with device-pixel ratio capped at two. It does not retain a complete flamechart or a separate GPU atlas for every thread.

At the rectangle limit, a bounded heap preferentially retains larger real
intervals across the viewport, then shallower calls; equal-duration ties use a
deterministic priority. Long parents and late activity are not lost merely
because shorter calls closed earlier. Intervals retain their measured clipped
positions and widths; the view does not invent occupancy bins or enlarge tiny
calls. Omitted intervals are reported, so this remains an overview when detail
exceeds the budget.

Extraction reads existing call events, yields periodically and supports cancellation when the recording or viewport changes. Moving the crosshair reuses the current extraction. Panning to a late range can rescan earlier event prefixes; this is a deliberate bounded-memory tradeoff, not an out-of-core time index. Hidden depths and omitted rectangles remain accessible through an individual profile's detailed view.

This view is an aligned timeline overview. It does not reconstruct missing timestamps, synchronize unrelated captures, sum overlapping thread activity into wall time, or add cross-process causal annotations. Individual-profile selection and recursion-flattening behavior remain in the existing views.
