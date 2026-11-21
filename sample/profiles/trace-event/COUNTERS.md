# Synthetic Chrome Trace Event counters

`counters.json` is authored for this project and contains no captured user data.
It includes an ordinary 20-microsecond stack interval plus two independent
numeric `C` argument series. Its out-of-order records and repeated timestamp
verify sorting and deterministic last-observation wins without inventing a
missing-key zero: `used` is `[4, 7, 9]`, and `free` is `[16, 12, 11]` at
timestamps `[100, 110, 120]` microseconds. Value units are unspecified.

Primary format evidence is the Chromium Catapult importer at commit
[`6fd8bbe723677254ff1130a1a416988b8b3e285e`](https://github.com/catapult-project/catapult/blob/6fd8bbe723677254ff1130a1a416988b8b3e285e/tracing/tracing/extras/importer/trace_event_importer.html),
`processCounterEvent`: category/name/optional ID identify a counter, numeric
argument keys identify series, and timestamps use the source microsecond clock.
This fork additionally separates thread IDs and preserves numeric versus string
identifier types. Each argument is an independent series; the importer does not
stack/sum values or fill missing observations with zero.

The public [upstream #235 capture](https://github.com/jlfwong/speedscope/issues/235)
linked from #236 was inspected separately as an uncommitted real-input check.
It contains 1,227,368 events, including 407,517 numeric counter observations.
The current importer produces 113 stack profiles and 12 counter series with
406,923 timestamp-deduplicated points, including negative measurements. The
capture is not redistributed in this fixture directory.
