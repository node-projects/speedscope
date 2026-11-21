# Synthetic current OTLP Profiles fixture

`synthetic.json` was authored for this project, contains no captured user data,
and follows the Apache-2.0 OpenTelemetry Proto schema at commit
[`d31f7acf9d461fd0601077de516ac1eb7051422f`](https://github.com/open-telemetry/opentelemetry-proto/blob/d31f7acf9d461fd0601077de516ac1eb7051422f/opentelemetry/proto/profiles/v1development/profiles.proto)
(development version 1), plus its `common/v1/common.proto` dictionary-key/string
extensions. It is not an exporter compatibility capture.

It exercises required dictionary-zero entries, interned resource/thread labels,
an integer thread ID above JavaScript's safe range, exact epoch nanoseconds,
inline leaf-first lines, value-only and timestamp-only observations, and a
period that must not multiply the total. Expected aggregate weight is
2 + 3 + 1 + 1 + 7 = 14 nanoseconds. Timestamp-only values of one follow the
schema's Sample comment, not an inferred elapsed-time interval.
