// Fixed-height rows need no per-row geometry objects or prefix-size index.
export function fixedSizeListRange(
  count: number,
  itemSize: number,
  viewportSize: number,
  scrollOffset: number,
) {
  const totalSize = count * itemSize
  const offset = Math.max(0, Math.min(scrollOffset, Math.max(0, totalSize - viewportSize)))
  const firstVisibleIndex = Math.min(
    count,
    Math.max(0, Math.floor((offset - viewportSize / 4) / itemSize)),
  )
  const lastVisibleIndex = Math.min(
    count - 1,
    Math.ceil((offset + viewportSize * 1.25) / itemSize) - 1,
  )
  return {firstVisibleIndex, lastVisibleIndex, invisiblePrefixSize: firstVisibleIndex * itemSize}
}

// Selection, hover and viewport updates usually ask for the same row. Search
// next/previous asks for neighboring rows. Keep those lookups constant-time
// without retaining an index entry for every frame in the recording.
export function createRowIndexLookup<T>(rows: readonly T[]): (row: T) => number | null {
  let previousRow: T
  let previousIndex = -1
  let initialized = false
  return row => {
    if (initialized && row === previousRow) return previousIndex < 0 ? null : previousIndex
    let index = -1
    if (previousIndex >= 0 && rows.length) {
      const next = (previousIndex + 1) % rows.length
      const previous = (previousIndex + rows.length - 1) % rows.length
      if (rows[next] === row) index = next
      else if (rows[previous] === row) index = previous
    }
    if (index < 0) index = rows.indexOf(row)
    previousRow = row
    previousIndex = index
    initialized = true
    return index < 0 ? null : index
  }
}
