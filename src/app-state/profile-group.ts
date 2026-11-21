import {Atom} from '../lib/atom'
import {clamp, Rect, Vec2} from '../lib/math'
import {CallTreeNode, Frame, Profile, ProfileGroup} from '../lib/profile'
import {objectsHaveShallowEquality} from '../lib/utils'
import {ViewMode} from '../lib/view-mode'
import {findFrameNode, nodeBelongsToTree} from '../lib/frame-selection'
import type {CounterTrack} from '../lib/counter-track'

export interface FlamechartViewState {
  hover: {
    node: CallTreeNode
    event: MouseEvent
  } | null
  selectedNode: CallTreeNode | null
  selectionChecked?: boolean
  selectionFrameKey?: string | number | null
  logicalSpaceViewportSize: Vec2
  configSpaceViewportRect: Rect
}

export interface CallerCalleeState {
  selectedFrame: Frame
  invertedCallerFlamegraph: FlamechartViewState
  calleeFlamegraph: FlamechartViewState
}

export interface SandwichViewState {
  callerCallee: CallerCalleeState | null
}

export interface ProfileState {
  profile: Profile
  selectedFrameKey?: string | number | null
  selectionModelId?: number
  chronoViewState: FlamechartViewState
  leftHeavyViewState: FlamechartViewState
  sandwichViewState: SandwichViewState
}

export type ProfileGroupState = {
  name: string
  sourceName?: string

  // The index within the list of profiles currently being viewed
  indexToView: number

  profiles: ProfileState[]
  counterTracks?: readonly CounterTrack[]
} | null

export enum FlamechartID {
  LEFT_HEAVY = 'LEFT_HEAVY',
  CHRONO = 'CHRONO',
  SANDWICH_INVERTED_CALLERS = 'SANDWICH_INVERTED_CALLERS',
  SANDWICH_CALLEES = 'SANDWICH_CALLEES',
}

let initialFlameChartViewState: FlamechartViewState = {
  hover: null,
  selectedNode: null,
  configSpaceViewportRect: Rect.empty,
  logicalSpaceViewportSize: Vec2.zero,
}

export class ProfileGroupAtom extends Atom<ProfileGroupState> {
  // Weak model identities invalidate node references without retaining flattened
  // profile copies or building per-frame occurrence indexes.
  private selectionModels = new WeakMap<Profile, number>()
  private nextSelectionModelId = 1
  set(newState: ProfileGroupState) {
    const oldState = this.state
    if (oldState != null && newState != null && objectsHaveShallowEquality(oldState, newState)) {
      return
    }
    super.set(newState)
  }

  getActiveProfile(): ProfileState | null {
    if (this.state == null) return null
    return this.state.profiles[this.state?.indexToView] || null
  }

  setProfileGroup = (group: ProfileGroup) => {
    this.set({
      name: group.name,
      sourceName: group.sourceName,
      ...(group.counterTracks === undefined ? {} : {counterTracks: group.counterTracks}),
      indexToView: group.indexToView,
      profiles: group.profiles.map(p => ({
        profile: p,
        selectedFrameKey: null,
        chronoViewState: initialFlameChartViewState,
        leftHeavyViewState: initialFlameChartViewState,
        sandwichViewState: {callerCallee: null},
      })),
    })
  }

  setProfileIndexToView = (indexToView: number) => {
    if (this.state == null || !this.state.profiles.length) return

    indexToView = clamp(indexToView, 0, this.state.profiles.length - 1)

    this.set({
      ...this.state,
      indexToView,
    })
  }

  private updateActiveProfileState(fn: (profileState: ProfileState) => ProfileState) {
    if (this.state == null) return
    const {indexToView, profiles} = this.state
    const active = profiles[indexToView]
    if (!active) return
    const next = fn(active)
    if (next === active) return
    this.set({
      ...this.state,
      profiles: profiles.map((p, i) => {
        if (i != indexToView) return p
        return next
      }),
    })
  }

  private updateActiveSandwichViewState(
    fn: (sandwichViewState: SandwichViewState) => SandwichViewState,
  ) {
    this.updateActiveProfileState(p => ({
      ...p,
      sandwichViewState: fn(p.sandwichViewState),
    }))
  }

  setSelectedFrame = (frame: Frame | null) => {
    if (this.state == null) return

    const profile = this.getActiveProfile()
    if (profile == null) {
      return
    }

    this.updateActiveProfileState(p => {
      if (!frame && p.selectedFrameKey === null && !p.sandwichViewState.callerCallee) return p
      if (
        p.selectedFrameKey === (frame?.key ?? null) &&
        p.sandwichViewState.callerCallee?.selectedFrame === frame
      )
        return p
      if (frame == null) {
        return {...p, selectedFrameKey: null, sandwichViewState: {callerCallee: null}}
      }
      return {
        ...p,
        selectedFrameKey: frame.key,
        sandwichViewState: {
          callerCallee: {
            invertedCallerFlamegraph: initialFlameChartViewState,
            calleeFlamegraph: initialFlameChartViewState,
            selectedFrame: frame,
          },
        },
      }
    })
  }

