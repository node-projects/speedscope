import {
  ProfileSearchResults,
  FlamechartSearchResults,
  SEARCH_LIMITS,
  SearchMode,
} from './profile-search'
import {Frame, Profile, CallTreeNode} from './profile'
import {Flamechart, FlamechartFrame} from './flamechart'
import {searchMatchViewport} from './profile-search'
import {Rect, Vec2} from './math'

test('search zoom keeps a root call below the time axis while preserving horizontal bounds', () => {
  const flamechart = new Flamechart({
    getTotalWeight: () => 10,
    formatValue: String,
    forEachCall: () => {},
    getColorBucketForFrame: () => 0,
  })
  const root = frame('work', 5)
  const match = {node: root.node, configSpaceBounds: new Rect(new Vec2(5, 0), new Vec2(1, 1))}
  const viewport = searchMatchViewport(
    flamechart,
    match,
    new Rect(new Vec2(0, 0), new Vec2(10, 30)),
  )
  expect(viewport.origin.y).toBe(-1)
  expect(viewport.origin.x).toBe(5)
  expect(viewport.size.y).toBe(30)
  expect(viewport.size.x).toBeGreaterThanOrEqual(1)
})

const profile = {
  forEachFrame: () => {
    throw new Error('Search must not enumerate symbols eagerly')
  },
} as unknown as Profile
function symbol(name: string, file?: string) {
  return {name, file} as Frame
}
function frame(name: string, start = 0, children: FlamechartFrame[] = []): FlamechartFrame {
  return {node: new CallTreeNode(symbol(name), null), start, end: start + 1, parent: null, children}
}
const chart = (roots: FlamechartFrame[]) => ({getLayers: () => [roots]}) as unknown as Flamechart

test('matching and highlight caches remain bounded after many symbols and eviction', () => {
  const results = new ProfileSearchResults(profile, 'work')
  const first = symbol('work')
  expect(results.getMatchForFrame(first)).toEqual([[0, 4]])
  for (let i = 0; i < SEARCH_LIMITS.cachedFrames * 2; i++) {
    const current = symbol(i % 2 ? 'other' : 'work')
    expect(results.hasMatchForFrame(current)).toBe(i % 2 === 0)
    results.getMatchForFrame(current)
  }
  expect((results as any).frameMatches.size).toBeLessThanOrEqual(SEARCH_LIMITS.cachedFrames)
  expect((results as any).matches.size).toBeLessThanOrEqual(SEARCH_LIMITS.cachedHighlights)
  expect(results.getMatchForFrame(first)).toEqual([[0, 4]])
  const pathOnly = symbol('other', 'src/work.ts')
  expect(results.hasMatchForFrame(pathOnly)).toBe(true)
  expect(results.getMatchForFrame(pathOnly)).toEqual([])
})

test('drawing a dense symbol caps ranges without changing full-name matching', () => {
  for (const mode of [SearchMode.SUBSTRING, SearchMode.WHOLE_WORD]) {
    const results = new ProfileSearchResults(profile, 'a', mode)
    const current = symbol('a '.repeat(10000))
    expect(results.getMatchForFrame(current)!.length).toBe(SEARCH_LIMITS.rangesPerName)
    expect(results.hasMatchForFrame(current)).toBe(true)
  }
})

test('broad graph search caps navigation and stops after proving one extra match', () => {
  const roots = Array.from({length: SEARCH_LIMITS.navigationMatches + 2}, (_, i) =>
    frame('work', i),
  )
  Object.defineProperty(roots[SEARCH_LIMITS.navigationMatches + 1], 'node', {
    get: () => {
      throw new Error('Traversed beyond truncation proof')
    },
  })
  const results = new FlamechartSearchResults(
    chart(roots),
    new ProfileSearchResults(profile, 'work'),
  )
  expect(results.count()).toBe(SEARCH_LIMITS.navigationMatches)
  expect(results.isTruncated()).toBe(true)
  expect(results.at(0).node).toBe(roots[0].node)
  expect(results.at(9999).configSpaceBounds.origin.x).toBe(9999)
  expect(results.indexOf(roots[3].node)).toBe(3)
  expect(results.indexOf(roots[10000].node)).toBe(null)
  expect(() => results.at(10000)).toThrow('out of bounds')
  // Highlighting continues to work outside the retained navigation window.
  expect(results.profileResults.hasMatchForFrame(roots[10000].node.frame)).toBe(true)
})

test('exactly the navigation limit is complete and rare late matches are not omitted', () => {
  const roots = Array.from({length: 15000}, (_, i) => frame(i < 10000 ? 'work' : 'other', i))
  const exact = new FlamechartSearchResults(chart(roots), new ProfileSearchResults(profile, 'work'))
  expect(exact.count()).toBe(10000)
  expect(exact.isTruncated()).toBe(false)
  roots[14999].node.frame.name = 'late'
  const late = new FlamechartSearchResults(chart(roots), new ProfileSearchResults(profile, 'late'))
  expect(late.count()).toBe(1)
  expect(late.at(0).node).toBe(roots[14999].node)
  expect(late.isTruncated()).toBe(false)
})

test('navigation preserves depth-first order and constructs requested bounds', () => {
  const grandchild = frame('work', 2)
  const child = frame('work', 1, [grandchild])
  const root = frame('work', 0, [child, frame('work', 3)])
  const results = new FlamechartSearchResults(
    chart([root]),
    new ProfileSearchResults(profile, 'work'),
  )
  expect(results.count()).toBe(4)
  expect([0, 1, 2, 3].map(i => results.at(i).configSpaceBounds.origin.y)).toEqual([0, 1, 2, 1])
  expect([0, 1, 2, 3].map(i => results.at(i).configSpaceBounds.origin.x)).toEqual([0, 1, 2, 3])
})

test('very deep graphs search iteratively without a JavaScript recursion limit', () => {
  let root = frame('target')
  for (let i = 0; i < 25000; i++) root = frame('other', 0, [root])
  const results = new FlamechartSearchResults(
    chart([root]),
    new ProfileSearchResults(profile, 'target'),
  )
  expect(results.count()).toBe(1)
  expect(results.at(0).configSpaceBounds.origin.y).toBe(25000)
})
