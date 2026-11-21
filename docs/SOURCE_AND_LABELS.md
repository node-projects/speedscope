# Source maps, source-code links and compact graph labels

## Load a linked JavaScript source map

Choose **Profile actions → Load linked source map…** after loading a recording.
Enter the generated JavaScript's HTTP(S) URL as it appears in the recording.
The dialog suggests the selected function's HTTP(S) source URL when available.
Opening the dialog or selecting a function performs no network request.

1. Choose **Load preview** to fetch that script and its linked source map.
2. Review the generated-script URL, resolved map URL and number of frames that
   would change. The recording remains unchanged during preview.
3. Choose **Apply source map** to update matching symbols and source locations
   across the loaded profiles. Weights, profile flags and recording metadata
   remain intact. Editing the URL invalidates the preview.

The map applies only to the chosen generated-script URL, including its query
string. It may have a different or hashed filename. Relative original-source
URLs are resolved against the fetched map URL; original source files are never
fetched. A script's exposed `SourceMap` response header takes precedence over
`X-SourceMap` and its trailing `sourceMappingURL` comment. JavaScript comments
are located with a tokenizer, so annotation-like text inside strings and
templates cannot initiate a map request. The script is never executed.

Both requests omit cookies and other credentials, use CORS and `no-store`, and
reject redirects. Use a direct URL whose server allows cross-origin access.
For a cross-origin `SourceMap` header, the server must also expose that header
with `Access-Control-Expose-Headers`. HTTP errors, CORS failures, missing links
and unmatched source positions stay visible in the dialog. **Cancel load**,
Escape and Close abort pending work. Importing another recording or changing
the profile models closes the dialog and invalidates its captured preview.

The downloaded script body is limited to 8 MiB when it must be inspected; an
exposed map header allows its body to be cancelled immediately. A map is limited
to 2 MiB. Before decoding mappings, the loader limits their encoded segment
count to 100,000 across nested index maps, with at most 1,000 indexed sections,
32 nesting levels and 128 encoded characters in one VLQ segment. The preview
retains at most 100,000 changed frames. Loading has a 30-second timeout and yields
between token/preview batches so cancellation can be handled. These limits
bound the additional work; they do not make the underlying recording independent
of browser memory limits.

For local scripts/maps, choose **Import** and open the `.map` file after loading
your recording. This also provides a fallback when CORS or credentials prevent
remote loading, a limit is exceeded, or the generated script cannot be fetched.
Both workflows need usable recorded line and column positions.
The browser does not read arbitrary local paths from a recording. Inline
`data:` maps, non-HTTP(S) links and URLs containing embedded credentials are
unsupported in the linked-map dialog. JavaScript syntax unrecognized by its
ES2020 tokenizer requires an exposed map header or local-map import.

This is explicit linked-map discovery for upstream
[#446](https://github.com/jlfwong/speedscope/issues/446), not automatic filesystem
discovery for Node/esbuild logs. Logs without usable source positions still
cannot be mapped. The linking/header behavior follows
[ECMA-426](https://tc39.es/ecma426/2024/#sec-retrieving-source-maps).

## Open a source location

Choose **Profile actions → Source-code links…** after loading a recording.
Select Visual Studio Code, Visual Studio Code Insiders, or a custom HTTP(S) URL.
Saving turns source locations in Call Tree and the selected stack's details into
links. A link opens only when clicked. Disable links in the same dialog.
Frames without a source file keep their ordinary display.

For local editors, the mapped path must be absolute. For example, replace recorded
prefix `/build/project` with `C:/work/project` to open `/build/project/src/app.ts`
in your local checkout. Windows separators and file URLs are accepted; Windows
prefix comparisons ignore case. Prefixes match whole leading path segments,
so `/build/app` does not match `/build/application`. Locations outside a configured
prefix stay plain text. Leave both prefixes empty to use the recorded path.

The editor presets use the official [VS Code file URI format](https://code.visualstudio.com/docs/configure/command-line#_opening-vs-code-with-urls),
with the recorded line and column, or 1 when unavailable. Your browser may ask to
open the editor. The viewer does not check that a local file exists.

Custom web templates require a fixed HTTP(S) host and a `{file}` placeholder.
Optional `{line}` and `{column}` placeholders insert source coordinates.
For example:

```text
https://github.com/owner/repository/blob/main/{file}#L{line}
```

Map a build prefix to an empty replacement to produce repository-relative paths.
File path segments are URL-encoded, preserving their separators. Embedded
credentials, other protocols, unknown placeholders and variable hosts are rejected.
The dialog previews the generated URL without opening it. Choose the repository
and revision matching the recording; links do not fetch or discover source maps.

Settings persist in this browser's local storage. They are not included in an
exported profile. If storage is unavailable, settings work for the current session.

## Shorten graph path labels

Choose **Profile actions → Compact graph path labels** to draw only the final
component of path-like frame names. Choose **Show full graph labels** to restore
the original labels. This preference also persists in this browser.

Full frame names remain available in hover details, Call Tree, Sandwich's table,
search and exports. Function signatures containing path-like punctuation are
preserved. Search still matches the full name: a match entirely inside a hidden
prefix can highlight a frame without underlining text in its displayed suffix.

## Large traces

Neither setting reimports or transforms a recording. Labels are shortened only
when drawn; source URLs are generated for mounted source locations. Settings
preview inspects at most 200 frames for a source example and otherwise uses an
editable example path. No per-frame URL table or second profile is retained.
Existing graph, call-tree and selected-stack rendering costs still apply.

Validation on 2026-11-20 passed all 334 Jest tests (307 snapshots), five Node tests,
type checking, linting, schema/backlog checks and both application builds.
Browser checks covered editor and web mappings, persistence, disabling links,
compact labels and unchanged full names in hover/stack details, with no console
errors. The private PLC trace streamed in approximately 2.6 seconds; running the
display helpers across its 17,510 frames took about 3.7 ms in that Node smoke
check. Its four profiles and 1,039,656 exported call events retained the baseline
export hash. These measurements do not include browser rendering or hydration,
and the capture and benchmark artifacts are not committed.

These features implement upstream requests [#410](https://github.com/jlfwong/speedscope/issues/410)
and [#373](https://github.com/jlfwong/speedscope/issues/373).
