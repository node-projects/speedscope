# Linux perf imports and weight semantics

Import text from `perf script`. Include `comm`, thread/process identity, `time`,
`event`, `period`, `ip`, `sym` and `dso` fields when available. Regular callchains
and leaf-only `--hide-call-graph` output are supported. Keeping `period` is
important: timestamps alone do not measure a sampled function's CPU consumption.

## Periods determine the weights

| Recorded event | Period present | Period absent |
| --- | --- | --- |
| `cpu-clock`, `task-clock` | Aggregate sampled CPU time, in nanoseconds | Legacy inferred timestamp timeline, explicitly labeled |
| `offcpu-time` | Aggregate sampled off-CPU time, in nanoseconds | Sample count, explicitly labeled |
| `cycles`, including hybrid CPU PMUs | Aggregate raw cycle periods | Legacy inferred timestamp timeline, explicitly labeled |
| Other hardware/software counters | Aggregate raw event periods | Sample count, explicitly labeled |

Event modifiers such as `:u` retain these rules. Hybrid `cpu_core/cycles/u` and
`cpu_atom/cycles/u` samples are combined under the normalized `cycles:u` event.
Different events, processes and threads remain separate. If some records have
periods while others omit them, their profiles remain separate too, so inferred
seconds, nanosecond periods and counts are never added together.

Period-weighted profiles use Left Heavy, Sandwich or Call Tree. Time Order is
disabled because accumulating sampled weights does not establish exact wall-time
intervals. Missing-period clock/cycle profiles retain the older timestamp
interpolation and are labeled **inferred timeline, period missing**. That view
assigns gaps between timestamps to adjacent stacks; do not interpret it as
measured CPU time or proof that a thread was running throughout those gaps.

Periods must be finite, non-negative integers within JavaScript's exact range
(`0` through `9007199254740991`). Larger individual periods fail with an
actionable error rather than being silently rounded. Totals still use the
project's ordinary floating-point weight model. Zero periods contribute zero
weight; they do not trigger timestamp inference or become a one-unit sample.

## Why gaps are not CPU time

The public reproduction in [upstream #393](https://github.com/jlfwong/speedscope/issues/393#issuecomment-1200547074)
contains 13 samples for `DiscoveryClient` thread `2614953`, each with a
`cpu-clock` period of `20408163` nanoseconds. Its sampled CPU weight is therefore
`265306119` ns, about **0.265 seconds**, while its timestamps span about
**30.231 seconds**. The importer now uses the periods instead of attributing
those gaps to functions. A single clock sample also retains its real period
instead of becoming an arbitrary one-unit sample.

The checked-in [regression fixture](../sample/profiles/linux-perf/idle-clock-period.linux-perf.txt)
uses those timestamp/period facts with authored synthetic stacks. The source
archive was [profile.out.gz](https://github.com/jlfwong/speedscope/files/9230041/profile.out.gz),
22,149 bytes, SHA-256
`40b9123046dc918018f40030426851d15622077843a8cd2923371750a6fa5efa`.

This fixes sampled aggregate attribution. Exact idle-gap placement and aligned
multithread timelines remain separate work: clock periods do not say exactly
when each fragment of CPU execution occurred within a timestamp gap. An
`offcpu-time` profile is kept separate and never added to CPU execution weights.
Scheduler-switch events and their associations need their own tested timeline
mapping; the importer does not invent those intervals.

## Format references

Linux's [software-clock sampling implementation](https://github.com/torvalds/linux/blob/master/kernel/events/core.c)
initializes clock periods in nanoseconds and arms timers with
`ns_to_ktime(period)`. The kernel's [perf record documentation](https://github.com/torvalds/linux/blob/master/tools/perf/Documentation/perf-record.txt)
specifies that `--off-cpu` produces `offcpu-time` samples whose periods are sleep
time in nanoseconds. Other event periods remain counts in that event's own
units; cycle counts are not converted to seconds.
