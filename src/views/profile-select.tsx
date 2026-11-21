import {Profile} from '../lib/profile'
import {h, ComponentChild} from 'preact'
import {useState, useMemo, useLayoutEffect, useRef} from 'preact/hooks'
import {StyleSheet, css} from 'aphrodite'
import {ZIndex, Sizes, FontSize} from './style'
import {fuzzyMatchStrings} from '../lib/fuzzy-find'
import {useTheme, withTheme} from './themes/theme'

export const PROFILE_SELECT_PAGE_SIZE = 100
const LIST_ID = 'profile-select-options'
const HELP_ID = 'profile-select-keyboard-help'
const STATUS_ID = 'profile-select-results'
type SortField = 'index' | 'name' | 'weight'
interface SortMethod {
  field: SortField
  descending: boolean
}
interface ProfileSelectProps {
  setProfileIndexToView: (profileIndex: number) => void
  indexToView: number
  profiles: Profile[]
  closeProfileSelect: () => void
  visible: boolean
}

function sortedIndices(profiles: Profile[], query: string, sort: SortMethod) {
  const indices: number[] = []
  for (let i = 0; i < profiles.length; i++)
    if (!query || fuzzyMatchStrings(profiles[i].getName(), query)) indices.push(i)
  const direction = sort.descending ? -1 : 1
  indices.sort((a, b) => {
    let result = a - b
    if (sort.field === 'name')
      result = profiles[a]
        .getName()
        .toLowerCase()
        .localeCompare(profiles[b].getName().toLowerCase())
    else if (sort.field === 'weight')
      result = profiles[a].getTotalNonIdleWeight() - profiles[b].getTotalNonIdleWeight()
    return direction * (result || a - b)
  })
  return indices
}

function highlightedName(name: string, query: string, highlightedClass: string) {
  const ranges = query ? fuzzyMatchStrings(name, query)?.matchedRanges || [] : []
  const parts: ComponentChild[] = []
  let end = 0
  for (const range of ranges) {
    parts.push(name.slice(end, range[0]))
    parts.push(<span className={highlightedClass}>{name.slice(range[0], range[1])}</span>)
    end = range[1]
  }
  parts.push(name.slice(end))
  return parts
}

