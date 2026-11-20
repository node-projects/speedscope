# Search across profiles and arrange Sandwich panes

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

## Bounded graph search

Time Order and Left Heavy search navigate at most the first 10,000 matching call
occurrences in depth-first order. If there are more, the count shows `10000+`
and a visible status asks you to refine your search. This is a lower bound,
not the full count. Previous/Next and Enter/Shift+Enter wrap within the retained
window. A selected frame outside that window shows `?` for its navigation index.
Use a more specific name/path or Whole word/Exact mode to narrow the query.

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
limited to 4,096 characters. These are literal modes, not arbitrary regexes.

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

## Upstream review

On 2026-11-20, the 30 most recently created open upstream issues were checked.
Their IDs were already present in the existing 134-issue inventory. This is a
targeted feature check, not a fresh audit of every issue's open/closed state.
This follow-up implements [cross-process search (#396)](https://github.com/jlfwong/speedscope/issues/396)
and [resizable Sandwich panes (#209)](https://github.com/jlfwong/speedscope/issues/209).
