import {profileGroupAtom, viewModeAtom, flattenRecursionAtom} from '.'
import {FlamechartID, ProfileGroupAtom} from './profile-group'
import {StackListProfileBuilder} from '../lib/profile'
import {ViewMode} from '../lib/view-mode'
import {getProfileToView} from './getters'
import {nodeBelongsToTree} from '../lib/frame-selection'
import {Rect, Vec2} from '../lib/math'

afterEach(() => {
  profileGroupAtom.set(null)
  flattenRecursionAtom.set(false)
  viewModeAtom.set(ViewMode.CHRONO_FLAME_CHART)
})
function make() {
  const builder = new StackListProfileBuilder()
  const a = {key: 'a', name: 'a'},
    b = {key: 'b', name: 'b'},
    work = {key: 0, name: 'execute_child', file: 'first.py'},
    other = {key: 1, name: 'execute_child', file: 'second.py'}
  builder.appendSampleWithWeight([a, work], 2)
  builder.appendSampleWithWeight([b, work], 3)
  builder.appendSampleWithWeight([a, other], 4)
  const profile = builder.build()
  profileGroupAtom.setProfileGroup({name: 'group', indexToView: 0, profiles: [profile]})
  return profile
}
test('function selection crosses views while preserving each valid call instance and viewport', () => {
  const profile = make()
  const chrono = profile.getAppendOrderCalltreeRoot().children[1].children[0]
  profileGroupAtom.setSelectedNode(FlamechartID.CHRONO, chrono)
  const viewport = new Rect(new Vec2(2, -1), new Vec2(3, 10))
  profileGroupAtom.setConfigSpaceViewportRect(FlamechartID.CHRONO, viewport)
  viewModeAtom.set(ViewMode.LEFT_HEAVY_FLAME_GRAPH)
  let active = profileGroupAtom.getActiveProfile()!
  expect(active.leftHeavyViewState.selectedNode!.frame).toBe(profile.getFrame(0))
  expect(
    nodeBelongsToTree(active.leftHeavyViewState.selectedNode!, profile.getGroupedCalltreeRoot()),
  ).toBe(true)
  const left = profile.getGroupedCalltreeRoot().children.find(n => n.frame.key === 'b')!.children[0]
  profileGroupAtom.setSelectedNode(FlamechartID.LEFT_HEAVY, left)
  viewModeAtom.set(ViewMode.SANDWICH_VIEW)
  expect(profileGroupAtom.getActiveProfile()!.sandwichViewState.callerCallee!.selectedFrame).toBe(
    profile.getFrame(0),
  )
  viewModeAtom.set(ViewMode.CHRONO_FLAME_CHART)
  active = profileGroupAtom.getActiveProfile()!
  expect(active.chronoViewState.selectedNode).toBe(chrono)
  expect(active.chronoViewState.configSpaceViewportRect).toBe(viewport)
  viewModeAtom.set(ViewMode.LEFT_HEAVY_FLAME_GRAPH)
  expect(profileGroupAtom.getActiveProfile()!.leftHeavyViewState.selectedNode).toBe(left)
})
test('same names in different files remain distinct and clearing a selection crosses views', () => {
  const profile = make()
  viewModeAtom.set(ViewMode.SANDWICH_VIEW)
  profileGroupAtom.setSelectedFrame(profile.getFrame(1)!)
  viewModeAtom.set(ViewMode.CHRONO_FLAME_CHART)
  expect(profileGroupAtom.getActiveProfile()!.chronoViewState.selectedNode!.frame.file).toBe(
    'second.py',
  )
  profileGroupAtom.setSelectedNode(FlamechartID.CHRONO, null)
  viewModeAtom.set(ViewMode.SANDWICH_VIEW)
  expect(profileGroupAtom.getActiveProfile()!.sandwichViewState.callerCallee).toBe(null)
  viewModeAtom.set(ViewMode.LEFT_HEAVY_FLAME_GRAPH)
  expect(profileGroupAtom.getActiveProfile()!.leftHeavyViewState.selectedNode).toBe(null)
})
test('recursion flattening preserves the function but discards nodes from the previous tree', () => {
  const builder = new StackListProfileBuilder()
  builder.appendSampleWithWeight(
    [
      {key: 0, name: 'recursive'},
      {key: 0, name: 'recursive'},
      {key: 1, name: 'child'},
    ],
    3,
  )
  const profile = builder.build()
  profileGroupAtom.setProfileGroup({name: 'recursive', indexToView: 0, profiles: [profile]})
  const inner = profile.getAppendOrderCalltreeRoot().children[0].children[0]
  profileGroupAtom.setSelectedNode(FlamechartID.CHRONO, inner)
  flattenRecursionAtom.set(true)
  const visible = getProfileToView({profile, flattenRecursion: true})
  const selected = profileGroupAtom.getActiveProfile()!.chronoViewState.selectedNode!
  expect(selected).not.toBe(inner)
  expect(selected.frame.key).toBe(0)
  expect(nodeBelongsToTree(selected, visible.getAppendOrderCalltreeRoot())).toBe(true)
  viewModeAtom.set(ViewMode.SANDWICH_VIEW)
  expect(profileGroupAtom.getActiveProfile()!.sandwichViewState.callerCallee!.selectedFrame).toBe(
    visible.getFrame(0),
  )
  flattenRecursionAtom.set(false)
  viewModeAtom.set(ViewMode.CHRONO_FLAME_CHART)
  expect(profileGroupAtom.getActiveProfile()!.chronoViewState.selectedNode).toBe(
    profile.getAppendOrderCalltreeRoot().children[0],
  )
})
test('profile switches and replacement do not transfer keys between unrelated recordings', () => {
  const first = make(),
    builder = new StackListProfileBuilder()
  builder.appendSampleWithWeight([{key: 0, name: 'different function'}], 1)
  const second = builder.build()
  profileGroupAtom.setProfileGroup({name: 'two', indexToView: 0, profiles: [first, second]})
  profileGroupAtom.setSelectedNode(
    FlamechartID.CHRONO,
    first.getAppendOrderCalltreeRoot().children[0].children[0],
  )
  profileGroupAtom.setProfileIndexToView(1)
  expect(profileGroupAtom.getActiveProfile()!.chronoViewState.selectedNode).toBe(null)
  profileGroupAtom.setProfileIndexToView(0)
  expect(profileGroupAtom.getActiveProfile()!.chronoViewState.selectedNode!.frame).toBe(
    first.getFrame(0),
  )
  profileGroupAtom.setProfileGroup({name: 'replacement', indexToView: 0, profiles: [second]})
  expect(profileGroupAtom.getActiveProfile()!.selectedFrameKey).toBe(null)
})
test('resolved selections and misses do not repeatedly traverse trees on hover updates', () => {
  const profile = make()
  profileGroupAtom.setSelectedNode(
    FlamechartID.CHRONO,
    profile.getAppendOrderCalltreeRoot().children[0],
  )
  const root = jest.spyOn(profile, 'getAppendOrderCalltreeRoot')
  for (let i = 0; i < 20; i++)
    profileGroupAtom.setFlamechartHoveredNode(FlamechartID.CHRONO, {
      node: profile.getGroupedCalltreeRoot().children[0],
      event: {} as MouseEvent,
    })
  expect(root).not.toHaveBeenCalled()
  root.mockRestore()
})
test('hover clearing sends one notification and is a no-op once clear', () => {
  const profile = make(),
    atom = new ProfileGroupAtom(null, 'hover-clear-test')
  atom.setProfileGroup({name: 'group', indexToView: 0, profiles: [profile]})
  const node = profile.getAppendOrderCalltreeRoot().children[0]
  atom.setSelectedFrame(profile.getFrame(0)!)
  for (const id of [
    FlamechartID.CHRONO,
    FlamechartID.LEFT_HEAVY,
    FlamechartID.SANDWICH_CALLEES,
    FlamechartID.SANDWICH_INVERTED_CALLERS,
  ])
    atom.setFlamechartHoveredNode(id, {node, event: {} as MouseEvent})
  const changed = jest.fn()
  atom.subscribe(changed)
  atom.clearHoverNode()
  expect(changed).toHaveBeenCalledTimes(1)
  atom.clearHoverNode()
  expect(changed).toHaveBeenCalledTimes(1)
})
test('flattening retains aggregate and derived provenance', () => {
  const profile = make()
  profile.setChronological(false)
  profile.setDerived(true)
  const flat = profile.getProfileWithRecursionFlattened()
  expect(flat.isChronological()).toBe(false)
  expect(flat.isDerived()).toBe(true)
  expect(flat.getTotalWeight()).toBe(profile.getTotalWeight())
})

