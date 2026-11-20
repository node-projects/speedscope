export function frameLabel(name: string, compact: boolean): {text: string; offset: number} {
  if (!compact) return {text: name, offset: 0}
  const rooted = /^(?:[a-z]+:\/\/|[a-z]:[\\/]|[\\/]|\.\.?[\\/])/i.test(name)
  if (!rooted && (/[\s()<>{}]/.test(name) || name.includes('::'))) return {text: name, offset: 0}
  // URL query/fragment values can themselves contain slashes. Keep them intact.
  const suffix = /^[a-z]+:\/\//i.test(name) ? name.search(/[?#]/) : -1
  const end = suffix < 0 ? name.length : suffix
  const offset = Math.max(name.lastIndexOf('/', end - 1), name.lastIndexOf('\\', end - 1)) + 1
  return offset > 0 && offset < end ? {text: name.slice(offset), offset} : {text: name, offset: 0}
}
export function labelMatchRanges(
  ranges: [number, number][],
  label: {text: string; offset: number},
): [number, number][] {
  if (label.offset === 0) return ranges
  const result: [number, number][] = []
  for (const [start, end] of ranges) {
    const left = Math.max(0, start - label.offset),
      right = Math.min(label.text.length, end - label.offset)
    if (right > left) result.push([left, right])
  }
  return result
}