  private updateFlamechartState(
    id: FlamechartID,
    fn: (flamechartViewState: FlamechartViewState) => FlamechartViewState,
  ) {
    switch (id) {
      case FlamechartID.CHRONO: {
        this.updateActiveProfileState(p => ({
          ...p,
          chronoViewState: fn(p.chronoViewState),
        }))
        break
      }

      case FlamechartID.LEFT_HEAVY: {
        this.updateActiveProfileState(p => ({
          ...p,
          leftHeavyViewState: fn(p.leftHeavyViewState),
        }))
        break
      }

      case FlamechartID.SANDWICH_CALLEES: {
        this.updateActiveSandwichViewState(s => ({
          ...s,
          callerCallee:
            s.callerCallee == null
              ? null
              : {
                  ...s.callerCallee,
                  calleeFlamegraph: fn(s.callerCallee.calleeFlamegraph),
                },
        }))
        break
      }

      case FlamechartID.SANDWICH_INVERTED_CALLERS: {
        this.updateActiveSandwichViewState(s => ({
          ...s,
          callerCallee:
            s.callerCallee == null
              ? null
              : {
                  ...s.callerCallee,
                  invertedCallerFlamegraph: fn(s.callerCallee.invertedCallerFlamegraph),
                },
        }))
        break
      }
    }
  }

  setFlamechartHoveredNode(
    id: FlamechartID,
    hover: {node: CallTreeNode; event: MouseEvent} | null,
  ) {
    this.updateFlamechartState(id, f => ({
      ...f,
      hover,
    }))
  }

  setSelectedNode(id: FlamechartID, selectedNode: CallTreeNode | null) {
    if (id === FlamechartID.CHRONO || id === FlamechartID.LEFT_HEAVY) {
      const field = id === FlamechartID.CHRONO ? 'chronoViewState' : 'leftHeavyViewState'
      this.updateActiveProfileState(p => ({
        ...p,
        selectedFrameKey: selectedNode?.frame.key ?? null,
        [field]: {...p[field], selectedNode, selectionChecked: false},
      }))
      return
    }
    this.updateFlamechartState(id, f => ({
      ...f,
      selectedNode,
    }))
  }

  setConfigSpaceViewportRect(id: FlamechartID, configSpaceViewportRect: Rect) {
    this.updateFlamechartState(id, f => ({
      ...f,
      configSpaceViewportRect,
    }))
  }

  setLogicalSpaceViewportSize(id: FlamechartID, logicalSpaceViewportSize: Vec2) {
    this.updateFlamechartState(id, f => ({
      ...f,
      logicalSpaceViewportSize,
    }))
  }

  clearHoverNode() {
    const clear = (state: FlamechartViewState) => (state.hover ? {...state, hover: null} : state)
    this.updateActiveProfileState(p => {
      const chronoViewState = clear(p.chronoViewState),
        leftHeavyViewState = clear(p.leftHeavyViewState)
      const old = p.sandwichViewState.callerCallee
      const callers = old && clear(old.invertedCallerFlamegraph),
        callees = old && clear(old.calleeFlamegraph)
      const sandwichViewState =
        old && (callers !== old.invertedCallerFlamegraph || callees !== old.calleeFlamegraph)
          ? {callerCallee: {...old, invertedCallerFlamegraph: callers!, calleeFlamegraph: callees!}}
          : p.sandwichViewState
      return chronoViewState === p.chronoViewState &&
        leftHeavyViewState === p.leftHeavyViewState &&
        sandwichViewState === p.sandwichViewState
        ? p
        : {...p, chronoViewState, leftHeavyViewState, sandwichViewState}
    })
  }

  synchronizeSelection(mode: ViewMode, model: Profile) {
    let modelId = this.selectionModels.get(model)
    if (modelId === undefined) {
      modelId = this.nextSelectionModelId++
      this.selectionModels.set(model, modelId)
    }
    this.updateActiveProfileState(original => {
      let p = original
      if (p.selectionModelId !== modelId) {
        const reset = (state: FlamechartViewState) => ({
          ...state,
          hover: null,
          selectedNode: null,
          selectionChecked: false,
          selectionFrameKey: undefined,
        })
        p = {
          ...p,
          selectionModelId: modelId,
          chronoViewState: reset(p.chronoViewState),
          leftHeavyViewState: reset(p.leftHeavyViewState),
          sandwichViewState: {callerCallee: null},
        }
      }
      const frame = p.selectedFrameKey == null ? undefined : model.getFrame(p.selectedFrameKey)
      if (p.selectedFrameKey != null && !frame) p = {...p, selectedFrameKey: null}
      if (mode === ViewMode.SANDWICH_VIEW) {
        const old = p.sandwichViewState.callerCallee
        if (old?.selectedFrame === frame || (!old && !frame)) return p
        return {
          ...p,
          sandwichViewState: {
            callerCallee: frame
              ? {
                  selectedFrame: frame,
                  invertedCallerFlamegraph: initialFlameChartViewState,
                  calleeFlamegraph: initialFlameChartViewState,
                }
              : null,
          },
        }
      }
      if (mode !== ViewMode.CHRONO_FLAME_CHART && mode !== ViewMode.LEFT_HEAVY_FLAME_GRAPH) return p
      const field = mode === ViewMode.CHRONO_FLAME_CHART ? 'chronoViewState' : 'leftHeavyViewState'
      const state = p[field]
      // Cache both a node and an absent occurrence for this model/key. Hover and
      // viewport updates must not repeatedly walk a large tree.
      if (state.selectionChecked && state.selectionFrameKey === p.selectedFrameKey) return p
      let node: CallTreeNode | null = null
      if (frame) {
        const root =
          mode === ViewMode.CHRONO_FLAME_CHART
            ? model.getAppendOrderCalltreeRoot()
            : model.getGroupedCalltreeRoot()
        node =
          state.selectedNode?.frame === frame && nodeBelongsToTree(state.selectedNode, root)
            ? state.selectedNode
            : findFrameNode(root, frame)
      }
      return {
        ...p,
        [field]: {
          ...state,
          selectedNode: node,
          selectionChecked: true,
          selectionFrameKey: p.selectedFrameKey,
        },
      }
    })
  }
}