test('hover updates reuse the resolved selection rather than scanning its tree again', () => {
  const profile = make(),
    node = profile.getAppendOrderCalltreeRoot().children[0].children[0]
  profileGroupAtom.setSelectedNode(FlamechartID.CHRONO, node)
  const readRoot = jest.spyOn(profile, 'getAppendOrderCalltreeRoot')
  for (let i = 0; i < 100; i++)
    profileGroupAtom.setFlamechartHoveredNode(FlamechartID.CHRONO, {
      node,
      event: new MouseEvent('mousemove'),
    })
  expect(readRoot).not.toHaveBeenCalled()
  readRoot.mockRestore()
})

test('frames without a target occurrence cache the absence for the current model and key', () => {
  const profile = make(),
    frame = profile.getFrame(0)!
  const local = new ProfileGroupAtom(null, 'absent-selection-test')
  local.setProfileGroup({name: 'group', indexToView: 0, profiles: [profile]})
  local.setSelectedFrame(frame)
  const root = profile.getAppendOrderCalltreeRoot()
  const empty = {...root, children: []}
  const readRoot = jest.fn(() => empty)
  const model = {
    getFrame: () => frame,
    getAppendOrderCalltreeRoot: readRoot,
  } as unknown as typeof profile
  for (let i = 0; i < 20; i++) local.synchronizeSelection(ViewMode.CHRONO_FLAME_CHART, model)
  expect(readRoot).toHaveBeenCalledTimes(1)
  expect(local.getActiveProfile()!.chronoViewState.selectedNode).toBe(null)
})

