// The source belongs to the currently opened file, not the exported recording.
// Keep only a leaf name; do not retain an absolute local path in UI metadata.
export function sourceFileName(path: string): string {
  const end = path.replace(/\\/g, '/').replace(/\/+$/, '')
  return end
    .slice(end.lastIndexOf('/') + 1)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .slice(0, 1024)
}

export function profileWindowTitle(
  group: {name: string; sourceName?: string},
  customTitle?: string,
) {
  if (customTitle) return `${customTitle} - speedscope`
  const source = group.sourceName
  return `${
    source
      ? source + (group.name && group.name !== source ? ` — ${group.name}` : '')
      : group.name || 'profile'
  } - speedscope`
}

export function weightPercentage(weight: number, total: number): number {
  const percent = total > 0 ? (weight / total) * 100 : 0
  return Number.isFinite(percent) ? percent : 0
}
