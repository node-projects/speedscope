type DiagnosticKind = 'empty-stack' | 'name-mismatch' | 'argument-mismatch' | 'open-at-eof'

export const TRACE_EVENT_DIAGNOSTIC_EXAMPLES_PER_KIND = 2
export const TRACE_EVENT_DIAGNOSTIC_KEY_LENGTH = 512
const MESSAGE_LENGTH = 2048

function truncate(value: string, length: number): string {
  return value.length > length ? value.slice(0, length - 1) + '…' : value
}

export function diagnosticFrameKey(key: string | number): string {
  // Clip before escaping so even a very large frame key has bounded formatting
  // work. Keep examples on one console line, including names containing newlines.
  const snippet = truncate(String(key), TRACE_EVENT_DIAGNOSTIC_KEY_LENGTH).replace(
    /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g,
    char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'),
  )
  return truncate(snippet, TRACE_EVENT_DIAGNOSTIC_KEY_LENGTH)
}

// One instance per imported recording, shared by all its threads. Keep only
// counters: no raw events, formatted examples or formatter closures survive warn.
export class TraceEventDiagnostics {
  private counts: Record<DiagnosticKind, number> = {
    'empty-stack': 0,
    'name-mismatch': 0,
    'argument-mismatch': 0,
    'open-at-eof': 0,
  }
  private flushed = false

  warn(kind: DiagnosticKind, format: () => string): void {
    if (this.flushed) return
    this.counts[kind]++
    if (this.counts[kind] <= TRACE_EVENT_DIAGNOSTIC_EXAMPLES_PER_KIND) {
      console.warn(truncate(`[Trace Event: ${kind}] ${format()}`, MESSAGE_LENGTH))
    }
  }

  flush(): void {
    if (this.flushed) return
    this.flushed = true
    const kinds = Object.keys(this.counts) as DiagnosticKind[]
    if (!kinds.some(kind => this.counts[kind] > 0)) return
    const suppressed = kinds.reduce(
      (total, kind) =>
        total + Math.max(0, this.counts[kind] - TRACE_EVENT_DIAGNOSTIC_EXAMPLES_PER_KIND),
      0,
    )
    console.warn(
      `Trace Event import diagnostics: ${kinds
        .map(kind => `${kind}=${this.counts[kind]}`)
        .join(', ')}. ${suppressed} additional examples suppressed.`,
    )
  }
}
