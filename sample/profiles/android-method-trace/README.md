# Android method-trace fixture

`synthetic-dual.trace` is independently authored synthetic data, not a recording
from an Android device. Regenerate it with:

```sh
node sample/profiles/android-method-trace/generate-synthetic.mjs
```

It contains a UTF-8 key section followed by a little-endian `SLOW` version-3
header and six 14-byte dual-clock records. Two thread identities and overloaded
method signatures exercise source metadata, per-thread ordering and separate
CPU/wall totals. Interleaved wall records need not be globally sorted.

## Format and clock policy

The importer supports the classic concatenated key/data format: version 1 with
one-byte thread IDs, version 2 with two-byte thread IDs, and version 3 with an
explicit record size (including padding). `clock=thread-cpu`, `clock=wall`, and
version-3 `clock=dual` are recognized; legacy version-1 `clock=global` means wall
time. Missing/unknown clock metadata is rejected instead of guessed.

All profile values use microseconds. Dual-clock input creates separate labeled
CPU and wall profiles for each observed thread, so CPU consumption is never
substituted for elapsed time. CPU clocks are local to their thread. Wall offsets
remain relative to the trace origin; leading unobserved intervals can therefore
appear as idle weight. The header's absolute start date is not added to offsets.

Method entry, exit and exception-unwind actions maintain stack context.
Calls already active at trace start are reconstructed from initial exits,
wrapping their observed children from offset zero. Calls still open at EOF close
at their own thread's last observed event; no unobserved tail time is added.
These are clipped observation windows, not claims about complete method duration.

The importer scans fixed records twice without building a parsed-record array.
Temporary state consists of the key dictionaries and per-thread stacks, plus
the output builders. The input buffer and resulting profiles still occupy memory.
Key text is decoded one line at a time, with explicit limits of 16 MiB per key
section and 1 MiB per line. The binary length, record count when declared,
method IDs, actions, per-thread timestamp monotonicity and stack transitions
are validated before building the output.

## Sources and unsupported variants

Primary references checked on 2026-11-21:

- [AOSP VmTraceParser](https://android.googlesource.com/platform/tools/base/+/studio-master-dev/perflib/src/main/java/com/android/tools/perflib/vmtrace/VmTraceParser.java)
  (blob `a01e92ff88f03b57dcdb160015c11c2193c9d238`): versions, key metadata,
  clock interpretation, record layouts and actions.
- [AOSP classic format documentation](https://android.googlesource.com/platform/frameworks/base/+/b5a1ce2f5daa20b5c77113b8887e12dcc05590fc/docs/html/tools/debugging/debugging-tracing.jd):
  concatenated files, little-endian values and version-1 timestamps.
- [AOSP CallStackReconstructor](https://android.googlesource.com/platform/tools/base/+/refs/tags/android-4.4.3_r1.1/perflib/src/main/java/com/android/tools/perflib/vmtrace/CallStackReconstructor.java)
  and [dmtracedump](https://android.googlesource.com/platform/dalvik/+/c423f55f64f430d0e56a1809db49129f03760230/tools/dmtracedump/TraceDump.c):
  initial unmatched exits and final open-call clipping.
- [Current ART writer](https://android.googlesource.com/platform/art/+/master/runtime/trace.cc):
  explicit clocks, per-thread CPU origin and distinct streaming/new-format modes.

Raw binary-only/streaming traces (including their version-mask extension), newer
ART packet formats, Perfetto protobuf, Android systrace HTML and timestamp-wrap
recovery are not supported by this importer. Extract/archive conversion and
deobfuscation are separate concerns. Corrupt partial records and decreasing or
wrapped per-thread timestamps produce explicit errors.
