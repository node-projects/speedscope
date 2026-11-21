# OpenTelemetry Profiles JSON

The importer accepts the lower-camel-case JSON representation of current
`opentelemetry.proto.profiles.v1development.ProfilesData` and
`collector.profiles.v1development.ExportProfilesServiceRequest`. Both have
`resourceProfiles` and one shared `dictionary`. This is **sampled stack data**,
not OpenTelemetry distributed traces (`resourceSpans`).

The supported schema is pinned to OpenTelemetry Proto commit
[`d31f7acf9d461fd0601077de516ac1eb7051422f`](https://github.com/open-telemetry/opentelemetry-proto/blob/d31f7acf9d461fd0601077de516ac1eb7051422f/opentelemetry/proto/profiles/v1development/profiles.proto),
OTLP Profiles **development version 1**. This development schema is unstable.
Older per-profile dictionaries, `ProfileContainer`, singular `sample`, repeated
`sampleType`, and future incompatible schemas are unsupported.

Development version normally belongs to OTLP transport metadata, not JSON.
The transport specification defaults absent metadata to version 1. A standalone
file can optionally advertise `developmentVersion: 1`; other advertised values
are rejected. This annotation is an importer extension, not a standard schema
field. Unversioned files must match the documented current dictionary layout;
the importer cannot identify future incompatible changes that retain that shape.

## Dictionary and stacks

All seven tables must be present: `stringTable`, `mappingTable`, `locationTable`,
`functionTable`, `linkTable`, `attributeTable`, and `stackTable`. The official
schema requires a default-value entry at index zero even in unused tables.
Default fields inside these entries can be omitted. Link-zero trace/span IDs
may also be all-zero hexadecimal IDs. References are nonnegative in-range
int32 indices; zero represents an unset reference.

`stackTable[].locationIndices` and inline `locationTable[].lines` are leaf-first;
the viewer reverses both to retain the full caller/inline chain. Function names
fall back to system names. File, line and column identify symbolized frames.
Unsymbolized locations retain their binary filename and exact uint64 hexadecimal
address. Equal frame values merge independently of dictionary index.

Profile/sample `attributeIndices` resolve through `attributeTable`.
Resource/scope attributes accept direct keys or `keyStrindex`, and values accept
direct strings, `stringValueStrindex`, exact int64 integers and booleans. Complex
attributes are ignored for grouping. Duplicate attribute keys are rejected.
Sample `thread.id`/`thread.name` override profile attributes and create separate
thread profiles. Integer thread IDs remain exact decimal strings. Input profile
objects, resources and scopes remain separate even when names or IDs match;
labels include the service (or executable), scope, metric, profile ordinal and
thread. Generic attributes, scope versions, profile IDs and span links are not
preserved in viewer/export metadata. Links never become stack frames.

## Values, units and time

Each sample needs `values`, `timestampsUnixNano`, or both. Both populated arrays
must have equal length. Values sum directly; timestamp-only observations each
contribute **one in the declared sample unit**, exactly as specified by OTLP.
`period` and `periodType` are informational and never multiply weights.

Supported units are `nanoseconds`/`ns`, `microseconds`/`us`/`µs`/`μs`,
`milliseconds`/`ms`, `seconds`/`s`, `bytes`/`By`, and raw counts
(`count`, `1`, `{count}`, or empty unit). Unknown units are rejected. Values are
not rescaled when selecting the formatter. Negative differential weights and
weights/totals exceeding JavaScript's exact integer range are rejected.

Profiles are imported as **aggregate**, with measured stack weights. Epoch
timestamps do not become a duration axis, and gaps do not generate idle stacks.
Timestamps and addresses use exact uint64 parsing; decimal strings are required
for values beyond JavaScript's safe integer range. Timestamp validation uses
the exact epoch. A nonzero profile duration requires samples within the declared
half-open time range; zero-duration instant profiles skip this range check.
Overflowing time ranges are rejected. Timestamps and period metadata are not
retained in exports.

## Limits and remaining support

The JSON document is currently parsed in memory; this is not a streaming JSON or
protobuf importer. Import processing avoids an expanded observation/record array
and does not retain flattened copies of every dictionary stack. Memory consists
of the parsed JSON, output profiles, per-thread builder state and one stack.
Processing yields every 4,096 counted operations and checks cancellation.

Limits are one million dictionary entries total; one million elements per input
array; 100,000 expanded frames per stack; 4,096 attributes per set; 4,096
output profiles; 4,096 characters per grouping attribute value; and ten million
counted hierarchy/sample/observation/location/inline operations. Limits fail
explicitly rather than silently dropping samples. The parsed JSON and output
itself still consume memory proportional to their size.

Binary OTLP protobuf, old development layouts, original payload decoding,
automatic network collection, and chronological OTLP visualization remain
unsupported. Binary protobuf has no unique identifying magic; the importer does
not guess it ahead of existing pprof detection. The synthetic fixture and its
provenance are in `sample/profiles/otel-profiles`.