test('profiles and newly imported groups do not inherit another recording selection', () => {
  const first = make()
  const builder = new StackListProfileBuilder()
  builder.appendSampleWithWeight([{key: 0, name: 'different function'}], 1)
  const second = builder.build()
  profileGroupAtom.setProfileGroup({name: 'group', indexToView: 0, profiles: [first, second]})
  profileGroupAtom.setSelectedNode(
    FlamechartID.CHRONO,
    first.getAppendOrderCalltreeRoot().children[0].children[0],
  )
  profileGroupAtom.setProfileIndexToView(1)
  expect(profileGroupAtom.getActiveProfile()!.selectedFrameKey).toBe(null)
  expect(profileGroupAtom.getActiveProfile()!.chronoViewState.selectedNode).toBe(null)
  profileGroupAtom.setProfileIndexToView(0)
  expect(profileGroupAtom.getActiveProfile()!.chronoViewState.selectedNode!.frame).toBe(
    first.getFrame(0),
  )
  profileGroupAtom.setProfileGroup({name: 'new', indexToView: 0, profiles: [second]})
  expect(profileGroupAtom.getActiveProfile()!.chronoViewState.selectedNode).toBe(null)
})

test('empty groups remain safe when switching views or clearing hover', () => {
  profileGroupAtom.setProfileGroup({name: 'empty', indexToView: 0, profiles: []})
  expect(() => {
    viewModeAtom.set(ViewMode.SANDWICH_VIEW)
    profileGroupAtom.clearHoverNode()
  }).not.toThrow()
  expect(profileGroupAtom.getActiveProfile()).toBe(null)
})
