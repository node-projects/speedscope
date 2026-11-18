# Filter frames

Choose **Profile actions → Filter frames…** to create an aggregate view of your
code or hide framework frames. The original recording stays in the profile
selector. Select it to return to the complete profile. Filtering applies to the
active profile, and you can apply another filter to a derived profile.

Choose source file path, function name, or either. Enter one case-insensitive
literal substring per line. Slashes are interchangeable, so `src/app/` also
matches Windows paths. Multiple include rules are alternatives (OR); any exclude
match removes the frame, even if an include rule matches it. Leave include blank
to retain all frames except exclusions. Empty lines are ignored. File rules do
not match frames without a source path; use function names for those profiles.
Names match the displayed frame name, including any arguments that a trace
importer incorporates into it. There are no regular expressions or glob rules.

For example, include `src/` and exclude `node_modules/`. Or leave include empty
and exclude `vendor/` to remove framework frames while keeping unmapped code.
Up to 128 non-empty rules and 4,096 combined rule characters are accepted.

## What the weights mean

This hides individual frames and joins their remaining ancestors/callees. It
does not discard an entire stack merely because it contains a hidden frame.
Each remaining stack retains its original weight. If a removed leaf has a kept
ancestor, its weight becomes self weight on the nearest kept ancestor. If no
frame remains in a stack, that stack's weight is omitted. Idle/empty-stack weight
is also omitted. Total/self values and percentages are recomputed from retained
stacks; they are not percentages of the unfiltered recording.

Suppose an 8 MiB allocation profile contains:

| Stack | Weight |
| --- | ---: |
| framework → render | 2 MiB |
| framework → render → vendorWork | 2 MiB |
| framework → helper | 2 MiB |
| framework | 2 MiB |

Including `src/` keeps render and helper, producing 6 MiB total. Render has
4 MiB total and self: the hidden vendorWork leaf contributes to render's self
weight. Also excluding helper's file produces a 4 MiB profile containing render
alone. The original 8 MiB profile remains available.

## Derived profile behavior

Filtered profiles are explicitly aggregate and derived. Time Order is disabled;
use Left Heavy, Sandwich or Call Tree. Existing Call Tree mode is preserved when
applying a filter. Filter rules are appended to the profile name, retaining a
visible history through further transformations and export/reimport. Exports
include both the original and filtered profiles, their units and aggregate flags.
“Combine original profiles” excludes derived profiles to avoid double counting.

No remaining frames is reported as an error without appending an empty profile.
Cancel or Escape discards unfinished work. Pasting rules stays inside the dialog
and does not invoke clipboard-profile import. Replacing the source recording
aborts/discards the pending result.

The implementation visits grouped call paths instead of every original trace
event, caches each frame's rule match, and yields between bounded batches of
traversal/stack work. Traversal and cancellation support a 20,000-frame deep-stack
regression without recursion. Final tree sorting remains synchronous, and the
original and derived models both occupy memory; this is not an out-of-core filter.
A local PLC smoke check filtered the selected profile from 16,231 frames to 40
in about 0.7 seconds, yielding 45 times. That is a single Node measurement, not a
general browser latency guarantee.

## Memory-profile axes

Byte profiles now use power-of-two tick intervals in the main graph and minimap:
for example 512 KiB steps or whole MiB steps, rendered with the app's existing
KB/MB/GB labels. Other units retain decimal 1/2/5 spacing. Both axes adapt label
precision to zoom and skip overlapping labels.
