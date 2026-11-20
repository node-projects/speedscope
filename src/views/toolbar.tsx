import {
  cropProfile,
  combineProfiles,
  invertProfile,
  groupProfileByFile,
  isDerivedProfile,
} from '../lib/profile-transformations'
import {ApplicationProps} from './application'
import {h, JSX, Fragment} from 'preact'
import {useCallback, useState, useEffect, useRef} from 'preact/hooks'
import {StyleSheet, css} from 'aphrodite'
import {Sizes, FontFamily, FontSize, Duration} from './style'
import {ProfileSelect} from './profile-select'
import {Profile} from '../lib/profile'
import {objectsHaveShallowEquality} from '../lib/utils'
import {colorSchemeToString, useTheme, withTheme} from './themes/theme'
import {ViewMode} from '../lib/view-mode'
import {viewModeAtom} from '../app-state'
import {ProfileGroupState} from '../app-state/profile-group'
import {colorSchemeAtom} from '../app-state/color-scheme'
import {useAtom} from '../lib/atom'
import {ProfileFilterDialog} from './profile-filter-dialog'
import {MultiProfileSearchDialog} from './multi-profile-search-dialog'
import {openProfileSearchMatch} from '../app-state/search-navigation'
import {SourceLinksDialog} from './source-links-dialog'
import {compactFrameLabelsAtom} from '../app-state/display-preferences'
import {FrameInfo} from '../lib/profile'

interface ToolbarProps extends ApplicationProps {
  browseForFile(): void
  saveFile(): void
}

function useSetViewMode(setViewMode: (viewMode: ViewMode) => void, viewMode: ViewMode) {
  return useCallback(() => setViewMode(viewMode), [setViewMode, viewMode])
}

function ToolbarLeftContent(props: ToolbarProps) {
  const style = getStyle(useTheme())
  const setChronoFlameChart = useSetViewMode(viewModeAtom.set, ViewMode.CHRONO_FLAME_CHART)
  const setLeftHeavyFlameGraph = useSetViewMode(viewModeAtom.set, ViewMode.LEFT_HEAVY_FLAME_GRAPH)
  const setSandwichView = useSetViewMode(viewModeAtom.set, ViewMode.SANDWICH_VIEW)

  const setCallTree = useSetViewMode(viewModeAtom.set, ViewMode.CALL_TREE)

  if (!props.activeProfileState) return null

  return (
    <div className={css(style.toolbarLeft)}>
      <button
        type="button"
        className={css(
          style.toolbarTab,
          props.viewMode === ViewMode.CHRONO_FLAME_CHART && style.toolbarTabActive,
        )}
        onClick={setChronoFlameChart}
        disabled={!props.activeProfileState.profile.isChronological()}
        title={
          !props.activeProfileState.profile.isChronological()
            ? 'This profile contains aggregate weights without chronological order'
            : undefined
        }
      >
        <span className={css(style.emoji)}>🕰</span>Time Order
      </button>
      <button
        type="button"
        className={css(
          style.toolbarTab,
          props.viewMode === ViewMode.LEFT_HEAVY_FLAME_GRAPH && style.toolbarTabActive,
        )}
        onClick={setLeftHeavyFlameGraph}
      >
        <span className={css(style.emoji)}>⬅️</span>Left Heavy
      </button>
      <button
        type="button"
        className={css(
          style.toolbarTab,
          props.viewMode === ViewMode.SANDWICH_VIEW && style.toolbarTabActive,
        )}
        onClick={setSandwichView}
      >
        <span className={css(style.emoji)}>🥪</span>Sandwich
      </button>
      <button
        type="button"
        className={css(
          style.toolbarTab,
          props.viewMode === ViewMode.CALL_TREE && style.toolbarTabActive,
        )}
        onClick={setCallTree}
      >
        Call Tree
      </button>
    </div>
  )
}

const getCachedProfileList = (() => {
  // TODO(jlfwong): It would be nice to just implement this as useMemo, but if
  // we do that using profileGroup or profileGroup.profiles as the cache key,
  // then it will invalidate whenever *anything* changes, because
  // profileGroup.profiles is ProfileState[], which contains component state
  // information for each tab for each profile. So whenever any property in any
  // persisted view state changes for *any* view in *any* profile, the profiles
  // list will get re-generated.
  let cachedProfileList: Profile[] | null = null

  return (profileGroup: ProfileGroupState): Profile[] | null => {
    let nextProfileList = profileGroup?.profiles.map(p => p.profile) || null

    if (
      cachedProfileList === null ||
      (nextProfileList != null && !objectsHaveShallowEquality(cachedProfileList, nextProfileList))
    ) {
      cachedProfileList = nextProfileList
    }

    return cachedProfileList
  }
})()

