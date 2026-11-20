import {Profile, Frame, CallTreeNode} from './profile'
import {Flamechart, FlamechartFrame} from './flamechart'
import {Rect, Vec2} from './math'

export const SEARCH_LIMITS = {
  cachedFrames: 4096,
  cachedHighlights: 512,
  rangesPerName: 64,
  navigationMatches: 10_000,
}

export enum FlamechartType {
  CHRONO_FLAME_CHART,
  LEFT_HEAVY_FLAME_GRAPH,
}

export enum SearchMode {
  SUBSTRING = 'substring',
  WHOLE_WORD = 'whole-word',
  EXACT = 'exact',
}

export function createTextMatcher(pattern: string, mode: SearchMode) {
  if (mode === SearchMode.EXACT) {
    const lowerPattern = pattern.toLocaleLowerCase()
    const hasMatch = (text: string) => !!pattern && text.toLocaleLowerCase() === lowerPattern
    return {
      hasMatch,
      ranges: (text: string, limit = Infinity): [number, number][] =>
        limit > 0 && hasMatch(text) ? [[0, text.length]] : [],
    }
  }
  if (mode === SearchMode.SUBSTRING) {
    const lowerPattern = pattern.toLocaleLowerCase()
    return {
      hasMatch: (text: string) => !!pattern && text.toLocaleLowerCase().includes(lowerPattern),
      ranges: (text: string, limit = Infinity): [number, number][] => {
        if (!pattern) return []
        const lowerText = text.toLocaleLowerCase()
        const ranges: [number, number][] = []
        let start = 0,
          index: number
        while (ranges.length < limit && (index = lowerText.indexOf(lowerPattern, start)) !== -1) {
          ranges.push([index, index + pattern.length])
          start = index + pattern.length
        }
        return ranges
      },
    }
  }
  // User input is always literal. These fixed patterns have no nested
  // quantifiers or user-provided expressions that could stall large searches.
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const word = '\\p{L}\\p{N}\\p{M}_'
  const regex = new RegExp(`(?<![${word}])(${escaped})(?![${word}])`, 'giu')
  return {
    hasMatch: (text: string) => {
      regex.lastIndex = 0
      return !!pattern && regex.test(text)
    },
    ranges: (text: string, limit = Infinity): [number, number][] => {
      if (!pattern) return []
      regex.lastIndex = 0
      const ranges: [number, number][] = []
      let match: RegExpExecArray | null
      while (ranges.length < limit && (match = regex.exec(text)) !== null) {
        const length = match[1].length
        const end = match.index + match[0].length
        ranges.push([end - length, end])
      }
      return ranges
    },
  }
}

// In previous versions of speedscope, searching for strings within the profile
// was done using fuzzy finding. As it turns out, this was surprising behavior
// to most people, so we've switched to a more traditional substring search that
// more closely mimics browser behavior.
//
// This is case insensitive for both the needle & the haystack. This means
// searching for "hello" will match "Hello" and "HELLO", and searching for
// "HELLO" will match both "hello" and "Hello". This matches Chrome's behavior
// as far as I can tell.
//
// See https://github.com/jlfwong/speedscope/issues/352
//
// Return ranges for all matches in order to highlight them.
export function exactMatchStrings(
  text: string,
  pattern: string,
  mode = SearchMode.SUBSTRING,
): [number, number][] {
  return createTextMatcher(pattern, mode).ranges(text)
}

// A utility class for storing cached search results to avoid recomputation when
// the search results & profile did not change.
export class ProfileSearchResults {
  private readonly matcher: ReturnType<typeof createTextMatcher>
  constructor(
    readonly profile: Profile,
    readonly searchQuery: string,
    readonly searchMode = SearchMode.SUBSTRING,
  ) {
    this.matcher = createTextMatcher(searchQuery, searchMode)
  }

  private matches = new Map<Frame, [number, number][] | null>()
  private frameMatches = new Map<Frame, boolean>()

  private cache<K, V>(map: Map<K, V>, key: K, value: V, limit: number) {
    if (map.size === limit) map.delete(map.keys().next().value!)
    map.set(key, value)
  }

