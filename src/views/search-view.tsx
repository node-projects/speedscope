import {StyleSheet, css} from 'aphrodite'
import {h, createContext, ComponentChildren, Fragment} from 'preact'
import {useCallback, useRef, useEffect, useMemo} from 'preact/hooks'
import {memo} from 'preact/compat'
import {Sizes, FontSize} from './style'
import {ProfileSearchResults, SearchMode, getSearchQueryError} from '../lib/profile-search'
import {Profile} from '../lib/profile'
import {useActiveProfileState} from '../app-state/active-profile-state'
import {useTheme, withTheme} from './themes/theme'
import {searchIsActiveAtom, searchQueryAtom, searchModeAtom} from '../app-state'
import {useAtom} from '../lib/atom'

function stopPropagation(ev: Event) {
  ev.stopPropagation()
}

export const ProfileSearchContext = createContext<ProfileSearchResults | null>(null)

export const ProfileSearchContextProvider = ({children}: {children: ComponentChildren}) => {
  const activeProfileState = useActiveProfileState()
  const profile: Profile | null = activeProfileState ? activeProfileState.profile : null
  const searchIsActive = useAtom(searchIsActiveAtom)
  const searchQuery = useAtom(searchQueryAtom)
  const searchMode = useAtom(searchModeAtom)

  const searchResults = useMemo(() => {
    if (!profile || !searchIsActive || searchQuery.length === 0) {
      return null
    }
    if (getSearchQueryError(searchQuery, searchMode)) return null
    return new ProfileSearchResults(profile, searchQuery, searchMode)
  }, [searchIsActive, searchQuery, searchMode, profile])

  return (
    <ProfileSearchContext.Provider value={searchResults}>{children}</ProfileSearchContext.Provider>
  )
}

interface SearchViewProps {
  resultIndex: number | null
  numResults: number | null
  resultsLimited?: boolean
  selectNext: () => void
  selectPrev: () => void
  zoomToMatch?: () => void
}

export const SearchView = memo(
  ({
    numResults,
    resultIndex,
    selectNext,
    selectPrev,
    resultsLimited = false,
    zoomToMatch,
  }: SearchViewProps) => {
    const theme = useTheme()
    const style = getStyle(theme)
    const searchIsActive = useAtom(searchIsActiveAtom)
    const searchQuery = useAtom(searchQueryAtom)
    const searchMode = useAtom(searchModeAtom)
    const queryError = useMemo(
      () => getSearchQueryError(searchQuery, searchMode),
      [searchQuery, searchMode],
    )
    const setSearchQuery = searchQueryAtom.set
    const setSearchIsActive = searchIsActiveAtom.set

    const onInput = useCallback(
      (ev: Event) => {
        const value = (ev.target as HTMLInputElement).value
        setSearchQuery(value.slice(0, 4096))
      },
      [setSearchQuery],
    )

    const inputRef = useRef<HTMLInputElement | null>(null)

    const close = useCallback(() => setSearchIsActive(false), [setSearchIsActive])

    const selectPrevOrNextResult = useCallback(
      (ev: KeyboardEvent) => {
        if (ev.shiftKey) {
          selectPrev()
        } else {
          selectNext()
        }
      },
      [selectPrev, selectNext],
    )

    const onKeyDown = useCallback(
      (ev: KeyboardEvent) => {
        ev.stopPropagation()

        // Hitting Esc should close the search box
        if (ev.key === 'Escape') {
          setSearchIsActive(false)
        }

        if (ev.key === 'Enter') {
          selectPrevOrNextResult(ev)
        }

        if (ev.key == 'f' && (ev.metaKey || ev.ctrlKey)) {
          if (inputRef.current) {
            // If the input is already focused, select all
            inputRef.current.select()
          }

          // It seems like when an input is focused, the browser find menu pops
          // up without this line. It seems like it's not sufficient to only
          // preventDefault in the window keydown handler.
          ev.preventDefault()
        }
      },
      [setSearchIsActive, selectPrevOrNextResult],
    )

    useEffect(() => {
      const onWindowKeyDown = (ev: KeyboardEvent) => {
        // Cmd+F or Ctrl+F open the search box
        if (ev.key == 'f' && (ev.metaKey || ev.ctrlKey)) {
          // Prevent the browser's search menu from appearing
          ev.preventDefault()

          if (inputRef.current) {
            // If the search box is already open, then re-select it immediately.
            inputRef.current.select()
          } else {
            // Otherwise, focus the search, then focus the input on the next
            // frame, when the search box should have mounted.
            setSearchIsActive(true)
            requestAnimationFrame(() => {
              if (inputRef.current) {
                inputRef.current.select()
              }
            })
          }
        }
      }

      window.addEventListener('keydown', onWindowKeyDown)
      return () => {
        window.removeEventListener('keydown', onWindowKeyDown)
      }
    }, [setSearchIsActive])

    if (!searchIsActive) return null

    return (
      <div className={css(style.searchView, zoomToMatch && style.withZoom)}>
        <span className={css(style.icon)}>🔍</span>
        <select
          aria-label="Search match mode"
          value={searchMode}
          onChange={ev =>
            searchModeAtom.set((ev.currentTarget as HTMLSelectElement).value as SearchMode)
          }
          onKeyDown={stopPropagation}
          onKeyPress={stopPropagation}
        >
          <option value={SearchMode.SUBSTRING}>Contains</option>
          <option value={SearchMode.WHOLE_WORD}>Whole word</option>
          <option value={SearchMode.EXACT}>Exact</option>
          <option value={SearchMode.REGEX}>Regex (RE2)</option>
        </select>
        <span className={css(style.inputContainer, zoomToMatch && style.zoomInput)}>
          <input
            maxLength={4096}
            aria-label="Search functions or files"
            aria-invalid={!!queryError}
            aria-describedby={queryError ? 'profile-search-error' : undefined}
            className={css(style.input)}
            value={searchQuery}
            onInput={onInput}
            onKeyDown={onKeyDown}
            onKeyUp={stopPropagation}
            onKeyPress={stopPropagation}
            ref={inputRef}
          />
        </span>
        {numResults != null && (
          <Fragment>
            <span className={css(style.resultCount)}>
              {resultIndex == null ? '?' : resultIndex + 1}/{numResults}
              {resultsLimited ? '+' : ''}
            </span>
            <button
              aria-label="Previous match"
              className={css(style.icon, style.button)}
              onClick={selectPrev}
            >
              ⬅️
            </button>
            <button
              aria-label="Next match"
              className={css(style.icon, style.button)}
              onClick={selectNext}
            >
              ➡️
            </button>
          </Fragment>
        )}
        {zoomToMatch && (
          <button
            type="button"
            className={css(style.zoomButton)}
            disabled={resultIndex == null}
            title="Center and zoom to the selected search match. Measured frame widths stay unchanged; normal zoom limits apply."
            onClick={zoomToMatch}
          >
            Zoom to match
          </button>
        )}
        <button
          type="button"
          aria-label="Close search"
          onClick={close}
          className={css(style.icon, style.button)}
        >
          <svg
            className={css(style.icon)}
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M4.99999 4.16217L11.6427 10.8048M11.6427 4.16217L4.99999 10.8048"
              stroke={theme.altFgSecondaryColor}
            />
          </svg>
        </button>
        {resultsLimited && (
          <div role="status" className={css(style.limitNotice)}>
            Navigation limited to the first {numResults} matches. Refine your search.
          </div>
        )}
        {queryError && (
          <div role="alert" id="profile-search-error" className={css(style.limitNotice)}>
            {queryError}
          </div>
        )}
      </div>
    )
  },
)