function ToolbarCenterContent(props: ToolbarProps): JSX.Element {
  const style = getStyle(useTheme())

  const {activeProfileState, profileGroup} = props
  const profiles = getCachedProfileList(profileGroup)
  const [profileSelectShown, setProfileSelectShown] = useState(false)

  const openProfileSelect = useCallback(() => {
    setProfileSelectShown(true)
  }, [setProfileSelectShown])

  const closeProfileSelect = useCallback(() => {
    setProfileSelectShown(false)
  }, [setProfileSelectShown])

  useEffect(() => {
    const onWindowKeyPress = (ev: KeyboardEvent) => {
      if (ev.key === 't') {
        ev.preventDefault()
        setProfileSelectShown(true)
      }
    }
    window.addEventListener('keypress', onWindowKeyPress)
    return () => {
      window.removeEventListener('keypress', onWindowKeyPress)
    }
  }, [setProfileSelectShown])

  const duration = activeProfileState
    ? activeProfileState.profile.formatValue(activeProfileState.profile.getTotalWeight())
    : ''

  if (activeProfileState && profileGroup && profiles) {
    if (profileGroup.profiles.length === 1) {
      return (
        <Fragment>
          {activeProfileState.profile.getName()} · {duration}
        </Fragment>
      )
    } else {
      return (
        <div className={css(style.toolbarCenter)} onMouseLeave={closeProfileSelect}>
          <button
            type="button"
            className={css(style.profileButton)}
            onMouseOver={openProfileSelect}
            onClick={openProfileSelect}
            aria-label={`Choose from ${profiles.length} profiles`}
            aria-expanded={profileSelectShown}
          >
            {activeProfileState.profile.getName()}{' '}
            <span className={css(style.toolbarProfileIndex)}>
              {activeProfileState.index + 1} / {profileGroup.profiles.length} profiles ▾ ·{' '}
              {duration}
            </span>
          </button>
          <div style={{display: profileSelectShown ? 'block' : 'none'}}>
            <ProfileSelect
              setProfileIndexToView={props.setProfileIndexToView}
              indexToView={profileGroup.indexToView}
              profiles={profiles}
              closeProfileSelect={closeProfileSelect}
              visible={profileSelectShown}
            />
          </div>
        </div>
      )
    }
  }
  return <Fragment>{'🔬speedscope'}</Fragment>
}

