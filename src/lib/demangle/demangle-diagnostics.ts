const EXAMPLES = 2
const NAME_LENGTH = 512

export class DemangleDiagnostics {
  private count = 0
  private flushed = false

  warn(name: string): void {
    if (this.flushed) return
    this.count++
    if (this.count > EXAMPLES) return
    // Slice before escaping: formatting work and output stay bounded even for
    // unusually large or multiline symbols. Do not retain native Error objects.
    const clipped = name.length > NAME_LENGTH ? name.slice(0, NAME_LENGTH - 1) + '…' : name
    const snippet = clipped.replace(
      /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g,
      char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'),
    )
    console.warn(
      'Could not demangle symbol; preserving its original name: ' +
        (snippet.length > NAME_LENGTH ? snippet.slice(0, NAME_LENGTH - 1) + '…' : snippet),
    )
  }

  flush(): void {
    if (this.flushed) return
    this.flushed = true
    if (!this.count) return
    console.warn(
      `Demangling preserved ${
        this.count
      } symbol observations after native or cached decoding failures; ${Math.max(
        0,
        this.count - EXAMPLES,
      )} additional examples suppressed.`,
    )
  }
}
