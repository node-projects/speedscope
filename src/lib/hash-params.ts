import {ViewMode} from '../lib/view-mode'
import {FunctionSelection, parseFunctionSelection} from './function-link'

export interface HashParams {
  profileURL?: string
  profileAccepts?: string
  title?: string
  localProfilePath?: string
  viewMode?: ViewMode
  selection?: FunctionSelection
}

function getViewMode(value: string): ViewMode | null {
  switch (value) {
    case 'time-ordered':
      return ViewMode.CHRONO_FLAME_CHART
    case 'left-heavy':
      return ViewMode.LEFT_HEAVY_FLAME_GRAPH
    case 'sandwich':
      return ViewMode.SANDWICH_VIEW
    case 'call-tree':
      return ViewMode.CALL_TREE
    default:
      return null
  }
}

export function getHashParams(hashContents = window.location.hash): HashParams {
  try {
    if (!hashContents.startsWith('#')) {
      return {}
    }
    const components = hashContents.substr(1).split('&')
    const result: HashParams = {}
    for (const component of components) {
      const equals = component.indexOf('=')
      if (equals === -1) continue
      const key = component.slice(0, equals)
      const value = decodeURIComponent(component.slice(equals + 1))
      if (key === 'profileURL') {
        result.profileURL = value
      } else if (key === 'title') {
        result.title = value
      } else if (key === 'localProfilePath') {
        result.localProfilePath = value
      } else if (key === 'profileAccepts') {
        result.profileAccepts = value
      } else if (key === 'selection') {
        const selection = parseFunctionSelection(value)
        if (selection) result.selection = selection
      } else if (key === 'view') {
        const mode = getViewMode(value)
        if (mode !== null) {
          result.viewMode = mode
        } else {
          console.error(`Ignoring invalid view specifier: ${value}`)
        }
      }
    }
    return result
  } catch (e) {
    console.error(`Error when loading hash fragment.`)
    console.error(e)
    return {}
  }
}
