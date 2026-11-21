# Python sampling collapsed fixture

`synthetic.collapsed` is independently authored synthetic data in the output
format of CPython 3.15's `profiling.sampling` `CollapsedStackCollector`.
It is not a captured Python process or a copy of a CPython test fixture.

The format was checked against
[`stack_collector.py` at CPython commit a0a5af4](https://github.com/python/cpython/blob/a0a5af4b92549469c85529c1a2f0f16a3a6bbb70/Lib/profiling/sampling/stack_collector.py#L31)
and the [Python 3.15 output-format documentation](https://docs.python.org/3.15/library/profiling.sampling.html#collapsed-stacks-format).
The collector emits a `tid:` root followed by root-to-leaf frames named
`basename:function:line`, with a final integer observation count. Special
`~`, line-zero frames use their function name alone. Rows are ordered by
descending count, then lexical stack name. The fixture exercises two thread
roots, repeated shared frames, source-bearing labels, Unicode and the bare
`<GC>` / `<native>` markers.

The existing generic folded-stack importer reads this format without another
parser: all counts remain raw sample weights, thread IDs remain visible stack
roots, and source-bearing labels remain literal names. It does not infer
elapsed time, recover full source paths from basenames, or separate each thread
into a different profile. The sample does not establish support for Python's
binary, pstats, generated HTML or other export formats.

For new captures, select `--collapsed` when running Python's sampling profiler
and import the resulting text file. The CLI's accepted arguments may vary by
Python prerelease; consult the installed profiler's `--help` output.
