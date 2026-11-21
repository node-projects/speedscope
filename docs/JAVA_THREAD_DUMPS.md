# Java thread-dump snapshots

Import traditional HotSpot text output from `jstack PID` or
`jcmd PID Thread.print` by opening a `.jstack` file or a text file containing
the `Full thread dump …` header. Concatenate captures from the same JVM to
compare observed stacks across repeated snapshots. You can also open a ZIP of
traditional text captures from the same JVM; see [archive limits and supported
ZIP formats](JAVA_THREAD_DUMP_ZIP.md).

Each observed Java stack contributes one raw sample. The importer creates an
aggregate profile per thread name and Java thread ID, falling back to `tid`
when the Java ID is absent. Renamed threads appear separately. Missing threads
and threads without Java frames add no samples. The profile selector switches
between threads; Left Heavy, Sandwich and Call Tree show the observations.
Time Order is unavailable because snapshots do not measure execution duration.
CPU, elapsed, timestamps, state and lock text are not converted into weights.

Frames retain method/module names and available source files and positive line
numbers. Native Method and Unknown Source entries keep their identity without
inventing a source location. Deadlock summaries are ignored because they repeat
stacks already listed in the snapshot. Malformed thread headers, malformed Java
frames and duplicate thread identities within a snapshot produce an import error.

The parser iterates lines and retains the current stack and current snapshot's
thread identities, rather than collecting every line or observation. The text
input and resulting profile model still occupy memory; this format does not use
the duration-trace streaming importer. Prefer captures from one JVM per file.
The ZIP importer instead feeds bounded UTF-8 lines into the same parser and
checks both declared and actual decompressed sizes. Structured virtual-thread
JSON, native address stacks and lock/state visualization remain outside the
supported format. Unsupported ZIP variants can be extracted before importing
their text captures.

The checked-in [synthetic example](../sample/profiles/java-thread-dump/synthetic.jstack)
contains repeated snapshots and source locations. Format references are
[OpenJDK's traditional dump examples](https://github.com/openjdk/jdk/blob/master/test/hotspot/jtreg/serviceability/tmtools/jstack/utils/DefaultFormat.java)
and the [Oracle Java troubleshooting guide](https://docs.oracle.com/en/java/javase/21/troubleshoot/troubleshooting-guide.pdf).