function ToolbarRightContent(props: ToolbarProps) {
  const latestProps = useRef(props)
  latestProps.current = props
  const compactLabels = useAtom(compactFrameLabelsAtom)
  const [sourceLinksShown, setSourceLinksShown] = useState(false)
  const [searchProfiles, setSearchProfiles] = useState<Profile[] | null>(null)
  useEffect(() => {
    if (
      searchProfiles &&
      (!props.profileGroup ||
        props.profileGroup.profiles.length !== searchProfiles.length ||
        props.profileGroup.profiles.some((p, i) => p.profile !== searchProfiles[i]))
    )
      setSearchProfiles(null)
  }, [props.profileGroup, searchProfiles])
  const [filterSource, setFilterSource] = useState<{profile: Profile; originals: Profile[]} | null>(
    null,
  )
  useEffect(() => {
    if (filterSource && !props.profileGroup?.profiles.some(p => p.profile === filterSource.profile))
      setFilterSource(null)
  }, [props.profileGroup, filterSource])
  const style = getStyle(useTheme())
  const colorScheme = useAtom(colorSchemeAtom)
  const originals = props.profileGroup?.profiles.filter(p => !isDerivedProfile(p.profile)) || []
  const onProfileAction = async (ev: Event) => {
    const select = ev.currentTarget as HTMLSelectElement
    const action = select.value
    select.value = ''
    const {activeProfileState, profileGroup} = props
    if (!activeProfileState || !profileGroup || props.loading || !action) return
    if (action === 'source-links') {
      setSourceLinksShown(true)
      return
    }
    if (action === 'compact-labels') {
      compactFrameLabelsAtom.set(!compactLabels)
      return
    }
    if (action === 'search-all') {
      setFilterSource(null)
      setSearchProfiles(profileGroup.profiles.map(p => p.profile))
      return
    }
    if (action === 'filter') {
      setSearchProfiles(null)
      setFilterSource({
        profile: activeProfileState.profile,
        originals: profileGroup.profiles.map(p => p.profile),
      })
      return
    }
    props.setLoading(true)
    try {
      // Paint the existing loading indicator before processing a large profile.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const profile = activeProfileState.profile
      let derived: Profile
      if (action === 'crop') {
        const rect = activeProfileState.chronoViewState.configSpaceViewportRect
        derived = cropProfile(profile, rect.origin.x, rect.origin.x + rect.size.x)
      } else if (action === 'combine') {
        derived = combineProfiles(profileGroup.profiles.map(p => p.profile))
      } else if (action === 'invert') {
        derived = invertProfile(profile)
      } else if (action === 'file') {
        derived = groupProfileByFile(profile)
      } else return
      props.setProfileGroup({
        name: profileGroup.name,
        sourceName: profileGroup.sourceName,
        indexToView: profileGroup.profiles.length,
        profiles: [...profileGroup.profiles.map(p => p.profile), derived],
      })
      props.setViewMode(
        action === 'crop' ? ViewMode.CHRONO_FLAME_CHART : ViewMode.LEFT_HEAVY_FLAME_GRAPH,
      )
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
    } finally {
      props.setLoading(false)
    }
  }

  const exportFile = (
    <button type="button" className={css(style.toolbarTab)} onClick={props.saveFile}>
      <span className={css(style.emoji)}>⤴️</span>Export
    </button>
  )
  const importFile = (
    <button type="button" className={css(style.toolbarTab)} onClick={props.browseForFile}>
      <span className={css(style.emoji)}>⤵️</span>Import
    </button>
  )

  const colorSchemeToggle = (
    <button
      type="button"
      aria-label="Change color scheme"
      className={css(style.toolbarTab)}
      onClick={colorSchemeAtom.cycleToNextColorScheme}
    >
      <span className={css(style.emoji)}>🎨</span>
      <span className={css(style.toolbarTabColorSchemeToggle)}>
        {colorSchemeToString(colorScheme)}
      </span>
    </button>
  )

  const help = (
    <div className={css(style.toolbarTab)}>
      <a
        href="https://github.com/node-projects/speedscope#usage"
        className={css(style.noLinkStyle)}
        target="_blank"
      >
        <span className={css(style.emoji)}>❓</span>Help
      </a>
    </div>
  )

  return (
    <div className={css(style.toolbarRight)}>
      {props.activeProfileState && (
        <select
          disabled={props.loading}
          aria-label="Profile actions"
          value=""
          onChange={onProfileAction}
          className={css(style.toolbarTab)}
        >
          <option value="" disabled>
            Profile actions
          </option>
          <option value="crop" disabled={props.viewMode !== ViewMode.CHRONO_FLAME_CHART}>
            Crop to current time view
          </option>
          <option value="combine" disabled={originals.length < 2}>
            Combine original profiles
          </option>
          <option value="invert">Invert stacks</option>
          <option value="file">Group by file</option>
          <option value="filter">Filter frames…</option>
          <option value="search-all">Search all profiles…</option>
          <option value="source-links">Source-code links…</option>
          <option value="compact-labels">
            {compactLabels ? 'Show full graph labels' : 'Compact graph path labels'}
          </option>
        </select>
      )}
      {props.activeProfileState && exportFile}
      {importFile}
      {colorSchemeToggle}
      {help}
      {sourceLinksShown && (
        <SourceLinksDialog
          sample={(() => {
            let checked = 0
            for (const frame of props.activeProfileState?.profile.getFrames() || []) {
              if (frame.file) return frame as FrameInfo
              if (++checked === 200) break
            }
            return null
          })()}
          onClose={() => setSourceLinksShown(false)}
        />
      )}
      {searchProfiles && (
        <MultiProfileSearchDialog
          profiles={searchProfiles}
          onClose={() => setSearchProfiles(null)}
          onSelect={(match, query, mode) => {
            if (latestProps.current.loading)
              throw new Error('A profile is loading. Search again when it finishes.')
            openProfileSearchMatch(match, searchProfiles, query, mode)
          }}
        />
      )}
      {filterSource && (
        <ProfileFilterDialog
          profile={filterSource.profile}
          onClose={() => setFilterSource(null)}
          onApply={derived => {
            const current = latestProps.current
            const group = current.profileGroup
            if (
              current.loading ||
              !group ||
              group.profiles.length !== filterSource.originals.length ||
              group.profiles.some((p, i) => p.profile !== filterSource.originals[i])
            )
              throw new Error('The source profiles changed. Close this filter and try again.')
            current.setProfileGroup({
              name: group.name,
              sourceName: group.sourceName,
              indexToView: group.profiles.length,
              profiles: [...group.profiles.map(p => p.profile), derived],
            })
            current.setViewMode(
              current.viewMode === ViewMode.CALL_TREE
                ? ViewMode.CALL_TREE
                : ViewMode.LEFT_HEAVY_FLAME_GRAPH,
            )
          }}
        />
      )}
    </div>
  )
}

