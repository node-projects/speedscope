# Search across profiles and arrange Sandwich panes

## Choose a profile with the keyboard

For a recording with several profiles, click the profile name in the toolbar or
press **t** to open the chooser. The **Filter profiles** combobox receives focus.
Type part of a thread/profile name to filter with the existing fuzzy matching.
Queries are limited to 256 characters. The result list identifies the currently
selected profile separately from the active keyboard result.

Use **Up/Down** to move the active result, **Home/End** to reach either end and
**Page Up/Page Down** to move by a results page. **Enter** selects the active
profile. **Escape** or **Close** dismisses the chooser and returns focus to its
trigger. Typing during an input-method composition does not activate results;
modified editing shortcuts such as Ctrl/Command+A retain their normal behavior.
Typing in the chooser does not trigger the viewer's global shortcuts.

The result list exposes a listbox with selected state, an active descendant and
each result's position in the full filtered set. Native buttons sort by index,
name or total non-idle weight and report the active direction. Tab can reach the
sort, page and Close controls; moving focus outside dismisses the chooser without
pulling focus back from the next control. Clicking an option also selects it.

At most **100 options** are mounted at a time. Keyboard navigation automatically
switches result pages, and **Previous/Next** page buttons make other results
available without rendering every profile row. The result range is displayed
explicitly. Filtered/sorted results retain numeric profile indices; highlight
ranges are calculated only for the displayed page. Filtering and sorting still
scan or arrange the recording's profile list, so the DOM bound is not a total
memory or processing-time guarantee. This improves the chooser's portion of
[#376](https://github.com/jlfwong/speedscope/issues/376); it does not make the
canvas charts or every viewer control fully accessible.

## Regular expression search

The viewer and Search all profiles offer **Regex (RE2)** alongside the existing
literal Contains, Whole word and Exact modes. Enter a pattern directly, such as
`^render|worker[0-9]+` or `\.tsx?$`, without JavaScript `/.../flags` delimiters.
Matching starts case-insensitive; RE2 inline flags can adjust it. Both function
names and source paths are searched in full, with no symbol truncation.

The engine is the pinned MIT-licensed
[`re2js` 2.10.0](https://github.com/le0pard/re2js/tree/2.10.0), a pure JavaScript
RE2 port. It uses linear-time matching rather than executing user patterns with
native JavaScript's backtracking engine. Backreferences and lookaround are
unsupported here and produce an error. RE2 syntax differs from JavaScript
RegExp syntax; the app does not translate unsupported expressions or silently
switch engines. Literal modes keep their previous behavior.

Patterns are limited to 256 UTF-16 characters. A conservative preflight rejects
counted-repeat bounds above 1,000 or estimated expansions above 4,096 states
before compilation; the compiled program also has a 4,096-state ceiling. This
can reject some otherwise valid RE2 expressions; simplify their repetitions.
Invalid syntax and limits appear as errors in the search UI, without replacing
the profile or crashing its rendering. Empty patterns match nothing. Zero-width
matches select frames but do not paint nonexistent characters. Highlight offsets
use UTF-16 indices, including after astral characters, as the existing label
renderer expects.

One compiled pattern is cached for validation/reuse; existing bounded frame and
highlight caches and navigation/result caps still apply. At most 64 match
attempts per visible label are used for highlights, counting zero-width matches
toward this budget. Boolean matching still scans the complete symbol. Search
across profiles yields between bounded batches; synchronous matching of an
individual exceptionally long symbol can still take time proportional to its
length. This is not a fixed wall-time guarantee or a cap on profile storage.

The dependency has no runtime dependencies or external WASM/network load. An
isolated esbuild minified browser import measured approximately 151 KB (46 KB
gzip); final app bundle size depends on bundling and compression.

A local PLC regression scanned 513,009 occurrences with a no-match regex in
30 ms and retained about 0.60 MiB of search state after collection. A broad
`^.*` query reached the existing 10,000-result navigation ceiling in 6 ms and
retained about 1.02 MiB. Both runs preserved four profiles, 17,510 exported
frames, 1,039,656 events and export hash
`522de77afbfc4dd94f1f30c3a9551979d12db506305ffef999db9c910ae8eddb`.
These are individual Windows ARM64 Node observations, not browser latency or
total-memory guarantees; they exclude import and initial flamechart creation.

## Search all profiles

Choose **Profile actions → Search all profiles…**, enter a function name or source
path, and press Search or Enter. Contains, Whole word and Exact modes use the same
case-insensitive literal matching as the single-profile search. File paths are
searched too. There are no arbitrary regular expressions.

Each result represents one frame in one profile, with its source location and
that profile's total/self weights. Different threads and same-named functions in
different files remain separate. Weights are not added together, and results may
have different units. Derived profiles are excluded by default; select **Include
derived profiles** when you want to search filtered/combined views as well.

Open a result to switch to its original profile and select that frame in Sandwich.
Its callers, callees and ordinary search highlights are available there. This also
works when recursion flattening is enabled. No combined profile or transformed
recording is created. Replacing the source profiles invalidates pending searches
and prevents stale results navigating into a different recording.

The dialog shows at most 200 results and stops scanning when it finds a further
match. A truncation message asks you to refine the query; the number shown is not
claimed to be the complete number of matches. Queries are limited to 4,096
characters. Editing search options clears the previous results; submit again to
search with the new settings. Cancel search stops unfinished work, while Close or
Escape closes the dialog. Clipboard input stays inside the dialog.

The search iterates frames lazily and yields based on both frame count and symbol
text size. It does not enumerate every call occurrence or allocate an unbounded
result table. Navigation and the existing viewer still have normal profile,
recursion-flattening, sorting, highlight and rendering costs; the result limit is
not a hard cap on total browser memory or the cost of opening a large profile.
A local PLC smoke check searched 17,510 frames across four profiles, found 40
matches without truncation, and left all profile totals unchanged. It took about
148 ms with ten yields in that Node run; this is not a browser latency guarantee.

## Keep a function selected across views

Selecting a function in Time Order, Left Heavy or Sandwich now carries that
function into the other two views of the same profile. Selection uses the frame
key, so same-named functions from different files remain distinct. Each view
keeps its own valid call-tree instance and zoom. If it has no instance for the
newly selected function, it chooses the first matching node in that view's
depth-first tree order. The view does not automatically change its time range;
an instance can therefore be outside the current zoom. Search navigation remains
available to select and zoom into a particular occurrence.

Clearing selection carries across views too. Different profiles/threads retain
their own selection; a newly imported group or newly created derived profile
starts fresh. Call Tree retains its independent expansion controls.

Toggling recursion flattening keeps the function key but discards node/hover and
caller/callee references from the old tree. Selection is resolved against the
new visible model. Its aggregate/derived flags are now retained as well, so
flattening does not accidentally enable Time Order for aggregate data or make a
derived view count as an original recording.

Only one resolved node per graph view and primitive selection keys are stored.
Model identities use weak keys; there is no per-function occurrence index or
additional profile copy. A first lookup can scan an entire target tree with
O(depth) traversal storage. Resolved matches and absent occurrences are reused
until the model/function changes, so hover and pan updates do not rescan the
tree. Clearing hovers now emits at most one state update rather than four.
Cross-profile search resolves directly into Sandwich instead of scanning the
outgoing graph for an unused occurrence. UI selection is not exported.

This implements [#107](https://github.com/jlfwong/speedscope/issues/107).
Targeted tests cover distinct source files, exact per-view instances, profile
isolation, empty groups, transformed models, unchanged hover updates and a
30,000-level tree. In a PLC Node smoke check, first-occurrence lookup for the
last source frame took about 7.6 ms in Time Order and 5.5 ms in the grouped tree;
the full export hash remained unchanged. These are individual measurements,
not browser responsiveness guarantees.

## Navigate the overview

The overview above Time Order and Left Heavy shows an outlined **Visible range**
for the main graph. The outline uses the theme's foreground and background
colors together, so it stays distinct from colored frames. Very narrow ranges
get a minimum visible outline width, without changing the actual viewport or
profile weights. The outline is clipped below the overview's time axis.

Hover inside the visible range for a grab cursor; drag to pan. Outside it, a
crosshair indicates that dragging selects a new horizontal range. Only the
primary mouse button starts a drag. Releasing outside the overview, the window
losing focus, pressing Escape, switching profiles/views or replacing the canvas ends
the gesture and removes its window listeners. Escape keeps the last viewport.
Hover cursor changes stay local to the overview, and an active drag restores
the prior page cursor when it ends.

Tab to **Profile overview** to use the keyboard. Left/Right pan by 10% of the
current width; Up/Down pan by 10% of the viewport height, with a minimum of one
row. Shift increases these steps to 50%. Plus/Equals halves the width around
the current center; Minus doubles it. Shift uses quarter/fourfold zoom steps.
Home restores the full horizontal range and returns to the top. Existing zoom
and viewport bounds still apply. Modified browser shortcuts such as Ctrl+F
are left available. A focus outline and accessible description expose the
current range and controls. This improves overview access without claiming
that all canvas charts are screen-reader accessible.

All overlay and keyboard calculations use only current viewport dimensions;
they do not scan call occurrences, retain another profile or build an index.
This implements [#240](https://github.com/jlfwong/speedscope/issues/240) and
[#241](https://github.com/jlfwong/speedscope/issues/241), and advances
[#376](https://github.com/jlfwong/speedscope/issues/376).

Validation on 2026-11-21 passed 362 Jest tests across 64 suites (307 snapshots),
five Node tests, type checking, linting, schema/backlog checks and both builds.
Browser checks verified keyboard zoom/pan/reset, Ctrl+F, pointer pan/range
selection, restored page cursors and the outline in light/dark themes without
console errors. A context-replacement regression ensures redraws use the new
canvas rather than scheduling a stale frame on the old one. PLC streaming
retained four profiles, 17,510 frames and 1,039,656 call events with its baseline
export hash; the Node import smoke took about 2.5 seconds. This does not measure
browser frame rate or establish a total heap cap.

## Bounded graph search

Time Order and Left Heavy search navigate at most the first 10,000 matching call
occurrences in depth-first order. If there are more, the count shows `10000+`
and a visible status asks you to refine your search. This is a lower bound,
not the full count. Previous/Next and Enter/Shift+Enter wrap within the retained
window. A selected frame outside that window shows `?` for its navigation index.
Use a more specific name/path or Whole word/Exact/Regex mode to narrow the query.

Matching and graph highlights still inspect full names and source paths, even
outside the navigation window. Sparse queries can find late occurrences: the
limit applies to retained matches, not the number of frames searched. Showing
the limit requires finding one further match, so exactly 10,000 results are
reported as complete. No widths, weights or exported symbols are changed.
Search zoom also keeps root-level result labels below the time axis, including
short charts whose general viewport clamp would otherwise cover the first row.

Symbol matching is lazy. Each query caches at most 4,096 boolean frame results
and 512 highlight lists, evicting old entries and recomputing them when needed.
Only labels/rows being drawn request name-highlight ranges, capped at the first
64 ranges per name. A long, repetitive name can therefore match beyond its
drawn underlines. File-only matches have no name underlines. Search input is
limited to 4,096 characters in literal modes; Regex has the separate 256-character and compilation limits described above.

Search no longer builds a full per-symbol highlight map or a rectangle for
every matching call. Traversal uses O(depth) auxiliary storage and creates a
navigation rectangle only when a result is opened. Rare/no-match queries can
still scan an entire graph synchronously; bounded caches can require repeated
text matching. Existing profile models, graph geometry and Sandwich row lists
still scale with recording size. Cross-profile search retains its separate
200-result limit and cancellation behavior.

## Resize Sandwich panes

Select a function in Sandwich to show the table, callers and callees. Drag the
vertical divider to resize the table against the graphs. Drag the horizontal
divider to change the callers/callees split. Graph viewports update as you resize.

Both dividers are keyboard-focusable separators. Use Left/Right on the table
divider and Up/Down on the callers/callees divider. Each press moves 2 percentage
points; hold Shift for 10. Home and End move to the permitted limits. Enter or a
double-click restores the equal split. Other application shortcuts still work.

Pane sizes are clamped to avoid hiding either side, including on small windows.
Preferences are saved in this browser's local storage on completed drags and
keyboard actions. They survive reloads and profile changes, but are not part of
the exported profile. Invalid or unavailable browser storage falls back safely.

## Navigate selected-stack ancestors

In Time Order or Left Heavy, select a graph frame to show its stack details.
Each scope name is now a keyboard-focusable button. Click it or press Enter/Space
to select that exact ancestor call instance and update its statistics/highlight.
If the ancestor is above the graph viewport, the graph scrolls up to include it;
the horizontal range stays unchanged. Source-location links remain separate.

Details show at most 100 scopes at a time, starting with the selected frame.
**Show older ancestors** advances toward the root. **Back to selected frame**
returns to the start. Selecting a scope starts a fresh page at that scope. This
keeps the number of DOM rows and source links bounded even for very deep stacks.
Paging follows only the next 100 parent pointers and retains no complete
ancestor list or page history. Selecting an ancestor walks its parent chain to
determine its graph depth, using constant auxiliary space.

The helper regression covers a 100,000-level chain and fails if a page walks
beyond its boundary. UI tests cover paging, exact-instance selection and focus
restoration. The PLC trace's deepest stack has seven scopes, so it fits on one
page without changing the imported profile.

This implements [ancestor navigation (#350)](https://github.com/jlfwong/speedscope/issues/350).

## Identify recordings and selected functions

The browser/window title shows the current file's leaf name, followed by the
internal recording name when it differs. Thread names remain unchanged in the
toolbar. A `title` hash parameter still overrides the window title. File names
are kept as runtime context through worker loading, derived profiles and symbol
remapping. They are not added to exports: opening an exported recording shows
the name of that newly opened file. Absolute local directories are discarded
from this metadata and displayed leaf names are limited to 1,024 characters.

Sandwich now shows a **Selected function details** panel above its graphs.
It displays the full symbol name and source file/line/column, so same-named
functions from different modules can be distinguished without a hover tooltip.
Configured source-code links work there too. Missing source metadata is stated
explicitly. Long names wrap inside a scrollable panel capped at 120 pixels;
only the selected function gets this panel, without adding a column or index
across the entire recording.

## Understand the statistics

Open **About these statistics** in selected-stack details for contextual help.
**This Instance** measures the selected call-tree node. In Time Order that node
represents its call context; in Left Heavy, a node can group multiple calls in
the same stack context. **All Instances** measures that function across the
current profile. **Total** includes work in callees; **Self** excludes it.
Values use the profile's units, including time, bytes or samples.

The detail-panel percentages use the entire current profile's weight, including
idle weight. Sandwich table percentages use its non-idle weight, as explained
in the column headers. Filtered profiles use their retained weight. For example,
six units of total work with four self units in a ten-unit recording display
60% total and 40% self in details, even when the other four units are idle.
Zero-weight denominators display 0% with finite bars. Percentage calculations
also avoid overflow from multiplying very large finite weights by 100 first.

These changes implement [#363](https://github.com/jlfwong/speedscope/issues/363),
[#242](https://github.com/jlfwong/speedscope/issues/242) and
[#219](https://github.com/jlfwong/speedscope/issues/219).

Validation on 2026-11-21 passed all 346 Jest tests across 60 suites (307
snapshots), five Node tests, type checking, linting, schema/backlog checks and
both builds. Browser smoke checks covered same-named functions from different
files, recording/custom titles and expanded statistics help without console
errors. A PLC streaming smoke retained four profiles, 17,510 frames and
1,039,656 call events with the baseline export hash; its import took about
2.4 seconds in that Node run. These UI changes add no per-frame context index or
profile copy. Source-name metadata is one bounded string per group.

## Refocus a search match

Graph search offers **Zoom to match** once a retained result is selected. After
zooming or panning away, use it to center that same match with a little context.
The action changes only the viewport: measured widths and profile weights stay
intact. Ordinary next/previous navigation is unchanged, and the existing 10,000
result cap and numerical zoom limits still apply. Very small matches may reach
those precision limits. Sandwich's table search does not add this graph action.

This partially addresses [#548](https://github.com/jlfwong/speedscope/issues/548);
artificially inflating tiles in an overview remains separate work.

## Share function links

Select a function in Time Order, Left Heavy or Sandwich, then choose **Profile
actions → Link to selected function…**. Review and copy the generated URL in the
dialog. When opened with the same recording, it selects the matching profile and
function in Sandwich. Local files are not uploaded or embedded: the recipient
must import the same recording after opening the link. For an HTTP recording,
the link retains its URL and Accept setting only when associated with the actual
loaded profile. Opening another local file does not reuse an old remote URL.

The link stores a versioned profile index/name/unit/total and function
name/file/line/column identity. Importer-assigned frame keys can change without
breaking it. Multiple identical source identities are rejected rather than
silently selecting another frame. Selection JSON is limited to 8,192 characters
and complete links to 65,536; existing data/file profile URLs and local paths are
not copied. Function/source names and an HTTP URL's credentials can appear in the
reviewable link. It cannot grant access to a remote recording.

Matching scans the chosen profile's frames once, without a retained frame index.
Only the first successful restoration for a link is applied; later imports do not
jump back to that selection. Navigating to another function link in the same tab,
including browser Back/Forward, restores its selection against the current
recording without reimporting it. Missing or ambiguous matches show a status
message and remain pending until the original recording is imported.
Changing the HTTP profile source or Accept setting starts a cancellable import.
A new remote link takes precedence over a pending import of another recording;
selection-only changes during import apply when that import finishes.
Derived profiles must be exported and reopened first. Symbol-remapped copies
conservatively generate links requiring local reimport.

This partially addresses [#506](https://github.com/jlfwong/speedscope/issues/506).
Exact call instances, graph view/zoom/time range and profile transformations are
not restored. Function links select the matching symbol in Sandwich, rather than
restoring a specific call occurrence or graph viewport.

## Upstream review history

The 2026-11-21 shared-selection, Java text-dump, hosted-offline and numerical
test follow-up passed all 393 Jest tests across 68 suites (307 snapshots), five
Node tests, type checking, lint, schema/backlog checks, both release builds and
npm package-content checks. Binary JFR signatures take precedence over embedded
thread-dump text; the existing unnamed-recording regression covers this case.
Browser checks covered per-view occurrence retention, same-named source frames,
recursion/derived profiles, and importing a local Java dump after stopping the
preview server. An uncached remote recording correctly failed offline.

The private PLC streaming check retained four profiles, 17,510 exported frames
and 1,039,656 call events with SHA-256
`522de77afbfc4dd94f1f30c3a9551979d12db506305ffef999db9c910ae8eddb`
(shared data followed by each exported profile, hashed separately). Its final
Node run took about four seconds to import, with first-occurrence lookup for
the last source frame taking 5.4 ms in Time Order and 4.2 ms in Left Heavy.
These are local smoke measurements, not browser performance guarantees.

On 2026-11-20, the 30 most recently created open upstream issues were checked.
Their IDs were already present in the existing 134-issue inventory. This is a
targeted feature check, not a fresh audit of every issue's open/closed state.
This follow-up implements [cross-process search (#396)](https://github.com/jlfwong/speedscope/issues/396)
and [resizable Sandwich panes (#209)](https://github.com/jlfwong/speedscope/issues/209).
