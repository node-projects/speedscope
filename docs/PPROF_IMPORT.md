# pprof and signed heap deltas

Import binary protobuf pprof, including its usual gzip wrapper. The selected
metric is `default_sample_type`, or the last sample type when no usable default
is present. Positive-only recordings retain the ordinary single aggregate
profile. Time Order is unavailable: protobuf samples do not establish call order.

Go's `/debug/pprof/heap?seconds=N` can return a delta recording containing
negative values. Those values now import as two explicitly named profiles:

- **Negative contributions (magnitude; subtract)** contains the absolute values
  of negative samples.
- **Positive contributions** contains positive samples.

These are signed contributions, not historical before/after heap snapshots.
Choose **Profile actions → Compare profiles…**, with negative contributions as
Baseline and positive contributions as Candidate, in **Absolute weights** mode.
Candidate minus baseline gives the net signed change for each call path. The
same-path contributions remain separate until comparison; cancellation to zero
does not discard either side. The graph's union widths represent gross
contribution magnitudes, not elapsed time or live-heap size. Normalized mode
instead compares relative composition and should not be read as net byte change.

For example, samples of -9, +12 and -2 bytes on one stack become 11 negative and
12 positive bytes, yielding +1 net byte. All-negative recordings have an empty
positive side and remain comparable. Zero-valued samples have no width. Export
preserves both magnitude profiles in ordinary speedscope JSON; their names
describe the projection. Export does not recreate the original signed protobuf.

Selected sample values and the total on each side must fit exact JavaScript
integers (`Number.MAX_SAFE_INTEGER`). Larger values fail explicitly rather than
rounding or dropping negative values. This is not arbitrary-precision int64
support. Existing pprof limitations remain: only the selected metric is imported,
only the outermost inline location frame is retained, labels and mapping/address
metadata are not fully represented, and parsed input plus output trees scale
with capture size. Generic gzip decompression is not bounded by the text-stream
limits. This change does not make pprof streaming or out of core.

A local Go 1.24.1 `net/http/pprof` heap-delta check allocated then released 16 MiB
between collections. It imported 16,777,600 negative and 78,112 positive bytes,
giving -16,699,488 bytes net; browser comparison displayed -15.93 MiB. Allocation
overhead varies between runs. The ignored capture is an authored regression
observation, not the unavailable original upstream recording. Deterministic
checked-in tests cover both signs, same-path cancellation, all-negative values,
unit preservation, exact-range failures and export round trips.

- [Go HTTP pprof parameters](https://pkg.go.dev/net/http/pprof#hdr-Parameters)
  define `seconds=N` delta recording behavior.
- [pprof protobuf schema](https://github.com/google/pprof/blob/main/proto/profile.proto)
  defines sample type selection and signed int64 sample values.
