# Synthetic instant-event fixture

`instants.json` is authored for this project and contains no captured user data.
It combines `i`, historical `I`, and `R` points with one ordinary stack interval
and a numeric counter. It covers default thread scope, process scope, global
events from different producers, out-of-order timestamps, coincident events,
plain-text query arguments and unresolved source stack metadata.

Expected stack weight remains 20 microseconds with exactly one frame. Three
instant lanes are produced. Thread events sort to 825.5 and 829 microseconds;
the two global events both remain at 834 microseconds in their original order.
`displayTimeUnit: "ns"` is deliberately present: it is a display preference,
not a conversion of source `ts` units.

The `hi` record derives from the public JSON example in
[upstream #402](https://github.com/jlfwong/speedscope/issues/402). The exact
instant-only example, including its trailing comma and empty `samples` field,
is tested separately. Its `stack: ["a", "b", "c"]` is retained as unresolved
JSON details, never converted into duration or measured sampled stacks.

Primary format evidence is Catapult commit
[`6fd8bbe723677254ff1130a1a416988b8b3e285e`](https://github.com/catapult-project/catapult/blob/6fd8bbe723677254ff1130a1a416988b8b3e285e/tracing/tracing/extras/importer/trace_event_importer.html):
`processInstantEvent` interprets scope and zero-duration points;
`processDurationEvent` accepts `I`/`i`/`R` as instants and reads wall timestamps
through `toModelTimeFromUs_`. This fork uses independent point tracks rather than
creating stack durations. Recognized legacy CPU payloads retain CPU routing;
standalone historical JIT records are not newly decoded as annotations.
