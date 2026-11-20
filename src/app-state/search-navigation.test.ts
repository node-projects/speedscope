import {openProfileSearchMatch} from './search-navigation'
import {StackListProfileBuilder} from '../lib/profile'
import {searchProfiles} from '../lib/multi-profile-search'
import {SearchMode} from '../lib/profile-search'
import {
  profileGroupAtom,
  flattenRecursionAtom,
  viewModeAtom,
  searchIsActiveAtom,
  searchQueryAtom,
} from '.'
import {ViewMode} from '../lib/view-mode'
import {getProfileToView} from './getters'

afterEach(() => {
  profileGroupAtom.set(null)
  flattenRecursionAtom.set(false)
  searchIsActiveAtom.set(false)
  searchQueryAtom.set('')
})
test('search navigation selects the correct original frame, including flattened recursion', async () => {
  const make = (name: string) => {
    const builder = new StackListProfileBuilder()
    builder.setName(name)
    builder.appendSampleWithWeight(
      [
        {key: 0, name},
        {key: 0, name},
      ],
      2,
    )
    return builder.build()
  }
  const profiles = [make('first'), make('second')]
  profileGroupAtom.setProfileGroup({name: 'group', indexToView: 0, profiles})
  flattenRecursionAtom.set(true)
  const match = (await searchProfiles(profiles, 'second')).matches[0]
  openProfileSearchMatch(match, profiles, 'second', SearchMode.EXACT)
  const active = profileGroupAtom.getActiveProfile()!
  expect(profileGroupAtom.get()!.indexToView).toBe(1)
  const visible = getProfileToView({profile: profiles[1], flattenRecursion: true})
  expect(active.sandwichViewState.callerCallee!.selectedFrame).toBe(visible.getFrame(0))
  expect(viewModeAtom.get()).toBe(ViewMode.SANDWICH_VIEW)
  expect(searchQueryAtom.get()).toBe('second')
  expect(searchIsActiveAtom.get()).toBe(true)
  profileGroupAtom.setProfileGroup({name: 'new', indexToView: 0, profiles: [profiles[0]]})
  expect(() => openProfileSearchMatch(match, profiles, 'second', SearchMode.EXACT)).toThrow(
    'changed',
  )
  expect(profileGroupAtom.get()!.indexToView).toBe(0)
})
