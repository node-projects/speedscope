import {Profile} from '../lib/profile'
import {ProfileSearchMatch} from '../lib/multi-profile-search'
import {SearchMode} from '../lib/profile-search'
import {getProfileToView} from './getters'
import {
  flattenRecursionAtom,
  profileGroupAtom,
  searchQueryAtom,
  searchModeAtom,
  searchIsActiveAtom,
  viewModeAtom,
} from '.'
import {ViewMode} from '../lib/view-mode'

export function openProfileSearchMatch(
  match: ProfileSearchMatch,
  expectedProfiles: readonly Profile[],
  query: string,
  mode: SearchMode,
) {
  const group = profileGroupAtom.get()
  if (
    !group ||
    group.profiles.length !== expectedProfiles.length ||
    group.profiles.some((p, i) => p.profile !== expectedProfiles[i]) ||
    expectedProfiles[match.profileIndex] !== match.profile ||
    match.profile.getFrame(match.frame.key) !== match.frame
  )
    throw new Error('The source profiles changed. Search again.')
  const visible = getProfileToView({
    profile: match.profile,
    flattenRecursion: flattenRecursionAtom.get(),
  })
  const frame = visible.getFrame(match.frame.key)
  if (!frame) throw new Error('This frame is not available in the current view')
  profileGroupAtom.setProfileIndexToView(match.profileIndex)
  // Resolve the picked function in the destination view, avoiding an unused
  // occurrence scan in the view we're about to leave.
  viewModeAtom.set(ViewMode.SANDWICH_VIEW)
  profileGroupAtom.setSelectedFrame(frame)
  searchModeAtom.set(mode)
  searchQueryAtom.set(query)
  searchIsActiveAtom.set(true)
}
