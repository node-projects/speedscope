// This file contains types which specify the speedscope file format.

export namespace FileFormat {
  export type Profile = EventedProfile | SampledProfile

  export interface File {
    $schema: 'https://www.speedscope.app/file-format-schema.json'

    // Data shared between profiles
    shared: {
      frames: Frame[]
    }

    // List of profile definitions
    profiles: Profile[]
    // Independent measured series, never stack frames or synthetic samples.
    counterTracks?: CounterTrack[]

    // The name of the contained profile group. If omitted, will use the name of
    // the file itself.
    // Added in 0.6.0
    name?: string

    // The index into the `profiles` array that should be displayed upon file
    // load. If omitted, will default to displaying the first profile in the
    // file.
    //
    // Added in 0.6.0
    activeProfileIndex?: number

    // The name of the the program which exported this profile. This isn't
    // consumed but can be helpful for debugging generated data by seeing what
    // was generating it! Recommended format is "name@version". e.g. when the
    // file was exported by speedscope v0.6.0 itself, it will be
    // "speedscope@0.6.0"
    //
    // Added in 0.6.0
    exporter?: string
  }

  export interface Frame {
    name: string
    file?: string
    line?: number
    col?: number
    /** Producer-selected RGB color. Presentation may adapt it for text contrast.
     * @pattern ^#[0-9a-fA-F]{6}$
     */
    color?: string
  }

  export interface CounterTrack {
    id: string
    name: string
    clock: string
    timeUnit: 'nanoseconds' | 'microseconds' | 'milliseconds' | 'seconds'
    // Raw source timestamp corresponding to counter-local zero.
    start: number
    // Independent gauge unit; use unknown when the producer provides none.
    valueUnit: string
    processId?: string
    threadId?: string
    category?: string
    times: number[]
    values: number[]
  }

  export enum ProfileType {
    EVENTED = 'evented',
    SAMPLED = 'sampled',
  }

  export interface IProfile {
    // Explicit fork metadata. start is the shared-clock timestamp corresponding
    // to this profile's startValue, in the profile's own time unit. Clock names
    // are comparable only within this file/group; they are not global IDs.
    // Explicit source-time origin. startValue alone never implies alignment.
    timeline?: TimelineOrigin
    // Optional fork metadata. Aggregate-only profiles have no time-order axis.
    // Omitted values preserve compatibility with existing speedscope files.
    isChronological?: boolean
    // Derived profiles are excluded when combining original captures again.
    isDerived?: boolean
    // Type of profile. This will future proof the file format to allow many
    // different kinds of profiles to be contained and each type to be part of
    // a discriminated union.
    type: ProfileType
  }

  export interface TimelineOrigin {
    // Clock identity is scoped to the containing file/group, not a global
    // promise that independently imported recordings share synchronized clocks.
    /** Shared clock name within one source profile group.
     * @minLength 1
     * @maxLength 128
     */
    clock: string
    // Finite source timestamp of local coordinate zero, in this profile's unit.
    // For native input this is already the origin AFTER startValue is rebased;
    // importers must not add or subtract serialized startValue a second time.
    start: number
  }

  export interface EventedProfile extends IProfile {
    type: ProfileType.EVENTED

    // Name of the profile. Typically a filename for the source of the profile.
    name: string

    // Unit which all value are specified using in the profile.
    unit: ValueUnit

    // The starting value of the profile. This will typically be a timestamp.
    // All event values will be displayed relative to this startValue.
    startValue: number

    // The final value of the profile. This will typically be a timestamp. This
    // must be greater than or equal to the startValue. This is useful in
    // situations where the recorded profile extends past the end of the recorded
    // events, which may happen if nothing was happening at the end of the
    // profile.
    endValue: number

    // List of events that occured as part of this profile.
    // The "at" field of every event must be in non-decreasing order.
    events: (OpenFrameEvent | CloseFrameEvent)[]
  }

  // List of indices into the frame array
  type SampledStack = number[]

  export interface SampledProfile extends IProfile {
    type: ProfileType.SAMPLED

    // Name of the profile. Typically a filename for the source of the profile.
    name: string

    // Unit which all value are specified using in the profile.
    unit: ValueUnit

    // The starting value of the profile. This will typically be a timestamp.
    // All event values will be displayed relative to this startValue.
    startValue: number

    // The final value of the profile. This will typically be a timestamp. This
    // must be greater than or equal to the startValue. This is useful in
    // situations where the recorded profile extends past the end of the recorded
    // events, which may happen if nothing was happening at the end of the
    // profile.
    endValue: number

    // List of stacks
    samples: SampledStack[]

    // The weight of the sample at the given index. Should have
    // the same length as the samples array.
    weights: number[]
  }

  export type ValueUnit =
    | 'none'
    | 'nanoseconds'
    | 'microseconds'
    | 'milliseconds'
    | 'seconds'
    | 'bytes'

  export enum EventType {
    OPEN_FRAME = 'O',
    CLOSE_FRAME = 'C',
  }

  interface IEvent {
    type: EventType
    at: number
  }

  // Indicates a stack frame opened. Every opened stack frame must have a
  // corresponding close frame event, and the ordering must be balanced.
  interface OpenFrameEvent extends IEvent {
    type: EventType.OPEN_FRAME
    // An index into the frames array in the shared data within the profile
    frame: number
  }

  interface CloseFrameEvent extends IEvent {
    type: EventType.CLOSE_FRAME
    // An index into the frames array in the shared data within the profile
    frame: number
  }
}
