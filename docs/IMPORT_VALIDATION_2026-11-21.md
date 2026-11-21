# Import-format validation, 2026-11-21

This batch adds classic Android method traces, bounded Java thread-dump ZIP
archives, broader large-file worker routing, and pprof metadata corrections.
See [format coverage and limitations](IMPORT_FORMATS.md) and
[ZIP limits](JAVA_THREAD_DUMP_ZIP.md). It does not make generic formats streaming
or the final profile model bounded in size.

## PLC regression

The private PLC gzip recording imported in 3,004 ms in one Node run on this
Windows ARM64 machine. This is a regression observation, not a controlled speedup
comparison or a browser timing guarantee. The export retained four profiles,
17,510 frames and 1,039,656 call events. Its baseline hash remains
`522de77afbfc4dd94f1f30c3a9551979d12db506305ffef999db9c910ae8eddb`.
The capture and benchmark artifacts remain uncommitted.

Browser checks used the built single-HTML app served over loopback HTTP with
external connections blocked by CSP. The PLC imported successfully, exposed
four profiles and rendered its call tree without console errors. The synthetic
Android dual-clock capture exposed CPU/wall totals of 20/40 microseconds for
the main thread and 7/20 microseconds for its worker. The two-snapshot Java ZIP
produced two raw samples and correctly disabled chronological Time Order.
These checks do not validate file:// loading or a real Android device capture.

## Automated verification

The final clean-cache Jest run passed 458 tests across 75 suites with 307 snapshots
using the official local Node 22.23.5 ARM64 runtime. System Node 24.19.0 ARM64
passed all five CLI/release-helper Node tests. Previous native crashes of full
Jest on this system's Node 24 ARM64 remain a local runtime limitation; no tests
were weakened to hide them. The CI matrix covers Node 22 and 24 on Windows and
Linux x64.

Type checking, linting, schema/backlog checks and Pages/standalone/single-HTML builds
passed. npm dry-pack includes the new format and ZIP resource-policy guides.
Targeted regressions cover ZIP expansion ceilings, cancellation, corrupt archives,
300 snapshots, Android record/clock validation, generic worker ownership and pprof
source identities. Pprof's existing fixture totals were reviewed after separating
source positions; frame cardinality can increase, while aggregate weights remain
unchanged. Signed negative pprof weights still require separate model support.