export function ProfileSelect(props: ProfileSelectProps) {
  const style = getStyle(useTheme())
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortMethod>({field: 'index', descending: false})
  // Numeric indices only: do not retain fuzzy ranges or an object per result.
  const indices = useMemo(
    () => sortedIndices(props.profiles, query, sort),
    [props.profiles, query, sort],
  )
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const restoreFocus = useRef(true)
  const explicitlyClosing = useRef(false)
  useLayoutEffect(() => {
    if (!props.visible) return
    restoreFocus.current = true
    explicitlyClosing.current = false
    // Pointer activation does not focus buttons on every browser/platform.
    // Prefer the actual trigger over whichever element happened to be focused.
    const previous =
      document.querySelector<HTMLElement>(`button[aria-controls="${LIST_ID}"]`) ||
      (document.activeElement as HTMLElement | null)
    input.current?.focus()
    input.current?.select()
    return () => {
      if (restoreFocus.current && previous?.isConnected) previous.focus()
    }
  }, [props.visible])
  useLayoutEffect(() => {
    if (props.visible) setActive(query ? 0 : Math.max(0, indices.indexOf(props.indexToView)))
  }, [indices, props.indexToView, props.visible, query])
  const position = Math.max(0, Math.min(active, indices.length - 1))
  const start = Math.floor(position / PROFILE_SELECT_PAGE_SIZE) * PROFILE_SELECT_PAGE_SIZE
  const end = Math.min(start + PROFILE_SELECT_PAGE_SIZE, indices.length)
  const activeId = indices.length ? `profile-select-option-${indices[position]}` : undefined
  useLayoutEffect(() => {
    if (props.visible && activeId)
      document.getElementById(activeId)?.scrollIntoView?.({block: 'nearest'})
  }, [activeId, props.visible])
  if (!props.visible) return null
  const closeExplicitly = () => {
    // The parent keeps this component mounted under display:none. Its automatic
    // blur can precede our layout cleanup and must not look like user Tab-away.
    explicitlyClosing.current = true
    restoreFocus.current = true
    props.closeProfileSelect()
  }
  const choose = (index: number) => {
    explicitlyClosing.current = true
    restoreFocus.current = true
    props.setProfileIndexToView(index)
    closeExplicitly()
  }
  const keyDown = (event: KeyboardEvent) => {
    event.stopPropagation()
    // Composition keys belong to the input method, including Enter and Escape.
    if (
      event.isComposing ||
      event.keyCode === 229 ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    )
      return
    let target: number | undefined
    switch (event.key) {
      case 'ArrowDown':
        target = position + 1
        break
      case 'ArrowUp':
        target = position - 1
        break
      case 'Home':
        target = 0
        break
      case 'End':
        target = indices.length - 1
        break
      case 'PageDown':
        target = position + PROFILE_SELECT_PAGE_SIZE
        break
      case 'PageUp':
        target = position - PROFILE_SELECT_PAGE_SIZE
        break
      case 'Enter':
        event.preventDefault()
        if (indices.length) choose(indices[position])
        return
      case 'Escape':
        event.preventDefault()
        closeExplicitly()
        return
    }
    if (target !== undefined) {
      event.preventDefault()
      setActive(Math.max(0, Math.min(target, indices.length - 1)))
    }
  }
  const sortBy = (field: SortField) =>
    setSort({field, descending: sort.field === field ? !sort.descending : field === 'weight'})
  return (
    <div
      className={css(style.outer)}
      onBlurCapture={event => {
        if (
          !explicitlyClosing.current &&
          !event.currentTarget.contains(event.relatedTarget as Node | null)
        ) {
          // Let Tab/click move to its intended destination instead of pulling
          // focus back into the trigger when the user leaves the popup.
          restoreFocus.current = false
          props.closeProfileSelect()
        }
      }}
      onKeyDown={event => {
        event.stopPropagation()
        if (event.key === 'Escape' && !event.isComposing) {
          event.preventDefault()
          closeExplicitly()
        }
      }}
      onKeyUp={event => event.stopPropagation()}
      onKeyPress={event => event.stopPropagation()}
    >
      <div className={css(style.box)}>
        <div className={css(style.filterBar)}>
          <input
            ref={input}
            type="text"
            role="combobox"
            aria-label="Filter profiles"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={LIST_ID}
            aria-activedescendant={activeId}
            aria-describedby={`${HELP_ID} ${STATUS_ID}`}
            placeholder="Filter profiles…"
            maxLength={256}
            value={query}
            onInput={event => setQuery(event.currentTarget.value.slice(0, 256))}
            onKeyDown={keyDown}
            className={css(style.input)}
          />
          <button type="button" onClick={closeExplicitly} className={css(style.control)}>
            Close
          </button>
        </div>
        <p id={HELP_ID} className={css(style.hint)}>
          Arrow keys to navigate, Home/End or Page Up/Down to move, Enter to select, Escape to
          close.
        </p>
        <div role="group" aria-label="Sort profiles" className={css(style.sortBar)}>
          {(['index', 'name', 'weight'] as SortField[]).map(field => (
            <button
              key={field}
              type="button"
              aria-pressed={sort.field === field}
              aria-label={`Sort profiles by ${field}${
                sort.field === field ? ', ' + (sort.descending ? 'descending' : 'ascending') : ''
              }`}
              className={css(style.control)}
              onClick={() => sortBy(field)}
            >
              {field === 'index' ? '#' : field === 'name' ? 'Name' : 'Total weight'}
              {sort.field === field ? (sort.descending ? ' ↓' : ' ↑') : ''}
            </button>
          ))}
        </div>
        <div className={css(style.scrolling)}>
          <ul id={LIST_ID} role="listbox" aria-label="Profiles" className={css(style.list)}>
            {indices.slice(start, end).map((profileIndex, offset) => {
              const profile = props.profiles[profileIndex]
              return (
                <li
                  key={profileIndex}
                  id={`profile-select-option-${profileIndex}`}
                  role="option"
                  aria-selected={profileIndex === props.indexToView}
                  aria-setsize={indices.length}
                  aria-posinset={start + offset + 1}
                  onMouseDown={event => {
                    if (event.button === 0) event.preventDefault()
                  }}
                  onMouseEnter={() => setActive(start + offset)}
                  onClick={() => choose(profileIndex)}
                  title={profile.getName()}
                  className={css(
                    style.option,
                    profileIndex === props.indexToView && style.selected,
                    start + offset === position && style.active,
                  )}
                >
                  <span className={css(style.index)}>{profileIndex + 1}</span>
                  <span className={css(style.name)}>
                    {highlightedName(profile.getName(), query, css(style.highlighted))}
                  </span>
                  <span className={css(style.weight)}>
                    {profile.formatValue(profile.getTotalNonIdleWeight())}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
        <div className={css(style.pagination)}>
          <button
            type="button"
            className={css(style.control)}
            aria-label="Previous profile results page"
            disabled={start === 0}
            onClick={() => setActive(Math.max(0, start - PROFILE_SELECT_PAGE_SIZE))}
          >
            Previous
          </button>
          <span id={STATUS_ID} role="status">
            {indices.length
              ? `${start + 1}–${end} of ${indices.length} profiles`
              : 'No profiles match this filter'}
          </span>
          <button
            type="button"
            className={css(style.control)}
            aria-label="Next profile results page"
            disabled={end === indices.length}
            onClick={() => setActive(end)}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}

const getStyle = withTheme(theme =>
  StyleSheet.create({
    outer: {width: '100%', maxWidth: 680, position: 'relative', zIndex: ZIndex.PROFILE_SELECT},
    box: {
      whiteSpace: 'normal',
      boxSizing: 'border-box',
      background: theme.altBgPrimaryColor,
      color: theme.altFgPrimaryColor,
      padding: 8,
      borderRadius: 6,
      boxShadow: '0 6px 20px rgba(0,0,0,0.3)',
    },
    filterBar: {display: 'flex', gap: 8},
    input: {
      flex: 1,
      minWidth: 0,
      font: 'inherit',
      padding: 6,
      border: `1px solid ${theme.altFgSecondaryColor}`,
      borderRadius: 4,
      color: theme.altFgPrimaryColor,
      background: theme.altBgSecondaryColor,
    },
    control: {
      font: 'inherit',
      color: theme.altFgPrimaryColor,
      background: theme.altBgSecondaryColor,
      border: `1px solid ${theme.altFgSecondaryColor}`,
      borderRadius: 3,
      padding: '4px 8px',
      cursor: 'pointer',
      ':disabled': {opacity: 0.5, cursor: 'default'},
    },
    hint: {
      fontSize: FontSize.LABEL,
      lineHeight: 1.5,
      padding: '6px 0',
      color: theme.altFgSecondaryColor,
    },
    sortBar: {display: 'flex', gap: 6, paddingBottom: 6},
    scrolling: {overflow: 'auto', maxHeight: `min(50vh, ${20 * Sizes.FRAME_HEIGHT}px)`},
    list: {listStyle: 'none', margin: 0, padding: 0},
    option: {
      display: 'grid',
      gridTemplateColumns: 'max-content minmax(0, 1fr) max-content',
      gap: 10,
      padding: '6px 8px',
      fontSize: FontSize.LABEL,
      cursor: 'pointer',
      border: '1px solid transparent',
    },
    active: {borderColor: theme.altFgPrimaryColor},
    selected: {background: theme.selectionPrimaryColor},
    highlighted: {background: theme.selectionSecondaryColor},
    index: {fontFamily: 'monospace', minWidth: 24, textAlign: 'right'},
    name: {overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'},
    weight: {whiteSpace: 'nowrap', textAlign: 'right'},
    pagination: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      paddingTop: 8,
      fontSize: FontSize.LABEL,
    },
  }),
)
