import {Profile} from './profile'
import {ProfileCallEventRangeIndex} from './profile-call-event-index'

export const MAX_TRACK_CALL_EVENT_INDICES = 32

// One Tracks-session cache, never attached to Profile or module-global state.
// Pending builds belong to their render request and are not retained here.
export class TrackCallEventIndexCache {
  private entries = new Map<Profile, ProfileCallEventRangeIndex>()
  private generation = 0

  get size() {
    return this.entries.size
  }

  clear() {
    this.generation++
    this.entries.clear()
  }

  async get(
    profile: Profile,
    options: {signal?: AbortSignal; yieldControl?: () => Promise<void>} = {},
  ): Promise<ProfileCallEventRangeIndex> {
    const generation = this.generation
    const checkAbort = () => {
      if (options.signal?.aborted || this.generation !== generation) {
        throw new DOMException('Timeline indexing cancelled', 'AbortError')
      }
    }
    checkAbort()
    const existing = this.entries.get(profile)
    if (existing) {
      this.entries.delete(profile)
      this.entries.set(profile, existing)
      return existing
    }
    const index = await profile.createCallEventRangeIndex(options)
    checkAbort()
    this.entries.delete(profile)
    this.entries.set(profile, index)
    while (this.entries.size > MAX_TRACK_CALL_EVENT_INDICES)
      this.entries.delete(this.entries.keys().next().value!)
    return index
  }
}
