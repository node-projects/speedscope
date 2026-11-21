import type {ProfileGroup} from './profile'

type TimelineTracks = Pick<ProfileGroup, 'counterTracks' | 'instantTracks' | 'instantEventOmission'>

export function hasTimelineData(group: TimelineTracks | null | undefined): boolean {
  return !!(
    group?.counterTracks?.length ||
    group?.instantTracks?.length ||
    group?.instantEventOmission
  )
}

// Preserve independent timeline data when stack-only actions replace profiles.
// Keep absent properties absent for older files and existing app-state equality.
export function groupTimelineTracks(group: TimelineTracks | null | undefined): TimelineTracks {
  return {
    ...(group?.counterTracks === undefined ? {} : {counterTracks: group.counterTracks}),
    ...(group?.instantTracks === undefined ? {} : {instantTracks: group.instantTracks}),
    ...(group?.instantEventOmission === undefined
      ? {}
      : {instantEventOmission: group.instantEventOmission}),
  }
}
