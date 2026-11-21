# Native Python cProfile statistics

Open an uncompressed `cProfile.Profile.dump_stats()` file named `.prof`, `.pstats`, or `.cprofile`. The importer reads a restricted, data-only subset of CPython's marshal format. It does not invoke Python, execute code, or accept pickle/code objects. A marshal dictionary signature and the complete cProfile record schema are required; the extension alone does not establish validity.

The primary profile, **flat self time**, preserves each function's measured self time in seconds, with filename and first source line. Its total is the sum of those self times. No call order is available. Functions with zero self time have no measured width in this projection.

The secondary profile, **immediate-caller self time; not full stacks**, assigns each function's self time to its recorded direct callers. A two-frame stack represents one direct edge only. Self time not attributed to a caller appears as a one-frame stack. Recursive edges remain two-frame edges; they are not expanded into hypothetical deep stacks. Both profiles are marked nonchronological, including after export.

cProfile stores an aggregate directed call graph. Shared callees and recursion mean the original full stack paths cannot be recovered from these records. This importer does not invent those paths or turn cumulative times into additive self time. Primitive/total call counts and cumulative times are validated, but are not separate displayed metrics. If caller self times exceed a function's self time beyond rounding tolerance, the importer keeps only the exact flat projection and marks its profile name **caller attribution unavailable**. Tiny floating-point excesses within relative tolerance `1e-12` are clipped to the remaining self time.

## Limits and cancellation

The native decoder accepts at most 32 MiB of input, one million decoded objects, 500,000 references, 8 MiB of decoded string bytes in total, 64 KiB per source string, depth 16, 100,000 functions, and 200,000 direct caller edges. All limits apply together; a smaller object/string limit can be reached before the function/edge ceiling. The reader checks lengths before allocation, rejects incomplete/cyclic references, duplicate source identities, trailing data, unsafe integer counts, invalid UTF-8, unsupported object types, and nonfinite/negative measurements. Decoding/building yields periodically and supports cancellation. The parsed marshal graph and both output projections coexist during import; this is a bounded in-memory importer, not a streaming or out-of-core format.

Oversized **raw** native files are checked using a six-byte signature slice before reading their body. Generic gzip/zlib decompression happens before binary format detection and is not currently bounded by this native decoder's input limit. Compressed `.prof` files can also be pprof recordings, so those generic wrappers are retained. For predictable memory use with native cProfile, supply the uncompressed marshal file within the size limit. Do not treat the 32 MiB decoder limit as a generic compressed-input expansion limit.

## Compatibility and evidence

The fixtures were produced by CPython 3.14.3's actual cProfile profiler, with a deterministic timer, a shared callee, builtins, and recursion. The same statistics are additionally serialized with marshal wire versions 0–5. These fixtures verify the supported data encodings; they do not establish compatibility with every historical or future Python release. Python explicitly reserves the right to change marshal and profiler file formats. Python 2 byte-string labels, pure-Python `profile`'s different caller schema, arbitrary marshal values, and future unsupported encodings are rejected rather than guessed.

- [CPython 3.14.3 cProfile implementation](https://github.com/python/cpython/blob/v3.14.3/Lib/cProfile.py): `snapshot_stats()` defines function and caller tuples.
- [CPython 3.14.3 marshal implementation](https://github.com/python/cpython/blob/v3.14.3/Python/marshal.c): numeric/string/container/reference encodings.
- [Python marshal documentation](https://docs.python.org/3.14/library/marshal.html): version limitations and the hazards of unrestricted native unmarshalling.
- [Python pstats documentation](https://docs.python.org/3/library/pstats.html): self/cumulative time and call-count meanings.
- [Synthetic fixture source and regeneration](../sample/profiles/python-cprofile/README.md).
