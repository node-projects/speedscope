import {h, render} from 'preact'
import {act} from 'preact/test-utils'
import {useActiveProfileState, ActiveProfileState} from './active-profile-state'
import {flattenRecursionAtom, profileGroupAtom, viewModeAtom} from '.'
import {StackListProfileBuilder} from '../lib/profile'
import {ViewMode} from '../lib/view-mode'

test('Tracks avoids constructing recursion-flattened models while other views retain their behavior', () => {
  const builder = new StackListProfileBuilder()
  const frame = {key: 'work', name: 'work'}
  builder.appendSampleWithWeight([frame, frame], 10)
  const profile = builder.build()
  const flatten = jest.spyOn(profile, 'getProfileWithRecursionFlattened')
  const host = document.createElement('div')
  document.body.appendChild(host)
  let observed: ActiveProfileState | null = null
  function Probe() {
    observed = useActiveProfileState()
    return null
  }
  try {
    profileGroupAtom.set(null)
    viewModeAtom.set(ViewMode.MULTI_TRACK)
    flattenRecursionAtom.set(true)
    profileGroupAtom.setProfileGroup({name: 'source', indexToView: 0, profiles: [profile]})
    act(() => render(<Probe />, host))
    expect(observed!.profile).toBe(profile)
    expect(flatten).not.toHaveBeenCalled()
    act(() => {
      viewModeAtom.set(ViewMode.LEFT_HEAVY_FLAME_GRAPH)
    })
    expect(flatten).toHaveBeenCalled()
    expect(observed!.profile).not.toBe(profile)
    act(() => {
      viewModeAtom.set(ViewMode.MULTI_TRACK)
    })
    expect(observed!.profile).toBe(profile)
  } finally {
    act(() => render(null, host))
    host.remove()
    flatten.mockRestore()
    profileGroupAtom.set(null)
    flattenRecursionAtom.set(false)
    viewModeAtom.set(ViewMode.CHRONO_FLAME_CHART)
  }
})
