import {Atom} from '../lib/atom'
import {SourceLinkConfig, validateSourceLinkConfig} from '../lib/source-links'

export function storedPreference<T>(
  key: string,
  fallback: T,
  validate: (value: unknown) => T,
): Atom<T> {
  let initial = fallback
  try {
    const raw = window.localStorage.getItem(key)
    if (raw !== null) initial = validate(JSON.parse(raw))
  } catch {}
  return new (class extends Atom<T> {
    set(value: T) {
      value = validate(value)
      try {
        window.localStorage.setItem(key, JSON.stringify(value))
      } catch {}
      super.set(value)
    }
  })(initial, key)
}
export const sourceLinkConfigAtom = storedPreference<SourceLinkConfig | null>(
  'speedscope-source-links-v1',
  null,
  value => (value === null ? null : validateSourceLinkConfig(value)),
)
export const compactFrameLabelsAtom = storedPreference(
  'speedscope-compact-frame-labels',
  false,
  value => {
    if (typeof value !== 'boolean') throw new Error('Invalid label preference')
    return value
  },
)
