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

## Upstream review

On 2026-11-20, the 30 most recently created open upstream issues were checked.
Their IDs were already present in the existing 134-issue inventory. This is a
targeted feature check, not a fresh audit of every issue's open/closed state.
This follow-up implements [cross-process search (#396)](https://github.com/jlfwong/speedscope/issues/396)
and [resizable Sandwich panes (#209)](https://github.com/jlfwong/speedscope/issues/209).