const getStyle = withTheme(theme =>
  StyleSheet.create({
    searchView: {
      position: 'absolute',
      top: 0,
      right: 10,
      height: Sizes.TOOLBAR_HEIGHT,
      width: 360,
      maxWidth: 'calc(100% - 20px)',
      borderWidth: 2,
      borderColor: theme.altFgPrimaryColor,
      borderStyle: 'solid',
      fontSize: FontSize.LABEL,
      boxSizing: 'border-box',
      background: theme.altBgSecondaryColor,
      color: theme.altFgPrimaryColor,
      display: 'flex',
      alignItems: 'center',
    },
    inputContainer: {
      minWidth: 0,
      flexShrink: 1,
      flexGrow: 1,
      display: 'flex',
    },
    withZoom: {
      width: 460,
      height: 'auto',
      minHeight: Sizes.TOOLBAR_HEIGHT,
      flexWrap: 'wrap',
      padding: '2px 0',
    },
    zoomInput: {minWidth: 80},
    zoomButton: {
      flexShrink: 0,
      margin: '0 4px',
      padding: '2px 5px',
      background: 'none',
      border: `1px solid ${theme.altFgSecondaryColor}`,
      borderRadius: 3,
      color: 'inherit',
      font: 'inherit',
      whiteSpace: 'nowrap',
      cursor: 'pointer',
      ':disabled': {opacity: 0.5, cursor: 'default'},
    },
    input: {
      minWidth: 0,
      boxSizing: 'border-box',
      width: '100%',
      border: 'none',
      background: 'none',
      fontSize: FontSize.LABEL,
      lineHeight: `${Sizes.TOOLBAR_HEIGHT}px`,
      color: theme.altFgPrimaryColor,
      ':focus': {
        border: 'none',
        outline: 'none',
      },
      '::selection': {
        color: theme.altFgPrimaryColor,
        background: theme.selectionPrimaryColor,
      },
    },
    resultCount: {
      verticalAlign: 'middle',
    },
    limitNotice: {
      position: 'absolute',
      top: '100%',
      right: 0,
      padding: 6,
      maxWidth: 320,
      background: theme.altBgSecondaryColor,
      color: theme.altFgPrimaryColor,
      border: `1px solid ${theme.altFgSecondaryColor}`,
    },
    icon: {
      flexShrink: 0,
      verticalAlign: 'middle',
      height: '100%',
      margin: '0px 2px 0px 2px',
      fontSize: FontSize.LABEL,
    },
    button: {
      display: 'inline',
      background: 'none',
      border: 'none',
      padding: 0,
      ':focus': {
        outline: 'none',
      },
    },
  }),
)
