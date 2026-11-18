import {Profile, Frame, CallTreeNode} from './profile'
import {Flamechart, FlamechartFrame} from './flamechart'
import {Rect, Vec2} from './math'
import {visitTree} from './utils'

export enum FlamechartType {
  CHRONO_FLAME_CHART,
  LEFT_HEAVY_FLAME_GRAPH,
}

export enum SearchMode {
  SUBSTRING = 'substring',
  WHOLE_WORD = 'whole-word',
  EXACT = 'exact',
}

function createTextMatcher(pattern: string, mode: SearchMode) {
  if (mode === SearchMode.EXACT) {
    const lowerPattern = pattern.toLocaleLowerCase()
    const hasMatch = (text: string) => !!pattern && text.toLocaleLowerCase() === lowerPattern
    return {
      hasMatch,
      ranges: (text: string): [number, number][] => (hasMatch(text) ? [[0, text.length]] : []),
    }
  }
  if (mode === SearchMode.SUBSTRING) {
    const lowerPattern = pattern.toLocaleLowerCase()
    return {
      hasMatch: (text: string) => !!pattern && text.toLocaleLowerCase().includes(lowerPattern),
      ranges: (text: string): [number, number][] => {
        if (!pattern) return []
        const lowerText = text.toLocaleLowerCase()
        const ranges: [number, number][] = []
        let start = 0,
          index: number
        while ((index = lowerText.indexOf(lowerPattern, start)) !== -1) {
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
    ranges: (text: string): [number, number][] => {
      if (!pattern) return []
      regex.lastIndex = 0
      const ranges: [number, number][] = []
      let match: RegExpExecArray | null
      while ((match = regex.exec(text)) !== null) {
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

  private matches: Map<Frame, [number, number][] | null> | null = null
  getMatchForFrame(frame: Frame): [number, number][] | null {
    if (!this.matches) {
      this.matches = new Map()
      this.profile.forEachFrame(frame => {
        const match = this.matcher.ranges(frame.name)
        if (match.length > 0) {
          this.matches!.set(frame, match)
        } else if (frame.file != null && this.matcher.hasMatch(frame.file)) {
          // The frame matched by file only. Highlight ranges always index into
          // frame.name, so there's nothing to highlight, but an empty (truthy)
          // array still marks the frame as matched.
          this.matches!.set(frame, [])
        } else {
          this.matches!.set(frame, null)
        }
      })
    }
    return this.matches.get(frame) || null
  }
}

export interface FlamechartSearchMatch {
  configSpaceBounds: Rect
  node: CallTreeNode
}

interface CachedFlamechartResult {
  matches: FlamechartSearchMatch[]
  indexForNode: Map<CallTreeNode, number>
}

export class FlamechartSearchResults {
  constructor(
    readonly flamechart: Flamechart,
    readonly profileResults: ProfileSearchResults,
  ) {}

  private matches: CachedFlamechartResult | null = null
  private getResults(): CachedFlamechartResult {
    if (this.matches == null) {
      const matches: FlamechartSearchMatch[] = []
      const indexForNode = new Map<CallTreeNode, number>()
      const visit = (frame: FlamechartFrame, depth: number) => {
        const {node} = frame
        if (this.profileResults.getMatchForFrame(node.frame)) {
          const configSpaceBounds = new Rect(
            new Vec2(frame.start, depth),
            new Vec2(frame.end - frame.start, 1),
          )
          indexForNode.set(node, matches.length)
          matches.push({configSpaceBounds, node})
        }
      }

      const layers = this.flamechart.getLayers()
      if (layers.length > 0) {
        visitTree(layers[0], visit)
      }

      this.matches = {matches, indexForNode}
    }
    return this.matches
  }

  count(): number {
    return this.getResults().matches.length
  }

  indexOf(node: CallTreeNode): number | null {
    const result = this.getResults().indexForNode.get(node)
    return result === undefined ? null : result
  }

  at(index: number): FlamechartSearchMatch {
    const matches = this.getResults().matches
    if (index < 0 || index >= matches.length) {
      throw new Error(`Index ${index} out of bounds in list of ${matches.length} matches.`)
    }
    return matches[index]
  }
}
