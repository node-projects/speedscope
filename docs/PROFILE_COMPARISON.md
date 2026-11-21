# Compare profiles

Open a recording, then choose **Profile actions → Compare profiles…**. Select a
baseline and candidate from the loaded profiles, or use **Open comparison
recording…** to load a second local recording in any supported format. Choose
its profile and click **Compare**. The application recording is not replaced.
Both recordings remain in memory until the dialog closes. Replacing the main
recording closes the comparison and cancels pending work.

Profile choices have name filters and pages of 100 options. The current selection
is retained even when outside the filtered page. After comparison the settings
collapse; reopen **Profiles and scaling** to change the inputs or mode.

## Signed values and matching

Differences are always **candidate minus baseline**. Positive/red means an
increase, negative/blue a decrease, and neutral means unchanged. Total includes
callees; self excludes them. The root's self weight represents idle/unattributed
recording weight. These measurements compare the selected inputs; they do not
identify the cause of a change or establish statistical significance.

Functions match by exact name, file, line and column under the same caller path,
independently of importer-assigned frame IDs. Recursion and different callers
remain distinct. Equal source identities under one caller merge. Renamed/moved
code or different symbolication can appear as removed/added paths; there is no
fuzzy alignment or cross-build symbol matching.

**Absolute weights** requires identical units and does not rescale recording
duration or event rate. **Share of each profile total** divides each side by its
own full total, including idle weight; differences are percentage points. A
zero-total profile contributes zero. Different-unit normalized comparisons show
composition only, not absolute performance. Raw side totals and units remain
visible so that this distinction can be checked.

## Graph, table and navigation

The differential flamegraph uses an additive union envelope for widths:
`max(baseline self, candidate self) + sum(child envelopes)`. It preserves room
for added and removed paths and may exceed either recording's total. Widths are
comparison layout weights, not an execution-time axis. Color uses signed total
differences; tooltip/selection details show both total and self changes.

Click or keyboard-focus a tile to select it. Double-click, or use **Zoom to
selected**, to inspect that subtree. **Parent call path**, ancestor buttons and
**All stacks** navigate back. Ancestor controls retain at most 16 entries;
**All stacks** remains available for deep paths.

The accessible table displays 100 call paths per page. Search matches full names
and source files case-insensitively, returning the first 100 matches with an
explicit limit notice. Selecting a table result focuses its parent so the path
can be inspected in the graph. Search does not require rendering the full graph.

## Resource policy and limits

Comparison is a cancellable walk of the grouped trees. It does not retain a
per-sample stack array or construct full path strings for every node. The result
still consumes memory proportional to the union; this is not an out-of-core
comparison engine. Temporary merge indexes are discarded after preparation.

| Resource | Maximum |
| --- | ---: |
| Union nodes | 500,000 |
| Input node visits | 2,000,000 |
| Unique serialized source identity characters | 8 Mi |
| Name plus file characters per source identity | 65,536 |
| Graph layout tiles | 5,000 |
| Graph traversal visits | 20,000 |
| Graph levels relative to the focused node | 128 |

Exceeding a model budget fails explicitly; compare cropped/filtered recordings
instead. Nonfinite source weights or overflowing union weights also fail.
Graph detail/depth limits and hidden subpixel paths are indicated. The graph
mounts only visible rows. Search/table selection and subtree zoom provide access
to paths beyond the initial graph limits. No weights are silently truncated.

PLC self-comparison prepared 160,613 union nodes with zero differences and about
47.45 MiB retained model heap in one Node 24 ARM64 check. Preparation plus the
post-comparison GC took 683 ms. This excludes browser import/rendering and is not
a memory guarantee for another capture. The original PLC export hash was unchanged.

Comparison is transient. Closing the dialog releases the external candidate and
comparison state; reopening starts a new comparison. Existing Export still saves
the main recording. Signed differential input formats (including negative Go
heap delta samples and folded differential files), comparison-file export,
synchronized timelines and statistical comparison remain separate features.
