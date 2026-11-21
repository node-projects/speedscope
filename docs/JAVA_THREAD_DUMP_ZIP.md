# Java thread-dump ZIP archives

Open a ZIP containing traditional HotSpot `jstack` / `jcmd Thread.print` text
captures from **one JVM**. The same thread name and Java thread ID identify a
thread across snapshots; renamed threads remain separate. Each observed Java
stack contributes one raw sample, not measured elapsed time. Missing threads
and entries without Java stacks contribute no samples.

Entries are processed in deterministic, case-sensitive filename order, not ZIP
insertion order or file modification time. For example, `1.jstack`, `10.jstack`,
then `2.jstack` is the lexical order. The result is aggregate, so this ordering
does not claim a timeline or attach elapsed durations to snapshot intervals.
Every `.jstack` entry must contain its own `Full thread dump` header near the
start. Each entry boundary closes the previous snapshot.

The importer recognizes `.jstack`, `.txt`, `.log`, `.dump` and `.tdump` entries
with a `Full thread dump` header within the first 64 KiB. Other regular files
and ordinary notes are ignored as profile input, but still undergo bounded
decompression and checksum validation. Directories are skipped. Text is strict
UTF-8; UTF-16 dumps should be converted or imported as separate text files.

## Resource policy

| Resource | Maximum |
| --- | ---: |
| Compressed archive | 32 MiB |
| Archive entries, including directories | 512 |
| Decompressed bytes per entry | 16 MiB |
| Total decompressed bytes, including ignored files | 64 MiB |
| UTF-8 filename bytes | 512 |
| Path depth | 8 components |
| Decoded line length | 65,536 UTF-16 code units |

Declared sizes are checked before decompression. Actual expanded bytes are
checked on every output chunk before decoding or parsing, so lying ZIP headers
cannot bypass the limits. The inflater emits chunks of at most 16 KiB; a limit
violation can allocate that one output chunk before it is rejected. It never
accumulates the whole expanded entry. The line decoder retains at most one
bounded line, while the parser retains the current stack, current snapshot's
thread identities and the resulting profile builders. The compressed input and
final profile model still occupy memory; this is not an out-of-core viewer.
The importer yields during work and supports cancellation without returning a
partially imported group.

## Supported ZIP subset

Single-disk ZIP32 archives using **STORE** or **DEFLATE** are supported, including
ordinary data descriptors. Local/central headers, entry extents, decompressed
sizes and CRC32 checksums must agree. Paths are validated without extracting
anything to disk. Absolute/traversal paths, duplicate or case-colliding names,
file/directory conflicts, symlinks, special files and non-normalized Unicode
paths are rejected. Names must be ASCII or explicitly UTF-8.

Encrypted archives, ZIP64, split archives, self-extracting prefixes, archive
padding, alternate Unicode-path extra fields and other compression methods are
unsupported. Extract an unsupported archive yourself and open its text captures
individually or concatenate them into one `.jstack` file.

The checked-in [synthetic archive](../sample/profiles/java-thread-dump/synthetic.zip)
contains two short snapshots of the same thread. This is an independently
implemented ZIP32 reader based on
[PKWARE's ZIP specification](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT),
using the existing
[pako incremental inflater](https://github.com/nodeca/pako/blob/1.0.6/lib/inflate.js).
It does not use JSZip's whole-entry `async('string')` allocation path.
