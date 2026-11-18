# Upstream pull request review

Reviewed 2026-11-18 against local baseline `dc794b2`.
Source: [jlfwong/speedscope open pull requests](https://github.com/jlfwong/speedscope/pulls).
The inventory contained **28 open PRs**, including the second page. Exact reviewed heads are recorded below.

**17 PRs were ported in full or in part, 2 were superseded, and 9 were deferred or rejected.**
“Partial” and “adapted” mean the changes were reviewed and reconciled with this fork; they are not blanket approvals of the upstream patch. Decisions about unported parts are recorded explicitly. Integration targets this fork's local `main`; upstream PR state is unchanged.

## Decisions

| PR | Title | Decision | Review and integration details |
| --- | --- | --- | --- |
| [#558](https://github.com/jlfwong/speedscope/pull/558) | Import trace-event files without pid and with trailing commas | Ported | Trace events and samples now share normalized missing/zero IDs, including process/thread metadata. String JSON parsing accepts trailing commas without altering quoted strings. Added optional ID types and explicit mixed-ID regression coverage. |
| [#557](https://github.com/jlfwong/speedscope/pull/557) | Search also matches a frame's file path | Ported | Search matches source paths case-insensitively while retaining character highlights only for symbol-name matches. Preserves existing substring-search behavior. |
| [#555](https://github.com/jlfwong/speedscope/pull/555) | feat(hovertip): OS-specific hovertip offsets | Ported | Uses OS-dependent cursor offsets (macOS 7, Windows 16, other 20 CSS pixels), retaining the existing tooltip placement logic. |
| [#552](https://github.com/jlfwong/speedscope/pull/552) | Fix callgrind parser: positions: instr / positions: instr line and cyclic call graphs | Partial port | Imported positions headers, hexadecimal instruction positions, positive subposition offsets and whitespace handling, with three upstream fixtures. Excluded visitedGlobally: it converts shared callees into leaves on later paths and incorrectly attributes their descendants as self time. The proposed residual-root/cycle strategy remains deferred until it preserves shared-path detail and handles rootless components reliably. |
| [#545](https://github.com/jlfwong/speedscope/pull/545) | add speedscope widget api & diff mode | Deferred | The patch replaces the product/package with speedscope-widget, rewrites packaging and tests, downgrades tools, changes default views, and uses shared global widget/application state. Embedding and profile comparisons belong as isolated, tested features; this replacement would break the existing application/distribution contract. |
| [#543](https://github.com/jlfwong/speedscope/pull/543) | feat: add --serve flag to speedscope to run basic webserver | Adapted port | Added --serve and loopback HTTP hosting. Replaced generated base64 JavaScript with a raw binary profile endpoint via profileURL. Added asynchronous file reads, HTTP error handling, canonical-path/symlink confinement, MIME types and no-store profile responses. Excluded the unconditional landing-page spinner, which could mask a failed local script load. Packaged the new server module and tested it. |
| [#538](https://github.com/jlfwong/speedscope/pull/538) | Add copy summary feature for sharing profile context with LLMs | Deferred | Useful copy-summary feature, but buildBottomsUpEntries sums inclusive totals for every occurrence of a recursive frame, unlike Profile's per-stack deduplication. Both summary traversals recurse without a depth bound. There are no automated correctness tests. Percentage formatting itself is correct. A follow-up should preserve recursive-frame accounting, handle deep profiles and expose clipboard failures to the user. |
| [#532](https://github.com/jlfwong/speedscope/pull/532) | Add link for importing from JFR in README | Superseded | README and importer already support native Java Flight Recorder .jfr input. Adding only an external conversion-tool link is unnecessary for this codebase's existing native support. |
| [#529](https://github.com/jlfwong/speedscope/pull/529) | add envvar for dev server port | Adapted port | Added SPEEDSCOPE_PORT and documentation. Adapted to esbuild's current hosts response, validates the full integer/range rather than accepting parseInt prefixes, and logs the actual selected port. |
| [#523](https://github.com/jlfwong/speedscope/pull/523) | Strip v8 different version message before parsing to JSON | Adapted port | Strips the known V8 version-warning prefix in both parser paths. Handles leading whitespace and trims again before recognizing partial arrays; byte parsing does not require TextEncoder. Added a forced string-limit fallback test. |
| [#517](https://github.com/jlfwong/speedscope/pull/517) | Add Perfetto trace import support with protobuf integration | Deferred | The sample contains timestamp-only packets and integration tests succeed even if import returns null. The implementation substitutes weight 1 for sampled/track events, does not reconstruct begin/end nesting, combines packet sequences' interned IDs, and converts protobuf bytes with toString rather than UTF-8 decoding. It cannot accurately represent real multi-track Perfetto data; generated bindings alone do not make this a valid importer. |
| [#503](https://github.com/jlfwong/speedscope/pull/503) | Add functionality to filter flame graphs by search query | Deferred | Filtering reconstructs flamecharts as the query changes and removes unmatched ancestors from traversal callbacks. This changes stack interpretation and performs unbounded full-profile work on each keystroke, conflicting with large-trace responsiveness. Needs explicit ancestor/time semantics, performance measurements and regression tests before adoption. |
| [#495](https://github.com/jlfwong/speedscope/pull/495) | [ Adjustment ]  Temporary Files Layout | Adapted port | Ported the grouped temporary-directory layout to the current ESM CLI with mkdtemp. Uses pathToFileURL and encoded hash parameters for Windows paths and reserved filename characters. Preserves the platform-specific redirect wrapper. |
| [#466](https://github.com/jlfwong/speedscope/pull/466) | Callgrind parser: Fixed associating file names with symbols and detection of root nodes | Ported with regression | Separates the defining function file from the current inline source file, and resets fn to the preceding fl. Added a minimal inline-file/callee-root regression demonstrating the previously missing coverage. |
| [#461](https://github.com/jlfwong/speedscope/pull/461) | Allow accept header to be specified alongside profileURL | Ported with documentation | Added optional profileAccepts hash parameter and Accept request header, plus parsing coverage and a README usage example. |
| [#447](https://github.com/jlfwong/speedscope/pull/447) | Increase tooltip hover offset to avoid being obscured by mouse | Superseded | Covered by #555's more precise OS-dependent offsets; applying a universal 20-pixel offset would undo the smaller macOS offset. |
| [#438](https://github.com/jlfwong/speedscope/pull/438) | Fix maximum call stack size exceeded in some case | Partial port | Replaced recursive grouped-call-tree sorting with an iterative traversal, pushing children individually to avoid spread-argument limits. Added a 20,000-frame builder regression. Excluded the renderer rewrite: its loop retains return for culling, which aborts remaining visible siblings. Other deep-tree traversals still require separate treatment; this is not a universal deep-stack fix. |
| [#417](https://github.com/jlfwong/speedscope/pull/417) | README: Explain colors | Adapted port | Documented the actual file-path-plus-symbol sorting used to assign color buckets. Avoids implying that source-line proximity or runtime cost determines color. |
| [#416](https://github.com/jlfwong/speedscope/pull/416) | README: Explain total vs. self time | Ported | Clarified total time versus self time in Sandwich-view documentation. |
| [#413](https://github.com/jlfwong/speedscope/pull/413) | Fix infinite recursion on resize | Deferred | The proposed resize guard has no try/finally, so an exception can permanently disable future resizing. It also masks the re-entrant layout/resize cause without a reproducible regression. Retained existing resize behavior and validated resize during browser checks. |
| [#401](https://github.com/jlfwong/speedscope/pull/401) | WIP: Try to get the pthreads idle example running under docker | Partial port | Ported the perf-record output correction: explicit --output=perf.data and stderr for the profiled program. Excluded global Docker container pruning/image deletion, the hard-coded old kernel package, and the unvalidated idle example. Shell syntax checked; real Linux perf capture was not available in this Windows environment. |
| [#388](https://github.com/jlfwong/speedscope/pull/388) | add support for JS Self-Profiling data | Adapted port | Added JS Self-Profiling detection and a direct StackListProfileBuilder importer. Uses existing midpoint weighting, iterative stack reconstruction, stack caching, zero-ID support and reference/cycle/timestamp validation. Added a sample trace, recording example, end-to-end format-detection/roundtrip tests and browser verification. Avoids recursive array expansion and Math.min/max.apply on large sample lists. |
| [#383](https://github.com/jlfwong/speedscope/pull/383) | fix: shouldn't merge (program) call frame | Ported with regression | Program samples now stand independently rather than being attached to the previous function/GC stack. GC retains the previous-stack treatment. Added an explicit parentage regression and reviewed six changed Chrome snapshots; changes remove wrongly attributed program time from former parents. |
| [#375](https://github.com/jlfwong/speedscope/pull/375) | chore: ignore stack with negative sample | Rejected | Silently discarding all negative samples in the shared builder changes every importer and hides invalid or signed/difference data. A pprof-specific policy or proper signed-profile model needs explicit semantics; preserve the existing validation error. |
| [#371](https://github.com/jlfwong/speedscope/pull/371) | fix(bg-flamegraph): ignore comment lines | Adapted port | Folded-stack importer ignores metadata/comment lines, including indented comments, while keeping # inside real function names. Added explicit weight/frame regression coverage. |
| [#366](https://github.com/jlfwong/speedscope/pull/366) | add "c" shortcut to slice a profile | Deferred | The slicing algorithm freezes time at the last interior transition instead of clamping boundary crossings. A call open at 0 and closed at 10 becomes zero length when slicing [2,8], although it should contribute 6. The keyboard action also replaces every loaded profile with the slice. Needs boundary and state/undo semantics before merging. |
| [#353](https://github.com/jlfwong/speedscope/pull/353) | [Proposal] Migrate to fast-check | Deferred | A maintained property-testing library is a reasonable direction, but this old migration narrows floating-point generation to [-1000,1000] rounded to 1e-3, hiding the numerical failures it found. It also targets an old lockfile/dependency stack. Adopt with preserved numeric coverage and resolved counterexamples, not this reduced-domain port. |
| [#216](https://github.com/jlfwong/speedscope/pull/216) | WIP: Fix import for some Instruments profiles | Deferred | The WIP truncates potential Instruments stack references with a signed 32-bit mask, risking aliases and cycles; the author reports incorrect timings. No minimal timing-correctness regression accompanies the workaround. Keep the existing importer until the binary/reference semantics are established. |

## Validation

- Full Jest run: **226 passed, 2 failed** across 35 suites; **305 passed, 2 failed** snapshots. The two failures are the previously reproduced PMCStat decimal-format snapshots (comma versus period), also present on unchanged upstream baseline `fe804e6`. Their snapshots were not rewritten.
- New snapshots cover JS Self-Profiling and instruction-position Callgrind fixtures. Six existing Chrome snapshots were intentionally updated for #383's corrected program-sample attribution.
- `npm run typecheck` and `npx eslint "src/**/*.ts" "src/**/*.tsx"` pass.
- `node --test bin/server.test.mjs` passes: loopback binding, static HTML/WASM, raw gzip bytes, no-store headers, HEAD/POST, malformed paths, missing paths, directories, encoded traversal, and symlink/junction escape.
- Development server starts on requested port 59311 and responds HTTP 200; invalid SPEEDSCOPE_PORT exits with a validation error.
- Browser-target esbuild bundle succeeds; CLI --help/--version and server-module package inclusion are checked.
- `bash -n sample/programs/cpp/perf-script.sh` passes.
- The supplied 1,039,851-event PLC gzip trace loads in the in-app Chromium browser, displays all four threads, and renders the time chart and Sandwich table. Browser import timer: **1905 ms** in that run (runtime import, not a universal end-to-end guarantee).
- The PLC trace retains all four call-sequence SHA-256 hashes, weights, call counts and 26 existing data warnings. Process metadata names now appear consistently because numeric-string and omitted IDs are normalized.
- Browser JS Self-Profiling import and file-path-only search are verified: querying `example.com` retains both `main` and `work`, which match via source path rather than symbol name.

## Remaining boundaries

Callgrind cycle/root inference, whole-pipeline extreme-depth handling, time-range cropping, a tested copy-summary feature, fast filtering, safe embedding/diffs, accurate Perfetto import, and the property-test migration remain separate follow-ups for the reasons above. The existing fast gzip/native-JSON loading path remains in place.

## Reviewed source revisions

| PR | Head commit |
| --- | --- |
| #558 | `2a05a335a8032ebfe4f4acbf7e14e7784b7a9423` |
| #557 | `17f2c2aa82851fb7270e055a5891fd69a6803c8b` |
| #555 | `eb384b0020789467f43d94d439b3785db7cf7354` |
| #552 | `2dee1fa330f69bc49d6323b0613636dcaeccdeda` |
| #545 | `773aebf44bbbc1a549d473ad6feaaa33bba41591` |
| #543 | `c0ac2a9511b6f00e471657989cfc191d10340255` |
| #538 | `0c9b1b2600a49ac4b8d7f231d1dfd2f6ecdebfc5` |
| #532 | `3beb4ed91b41c8b39a7980ae08994f73cd396fd0` |
| #529 | `ea54e761031a688ddd0a91636b6e36f610129c5a` |
| #523 | `5cb6e18cec5f10d1872044074df99114643264c0` |
| #517 | `3d0229dee46c6f8a4344e32340265f87424a7a5e` |
| #503 | `8adf8993eda3d0bca843d9c5d23cc78229aeb46a` |
| #495 | `9d6186fcb99ca07df5fa19307ebda1f11bfdc5d4` |
| #466 | `20bc6cebee16a7cb349d58d3ea5a0af822fcdaf5` |
| #461 | `702b82b94df83a738a9204a3d34d3bc8b3df5621` |
| #447 | `d5c0d6ab55fdf975aedf7cd68a3f14c9f02bada7` |
| #438 | `dcfc8be1a2f65a21efce5726cc630dd79b5158a9` |
| #417 | `f53945a2f4f99be726496a9e4e49df84052a8644` |
| #416 | `02f43e0778971bbba3a1c32ef2cd4bffd2cca68d` |
| #413 | `db4c613b9e2c17ff5f31455c46712a26d32d5bb3` |
| #401 | `e0ceccb98f0e50190c6ef28cab539f37909e57f9` |
| #388 | `783c44298b998c3eb743fa326960511a6ccff59a` |
| #383 | `e307fd20944e52153815f58d9df9d83df0d5162f` |
| #375 | `77dfa69d912f2267b34fd0bc080ce31f3745073b` |
| #371 | `31765f00651f746f2ed4465695e201515a7d77fb` |
| #366 | `b08cdf20f10d0227dc66b94225583b1770fab82d` |
| #353 | `f07e114473c43f951f0b9dab3bb5b131adce876b` |
| #216 | `023559400280464ba1182588012d95abddc757ca` |