  hasMatchForFrame(frame: Frame): boolean {
    const cached = this.frameMatches.get(frame)
    if (cached !== undefined) return cached
    const match =
      this.matcher.hasMatch(frame.name) || (frame.file != null && this.matcher.hasMatch(frame.file))
    this.cache(this.frameMatches, frame, match, SEARCH_LIMITS.cachedFrames)
    return match
  }

  getMatchForFrame(frame: Frame): [number, number][] | null {
    if (this.matches.has(frame)) return this.matches.get(frame)!
    // Compute ranges only for labels/rows being drawn, not every source symbol.
    // A file-only match has an empty, truthy range list because offsets refer
    // exclusively to frame.name. Eviction never changes matching semantics.
    const ranges = this.hasMatchForFrame(frame)
      ? this.matcher.ranges(frame.name, SEARCH_LIMITS.rangesPerName)
      : null
    this.cache(this.matches, frame, ranges, SEARCH_LIMITS.cachedHighlights)
    return ranges
  }
}

export interface FlamechartSearchMatch {
  configSpaceBounds: Rect
  node: CallTreeNode
}

export function searchMatchViewport(
  flamechart: Flamechart,
  match: FlamechartSearchMatch,
  current: Rect,
): Rect {
  const bounds = match.configSpaceBounds
  const viewport = flamechart.getClampedConfigSpaceViewportRect({
    configSpaceViewportRect: new Rect(
      bounds.origin.minus(new Vec2(0, 1)),
      bounds.size.withY(current.height()),
    ),
  })
  // The general clamp puts short charts at y=0. These search views have a time
  // axis over that row, so leave space for it when selecting a root call.
  return bounds.origin.y === 0 && viewport.origin.y === 0
    ? viewport.withOrigin(viewport.origin.withY(-1))
    : viewport
}

interface CachedFlamechartResult {
  matches: {frame: FlamechartFrame; depth: number}[]
  indexForNode: Map<CallTreeNode, number>
  truncated: boolean
}

export class FlamechartSearchResults {
  constructor(
    readonly flamechart: Flamechart,
    readonly profileResults: ProfileSearchResults,
  ) {}

  private matches: CachedFlamechartResult | null = null
  private getResults(): CachedFlamechartResult {
    if (this.matches == null) {
      const matches: CachedFlamechartResult['matches'] = []
      const indexForNode = new Map<CallTreeNode, number>()
      let truncated = false
      const layers = this.flamechart.getLayers()
      // Preserve depth-first navigation order with O(depth) traversal storage.
      // Stop after proving there is a further match; don't count the rest or
      // construct geometry for every matching occurrence in a broad search.
      const pending = layers.length ? [{nodes: layers[0], index: 0, depth: 0}] : []
      while (pending.length) {
        const current = pending[pending.length - 1]
        if (current.index === current.nodes.length) {
          pending.pop()
          continue
        }
        const frame = current.nodes[current.index++]
        if (this.profileResults.hasMatchForFrame(frame.node.frame)) {
          if (matches.length === SEARCH_LIMITS.navigationMatches) {
            truncated = true
            break
          }
          indexForNode.set(frame.node, matches.length)
          matches.push({frame, depth: current.depth})
        }
        if (frame.children.length)
          pending.push({nodes: frame.children, index: 0, depth: current.depth + 1})
      }
      this.matches = {matches, indexForNode, truncated}
    }
    return this.matches
  }

  count(): number {
    return this.getResults().matches.length
  }

  isTruncated(): boolean {
    return this.getResults().truncated
  }

  indexOf(node: CallTreeNode): number | null {
    const result = this.getResults().indexForNode.get(node)
    return result === undefined ? null : result
  }

  at(index: number): FlamechartSearchMatch {
    const matches = this.getResults().matches
    if (!Number.isInteger(index) || index < 0 || index >= matches.length) {
      throw new Error(`Index ${index} out of bounds in list of ${matches.length} matches.`)
    }
    const {frame, depth} = matches[index]
    return {
      node: frame.node,
      configSpaceBounds: new Rect(
        new Vec2(frame.start, depth),
        new Vec2(frame.end - frame.start, 1),
      ),
    }
  }
}
