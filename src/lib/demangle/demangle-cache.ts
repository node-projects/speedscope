export const DEMANGLE_CACHE_LIMITS = Object.freeze({
  entries: 4096,
  characters: 1048576,
  pairCharacters: 16384,
})

interface CachedSymbol {
  result: string
  failed: boolean
}

// One owner per implementation: neither success nor failure results can cross
// implementation boundaries. No exception objects or observers are retained.
export class CachedDemangler {
  private cache = new Map<string, CachedSymbol>()
  private characters = 0

  constructor(private readonly implementation: (name: string) => string) {}

  get size(): number {
    return this.cache.size
  }

  get characterCount(): number {
    return this.characters
  }

  demangle(name: string, onFailure?: (name: string) => void): string {
    let entry = this.cache.get(name)
    if (entry !== undefined) {
      this.cache.delete(name)
      this.cache.set(name, entry)
    } else {
      let result = name,
        failed = false
      try {
        result = this.implementation(name) || name
      } catch {
        // Decoding is optional. Retain only the original string and a flag,
        // rather than an exception (which may retain a large input/context).
        failed = true
      }
      entry = {result, failed}
      const characters = name.length + result.length
      if (characters <= DEMANGLE_CACHE_LIMITS.pairCharacters) {
        while (
          this.cache.size >= DEMANGLE_CACHE_LIMITS.entries ||
          this.characters + characters > DEMANGLE_CACHE_LIMITS.characters
        ) {
          const oldest = this.cache.keys().next().value as string
          const previous = this.cache.get(oldest)!
          this.characters -= oldest.length + previous.result.length
          this.cache.delete(oldest)
        }
        this.cache.set(name, entry)
        this.characters += characters
      }
    }
    // Observe failures for this caller even on cache hits, without storing its
    // callback in the shared cache or conflating observations with exceptions.
    if (entry.failed) onFailure?.(name)
    return entry.result
  }
}