export function Toolbar(props: ToolbarProps) {
  const style = getStyle(useTheme())
  return (
    <div className={css(style.toolbar)}>
      <ToolbarLeftContent {...props} />
      <div className={css(style.toolbarCenter)}>
        <ToolbarCenterContent {...props} />
      </div>
      <ToolbarRightContent {...props} />
    </div>
  )
}

const getStyle = withTheme(theme =>
  StyleSheet.create({
    toolbar: {
      display: 'flex',
      height: Sizes.TOOLBAR_HEIGHT,
      flexShrink: 0,
      background: theme.altBgPrimaryColor,
      color: theme.altFgPrimaryColor,
      textAlign: 'center',
      fontFamily: FontFamily.MONOSPACE,
      fontSize: FontSize.TITLE,
      lineHeight: `${Sizes.TOOLBAR_TAB_HEIGHT}px`,
      userSelect: 'none',
    },
    toolbarLeft: {
      flexShrink: 0,
      height: Sizes.TOOLBAR_HEIGHT,
      overflow: 'hidden',
      top: 0,
      left: 0,
      marginRight: 2,
      textAlign: 'left',
    },
    toolbarCenter: {
      flex: 1,
      minWidth: 0,
      whiteSpace: 'nowrap',
      textOverflow: 'ellipsis',
      paddingTop: 1,
      height: Sizes.TOOLBAR_HEIGHT,
    },
    toolbarRight: {
      flexShrink: 0,
      height: Sizes.TOOLBAR_HEIGHT,
      overflow: 'hidden',
      top: 0,
      right: 0,
      marginRight: 2,
      textAlign: 'right',
    },
    toolbarProfileIndex: {
      color: theme.altFgSecondaryColor,
    },
    profileButton: {
      maxWidth: '100%',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      background: 'none',
      border: 0,
      color: 'inherit',
      font: 'inherit',
      cursor: 'pointer',
    },
    toolbarTab: {
      border: 0,
      color: 'inherit',
      font: 'inherit',
      cursor: 'pointer',
      paddingTop: 0,
      paddingBottom: 0,
      ':focus-visible': {outline: `2px solid ${theme.fgPrimaryColor}`, outlineOffset: -2},
      ':disabled': {opacity: 0.5, cursor: 'default'},
      background: theme.altBgSecondaryColor,
      marginTop: Sizes.SEPARATOR_HEIGHT,
      height: Sizes.TOOLBAR_TAB_HEIGHT,
      lineHeight: `${Sizes.TOOLBAR_TAB_HEIGHT}px`,
      paddingLeft: 2,
      paddingRight: 8,
      display: 'inline-block',
      marginLeft: 2,
      transition: `all ${Duration.HOVER_CHANGE} ease-in`,
      ':hover': {
        background: theme.selectionSecondaryColor,
      },
    },
    toolbarTabActive: {
      background: theme.selectionPrimaryColor,
      ':hover': {
        background: theme.selectionPrimaryColor,
      },
    },
    toolbarTabColorSchemeToggle: {
      display: 'inline-block',
      textAlign: 'center',
      minWidth: '50px',
    },
    emoji: {
      display: 'inline-block',
      verticalAlign: 'middle',
      paddingTop: '0px',
      marginRight: '0.3em',
    },
    noLinkStyle: {
      textDecoration: 'none',
      color: 'inherit',
    },
  }),
)
