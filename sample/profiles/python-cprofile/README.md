# Synthetic native cProfile fixtures

`generate.py` profiles only the local synthetic functions defined in that file, using a deterministic timer. It does not import or run an external workload. Functions include a shared leaf called by two parents, a recursive path, and a builtin call. Source filenames are replaced with `cprofile-fixture.py`, so the fixtures do not contain a developer's absolute workspace path.

Generated with CPython 3.14.3:

```sh
python sample/profiles/python-cprofile/generate.py
```

- `native.prof` is written by the real `cProfile.Profile.dump_stats()` API.
- `marshal-v0.prof` through `marshal-v5.prof` contain the same cProfile statistics using each supported marshal wire version.
- `expected.json` records the original function self/cumulative times, counts, source locations, and direct caller statistics for assertions. Timing values come from the profiler's deterministic timer rather than wall-clock execution speed.

Changing Python version can change profiler details or marshal output; these are version-pinned fixtures rather than a promise of byte-identical output across Python releases. Function order can vary, and tests compare semantic measurements.

See [native cProfile semantics and limits](../../../docs/PYTHON_CPROFILE.md).
