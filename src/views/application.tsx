import '../../assets/reset.css'
import '../../assets/source-code-pro.css'

import {h} from 'preact'
import {StyleSheet, css} from 'aphrodite'

import {ProfileGroup, SymbolRemapper} from '../lib/profile'
import {profileWindowTitle} from '../lib/profile-context'
import {FontFamily, FontSize, Duration} from './style'
import {importEmscriptenSymbolMap as importEmscriptenSymbolRemapper} from '../lib/emscripten'
import {saveToFile} from '../lib/file-format'
import {ExportProgress} from '../lib/profile-export'
import {ActiveProfileState} from '../app-state/active-profile-state'
import {LeftHeavyFlamechartView, ChronoFlamechartView} from './flamechart-view-container'
import {CanvasContext} from '../gl/canvas-context'
import {Toolbar} from './toolbar'
import {importJavaScriptSourceMapSymbolRemapper} from '../lib/js-source-map'
import {Theme, withTheme} from './themes/theme'
import {ViewMode} from '../lib/view-mode'
import {canUseXHR} from '../app-state'
import {ProfileGroupState} from '../app-state/profile-group'
import {HashParams} from '../lib/hash-params'
import {StatelessComponent} from '../lib/preact-helpers'
import {SandwichViewContainer} from './sandwich-view'
import {CallTreeView} from './call-tree-view'
import {
  importProfileFile,
  importProfileBuffer,
  importProfileBase64,
  wereSymbolsLoaded,
  ImportOptions,
} from '../import/profile-loader'
import {ImportProgress} from '../import/trace-worker-protocol'

const importModule = () => import('../import')

// Force eager loading of a few code-split modules.
//
// We put them all in one place so we can directly control the relative priority
// of these.
import('source-map').then(() => {})

async function importProfilesFromText(
  fileName: string,
  contents: string,
): Promise<ProfileGroup | null> {
  return (await importModule()).importProfileGroupFromText(fileName, contents)
}

async function importProfilesFromBase64(
  fileName: string,
  contents: string,
  options?: ImportOptions,
): Promise<ProfileGroup | null> {
  return importProfileBase64(fileName, contents, options)
}

async function importProfilesFromArrayBuffer(
  fileName: string,
  contents: ArrayBuffer,
  options?: ImportOptions,
): Promise<ProfileGroup | null> {
  return importProfileBuffer(fileName, contents, options)
}

async function importProfilesFromFile(
  file: File,
  options?: ImportOptions,
): Promise<ProfileGroup | null> {
  return importProfileFile(file, options)
}
async function importFromFileSystemDirectoryEntry(entry: FileSystemDirectoryEntry) {
  return (await importModule()).importFromFileSystemDirectoryEntry(entry)
}

declare function require(x: string): any
const exampleProfileURL = require('../../sample/profiles/stackcollapse/perf-vertx-stacks-01-collapsed-all.txt')

function isFileSystemDirectoryEntry(entry: FileSystemEntry): entry is FileSystemDirectoryEntry {
  return entry != null && entry.isDirectory
}

interface GLCanvasProps {
  canvasContext: CanvasContext | null
  theme: Theme
  setGLCanvas: (canvas: HTMLCanvasElement | null) => void
}
export class GLCanvas extends StatelessComponent<GLCanvasProps> {
  private canvas: HTMLCanvasElement | null = null
  private resizing = false

  private ref = (canvas: Element | null) => {
    if (canvas instanceof HTMLCanvasElement) {
      this.canvas = canvas
    } else {
      this.canvas = null
    }

    this.props.setGLCanvas(this.canvas)
  }

  private container: HTMLElement | null = null
  private containerRef = (container: Element | null) => {
    if (container instanceof HTMLElement) {
      this.container = container
    } else {
      this.container = null
    }
  }

  private maybeResize = () => {
    if (!this.container) return
    if (!this.props.canvasContext) return
    if (this.resizing) return

    let {width, height} = this.container.getBoundingClientRect()

    const widthInAppUnits = width
    const heightInAppUnits = height
    const widthInPixels = width * window.devicePixelRatio
    const heightInPixels = height * window.devicePixelRatio

    this.resizing = true
    try {
      this.props.canvasContext.gl.resize(
        widthInPixels,
        heightInPixels,
        widthInAppUnits,
        heightInAppUnits,
      )
    } finally {
      this.resizing = false
    }
  }

  onWindowResize = () => {
    if (this.props.canvasContext) {
      this.props.canvasContext.requestFrame()
    }
  }
  componentWillReceiveProps(nextProps: GLCanvasProps) {
    if (this.props.canvasContext !== nextProps.canvasContext) {
      if (this.props.canvasContext) {
        this.props.canvasContext.removeBeforeFrameHandler(this.maybeResize)
      }
      if (nextProps.canvasContext) {
        nextProps.canvasContext.addBeforeFrameHandler(this.maybeResize)
        nextProps.canvasContext.requestFrame()
      }
    }
  }
  componentDidMount() {
    window.addEventListener('resize', this.onWindowResize)
  }
  componentWillUnmount() {
    if (this.props.canvasContext) {
      this.props.canvasContext.removeBeforeFrameHandler(this.maybeResize)
    }
    window.removeEventListener('resize', this.onWindowResize)
  }
  render() {
    const style = getStyle(this.props.theme)
    return (
      <div ref={this.containerRef} className={css(style.glCanvasView)}>
        <canvas ref={this.ref} width={1} height={1} />
      </div>
    )
  }
}

export type ApplicationProps = {
  setGLCanvas: (canvas: HTMLCanvasElement | null) => void
  setLoading: (loading: boolean) => void
  setError: (error: boolean) => void
  setProfileGroup: (profileGroup: ProfileGroup) => void
  setDragActive: (dragActive: boolean) => void
  setViewMode: (viewMode: ViewMode) => void
  setFlattenRecursion: (flattenRecursion: boolean) => void
  setProfileIndexToView: (profileIndex: number) => void
  activeProfileState: ActiveProfileState | null
  canvasContext: CanvasContext | null
  theme: Theme
  profileGroup: ProfileGroupState
  flattenRecursion: boolean
  viewMode: ViewMode
  hashParams: HashParams
  dragActive: boolean
  loading: boolean
  glCanvas: HTMLCanvasElement | null
  error: boolean
}

export class Application extends StatelessComponent<ApplicationProps> {
  private loadError = ''
  private exportController: AbortController | null = null
  private exportProgress: ExportProgress | null = null
  private importController: AbortController | null = null
  private importProgress: ImportProgress | null = null
  private importSequence = 0

  private async loadProfile(loader: (options: ImportOptions) => Promise<ProfileGroup | null>) {
    this.importController?.abort()
    const controller = new AbortController()
    this.importController = controller
    this.importProgress = null
    this.exportController?.abort()
    this.exportController = null
    this.exportProgress = null
    this.loadError = ''
    this.props.setError(false)
    this.props.setLoading(true)
    const timer = `import ${++this.importSequence}`
    console.time(timer)
    try {
      await new Promise(resolve => setTimeout(resolve, 0))
      if (controller.signal.aborted) return
      let profileGroup = await loader({
        signal: controller.signal,
        onProgress: progress => {
          if (this.importController === controller) {
            this.importProgress = progress
            this.forceUpdate()
          }
        },
      })
      if (controller.signal.aborted || this.importController !== controller) return
      if (profileGroup == null) {
        alert('Unrecognized format! See documentation about supported formats.')
        return
      } else if (!profileGroup.profiles.length) {
        alert("Successfully imported profile, but it's empty!")
        return
      }
      if (!wereSymbolsLoaded(profileGroup)) {
        for (const profile of profileGroup.profiles) await profile.demangle()
      }
      if (controller.signal.aborted || this.importController !== controller) return
      if (this.props.hashParams.title)
        profileGroup = {...profileGroup, name: this.props.hashParams.title}
      document.title = profileWindowTitle(profileGroup, this.props.hashParams.title)
      if (this.props.hashParams.viewMode !== undefined)
        this.props.setViewMode(this.props.hashParams.viewMode)
      const selected = profileGroup.profiles[profileGroup.indexToView]
      if (
        selected &&
        !selected.isChronological() &&
        (this.props.hashParams.viewMode ?? this.props.viewMode) === ViewMode.CHRONO_FLAME_CHART
      ) {
        this.props.setViewMode(ViewMode.LEFT_HEAVY_FLAME_GRAPH)
      }
      this.props.setProfileGroup(profileGroup)
    } catch (e) {
      if (controller.signal.aborted || this.importController !== controller) return
      this.loadError = e instanceof Error ? e.message : String(e)
      this.props.setError(true)
    } finally {
      console.timeEnd(timer)
      if (this.importController === controller) {
        this.importController = null
        this.importProgress = null
        this.props.setLoading(false)
      }
    }
  }

  getStyle(): ReturnType<typeof getStyle> {
    return getStyle(this.props.theme)
  }

  loadFromFile(file: File) {
    this.loadProfile(async options => {
      const profiles = await importProfilesFromFile(file, options)
      if (profiles) {
        for (let profile of profiles.profiles) {
          if (!profile.getName()) {
            profile.setName(file.name)
          }
        }
        return profiles
      }

      if (this.props.profileGroup && this.props.activeProfileState) {
        // If a profile is already loaded, it's possible the file being imported is
        // a symbol map. If that's the case, we want to parse it, and apply the symbol
        // mapping to the already loaded profile. This can be use to take an opaque
        // profile and make it readable.
        const reader = new FileReader()
        const fileContentsPromise = new Promise<string>((resolve, reject) => {
          reader.addEventListener('loadend', () => {
            if (typeof reader.result !== 'string') {
              reject(reader.error || new Error('Could not read symbol map'))
              return
            }
            resolve(reader.result)
          })
        })
        reader.readAsText(file)
        const fileContents = await fileContentsPromise

        let symbolRemapper: SymbolRemapper | null = null

        const emscriptenSymbolRemapper = importEmscriptenSymbolRemapper(fileContents)
        if (emscriptenSymbolRemapper) {
          console.log('Importing as emscripten symbol map')
          symbolRemapper = emscriptenSymbolRemapper
        }

        const jsSourceMapRemapper = await importJavaScriptSourceMapSymbolRemapper(
          fileContents,
          file.name,
        )
        if (!symbolRemapper && jsSourceMapRemapper) {
          console.log('Importing as JavaScript source map')
          symbolRemapper = jsSourceMapRemapper
        }

        if (symbolRemapper != null) {
          return {
            name: this.props.profileGroup.name || 'profile',
            sourceName: this.props.profileGroup.sourceName,
            indexToView: this.props.profileGroup.indexToView,
            profiles: this.props.profileGroup.profiles.map(profileState => {
              // We do a shallow clone here to invalidate certain caches keyed
              // on a reference to the profile group under the assumption that
              // profiles are immutable. Symbol remapping is (at time of
              // writing) the only exception to that immutability.
              const p = profileState.profile.shallowClone()
              p.remapSymbols(symbolRemapper!)
              return p
            }),
          }
        }
      }

      return null
    })
  }

  loadExample = () => {
    this.loadProfile(async () => {
      const filename = 'perf-vertx-stacks-01-collapsed-all.txt'
      const data = await fetch(exampleProfileURL).then(resp => resp.text())
      return await importProfilesFromText(filename, data)
    })
  }

  onDrop = (ev: DragEvent) => {
    this.props.setDragActive(false)
    ev.preventDefault()

    if (!ev.dataTransfer) return

    const firstItem = ev.dataTransfer.items[0]
    if ('webkitGetAsEntry' in firstItem) {
      const webkitEntry: FileSystemEntry | null = firstItem.webkitGetAsEntry()

      // Instrument.app file format is actually a directory.
      if (
        webkitEntry &&
        isFileSystemDirectoryEntry(webkitEntry) &&
        webkitEntry.name.endsWith('.trace')
      ) {
        console.log('Importing as Instruments.app .trace file')
        const webkitDirectoryEntry: FileSystemDirectoryEntry = webkitEntry
        this.loadProfile(async () => {
          return await importFromFileSystemDirectoryEntry(webkitDirectoryEntry)
        })
        return
      }
    }

    let file: File | null = ev.dataTransfer.files.item(0)
    if (file) {
      this.loadFromFile(file)
    }
  }

  onDragOver = (ev: DragEvent) => {
    this.props.setDragActive(true)
    ev.preventDefault()
  }

  onDragLeave = (ev: DragEvent) => {
    this.props.setDragActive(false)
    ev.preventDefault()
  }

  onWindowKeyPress = async (ev: KeyboardEvent) => {
    if (ev.key === '1') {
      this.props.setViewMode(
        this.props.activeProfileState?.profile.isChronological() === false
          ? ViewMode.LEFT_HEAVY_FLAME_GRAPH
          : ViewMode.CHRONO_FLAME_CHART,
      )
    } else if (ev.key === '2') {
      this.props.setViewMode(ViewMode.LEFT_HEAVY_FLAME_GRAPH)
    } else if (ev.key === '3') {
      this.props.setViewMode(ViewMode.SANDWICH_VIEW)
    } else if (ev.key === '4') {
      this.props.setViewMode(ViewMode.CALL_TREE)
    } else if (ev.key === 'r') {
      const {flattenRecursion} = this.props
      this.props.setFlattenRecursion(!flattenRecursion)
    } else if (ev.key === 'n') {
      const {activeProfileState} = this.props
      if (activeProfileState) {
        this.props.setProfileIndexToView(activeProfileState.index + 1)
      }
    } else if (ev.key === 'p') {
      const {activeProfileState} = this.props
      if (activeProfileState) {
        this.props.setProfileIndexToView(activeProfileState.index - 1)
      }
    }
  }

  private saveFile = async () => {
    if (this.props.loading || this.exportController) return
    if (this.props.profileGroup) {
      const {name, indexToView, profiles} = this.props.profileGroup
      const profileGroup: ProfileGroup = {
        name,
        indexToView,
        profiles: profiles.map(p => p.profile),
      }
      const controller = new AbortController()
      this.exportController = controller
      try {
        await saveToFile(profileGroup, {
          signal: controller.signal,
          onProgress: progress => {
            if (this.exportController === controller) {
              this.exportProgress = progress
              this.forceUpdate()
            }
          },
        })
      } catch (error) {
        if (!controller.signal.aborted) alert(`Export failed: ${String(error)}`)
      } finally {
        if (this.exportController === controller) {
          this.exportController = null
          this.exportProgress = null
          this.forceUpdate()
        }
      }
    }
  }

  private browseForFile = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.addEventListener('change', this.onFileSelect)
    input.click()
  }

  private onWindowKeyDown = async (ev: KeyboardEvent) => {
    // This has to be handled on key down in order to prevent the default
    // page save action.
    if (ev.key === 's' && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault()
      this.saveFile()
    } else if (ev.key === 'o' && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault()
      this.browseForFile()
    }
  }

  onDocumentPaste = (ev: Event) => {
    if (document.activeElement != null && document.activeElement.nodeName === 'INPUT') return

    ev.preventDefault()
    ev.stopPropagation()

    const clipboardData = (ev as ClipboardEvent).clipboardData
    if (!clipboardData) return
    const pasted = clipboardData.getData('text')
    this.loadProfile(async () => {
      return await importProfilesFromText('From Clipboard', pasted)
    })
  }

  componentDidMount() {
    window.addEventListener('keydown', this.onWindowKeyDown)
    window.addEventListener('keypress', this.onWindowKeyPress)
    document.addEventListener('paste', this.onDocumentPaste)
    this.maybeLoadHashParamProfile()
  }

  componentWillUnmount() {
    window.removeEventListener('keydown', this.onWindowKeyDown)
    this.importController?.abort()
    this.importController = null
    this.exportController?.abort()
    this.exportController = null
    window.removeEventListener('keypress', this.onWindowKeyPress)
    document.removeEventListener('paste', this.onDocumentPaste)
  }

  async maybeLoadHashParamProfile() {
    const {profileURL, profileAccepts} = this.props.hashParams
    if (profileURL) {
      if (!canUseXHR) {
        alert(
          `Cannot load a profile URL when loading from "${window.location.protocol}" URL protocol`,
        )
        return
      }
      this.loadProfile(async options => {
        options.onProgress?.({phase: 'Reading profile', canCancel: true})
        const fetchOpts: RequestInit = {signal: options.signal}
        if (profileAccepts) {
          fetchOpts['headers'] = {
            Accept: profileAccepts,
          }
        }

        const response: Response = await fetch(profileURL, fetchOpts)
        if (!response.ok) throw new Error(`Could not load profile: HTTP ${response.status}`)
        let filename = profileURL.startsWith('data:')
          ? 'profile'
          : new URL(profileURL, window.location.href).pathname
        if (filename.includes('/')) {
          filename = filename.slice(filename.lastIndexOf('/') + 1)
        }
        return await importProfilesFromArrayBuffer(filename, await response.arrayBuffer(), options)
      })
    } else if (this.props.hashParams.localProfilePath) {
      // There isn't good cross-browser support for XHR of local files, even from
      // other local files. To work around this restriction, we load the local profile
      // as a JavaScript file which will invoke a global function.
      ;(window as any)['speedscope'] = {
        loadFileFromBase64: (filename: string, base64source: string) => {
          this.loadProfile(options => importProfilesFromBase64(filename, base64source, options))
        },
      }

      const script = document.createElement('script')
      const profilePath = this.props.hashParams.localProfilePath
      script.src =
        profilePath.startsWith('file:') || profilePath.startsWith('/')
          ? profilePath
          : `file:///${profilePath.replace(/\\/g, '/')}`
      script.onerror = () => {
        this.props.setError(true)
        this.props.setLoading(false)
      }
      document.head.appendChild(script)
    }
  }

  onFileSelect = (ev: Event) => {
    const file = (ev.target as HTMLInputElement).files!.item(0)
    if (file) {
      this.loadFromFile(file)
    }
  }

  renderLanding() {
    const style = this.getStyle()

    return (
      <div className={css(style.landingContainer)}>
        <div className={css(style.landingMessage)}>
          <p className={css(style.landingP)}>
            👋 Hi there! Welcome to 🔬speedscope, an interactive{' '}
            <a
              className={css(style.link)}
              href="http://www.brendangregg.com/FlameGraphs/cpuflamegraphs.html"
            >
              flamegraph
            </a>{' '}
            visualizer. Use it to help you make your software faster.
          </p>
          {canUseXHR ? (
            <p className={css(style.landingP)}>
              Drag and drop a profile file onto this window to get started, click the big blue
              button below to browse for a profile to explore, or{' '}
              <a tabIndex={0} className={css(style.link)} onClick={this.loadExample}>
                click here
              </a>{' '}
              to load an example profile.
            </p>
          ) : (
            <p className={css(style.landingP)}>
              Drag and drop a profile file onto this window to get started, or click the big blue
              button below to browse for a profile to explore.
            </p>
          )}
          <div className={css(style.browseButtonContainer)}>
            <input
              type="file"
              name="file"
              id="file"
              onChange={this.onFileSelect}
              className={css(style.hide)}
            />
            <label for="file" className={css(style.browseButton)} tabIndex={0}>
              Browse
            </label>
          </div>

          <p className={css(style.landingP)}>
            See the{' '}
            <a
              className={css(style.link)}
              href="https://github.com/node-projects/speedscope#usage"
              target="_blank"
            >
              documentation
            </a>{' '}
            for information about supported file formats, keyboard shortcuts, and how to navigate
            around the profile.
          </p>

          <p className={css(style.landingP)}>
            speedscope is open source. Please{' '}
            <a
              className={css(style.link)}
              target="_blank"
              href="https://github.com/node-projects/speedscope/issues"
            >
              report any issues on GitHub
            </a>
            .
          </p>
        </div>
      </div>
    )
  }

  renderError() {
    const style = this.getStyle()

    return (
      <div className={css(style.error)} role="alert">
        <div>😿 Something went wrong.</div>
        <div>{this.loadError || 'Check the JS console for more details.'}</div>
      </div>
    )
  }

  renderLoadingBar() {
    const style = this.getStyle()
    if (this.importProgress)
      return (
        <section
          aria-label="Import progress"
          style={{
            height: '100%',
            padding: 24,
            boxSizing: 'border-box',
            background: this.props.theme.bgPrimaryColor,
            color: this.props.theme.fgPrimaryColor,
          }}
        >
          <p role="status">{this.importProgress.phase}…</p>
          <progress aria-label={this.importProgress.phase} />
          {this.importProgress.canCancel && (
            <button type="button" onClick={() => this.importController?.abort()}>
              Cancel import
            </button>
          )}
        </section>
      )
    return <div className={css(style.loading)} />
  }

  renderContent() {
    const {activeProfileState, error, loading, glCanvas} = this.props
    const viewMode = this.effectiveViewMode()

    if (error) {
      return this.renderError()
    }

    if (loading) {
      return this.renderLoadingBar()
    }

    if (this.exportProgress) {
      const progress = this.exportProgress
      return (
        <section
          aria-label="Export progress"
          style={{
            height: '100%',
            padding: 24,
            boxSizing: 'border-box',
            background: this.props.theme.bgPrimaryColor,
            color: this.props.theme.fgPrimaryColor,
          }}
        >
          <p role="status">
            Exporting {progress.eventsWritten.toLocaleString()} events ·{' '}
            {progress.profilesCompleted}/{progress.profileCount} profiles ·{' '}
            {progress.framesWritten.toLocaleString()}/{progress.frameCount.toLocaleString()} source
            frames
          </p>
          <progress
            aria-label="Profiles exported"
            value={progress.profilesCompleted}
            max={Math.max(1, progress.profileCount)}
          />
          <button type="button" onClick={() => this.exportController?.abort()}>
            Cancel export
          </button>
        </section>
      )
    }

    if (activeProfileState && viewMode === ViewMode.CALL_TREE) {
      return <CallTreeView profile={activeProfileState.profile} />
    }

    if (!activeProfileState || !glCanvas) {
      return this.renderLanding()
    }

    switch (viewMode) {
      case ViewMode.CHRONO_FLAME_CHART: {
        return <ChronoFlamechartView activeProfileState={activeProfileState} glCanvas={glCanvas} />
      }
      case ViewMode.LEFT_HEAVY_FLAME_GRAPH: {
        return (
          <LeftHeavyFlamechartView activeProfileState={activeProfileState} glCanvas={glCanvas} />
        )
      }
      case ViewMode.SANDWICH_VIEW: {
        return <SandwichViewContainer activeProfileState={activeProfileState} glCanvas={glCanvas} />
      }
    }
  }

  private effectiveViewMode() {
    return this.props.viewMode === ViewMode.CHRONO_FLAME_CHART &&
      this.props.activeProfileState?.profile.isChronological() === false
      ? ViewMode.LEFT_HEAVY_FLAME_GRAPH
      : this.props.viewMode
  }

  render() {
    const style = this.getStyle()
    return (
      <div
        onDrop={this.onDrop}
        onDragOver={this.onDragOver}
        onDragLeave={this.onDragLeave}
        className={css(style.root, this.props.dragActive && style.dragTargetRoot)}
      >
        <GLCanvas
          setGLCanvas={this.props.setGLCanvas}
          canvasContext={this.props.canvasContext}
          theme={this.props.theme}
        />
        <Toolbar
          saveFile={this.saveFile}
          browseForFile={this.browseForFile}
          {...(this.props as ApplicationProps)}
          loading={this.props.loading || this.exportController !== null}
          viewMode={this.effectiveViewMode()}
        />
        <div className={css(style.contentContainer)}>{this.renderContent()}</div>
        {this.props.dragActive && <div className={css(style.dragTarget)} />}
      </div>
    )
  }
}

const getStyle = withTheme(theme =>
  StyleSheet.create({
    glCanvasView: {
      position: 'absolute',
      width: '100vw',
      height: '100vh',
      zIndex: -1,
      pointerEvents: 'none',
    },
    error: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
    },
    loading: {
      height: 3,
      marginBottom: -3,
      background: theme.selectionPrimaryColor,
      transformOrigin: '0% 50%',
      animationName: [
        {
          from: {
            transform: `scaleX(0)`,
          },
          to: {
            transform: `scaleX(1)`,
          },
        },
      ],
      animationTimingFunction: 'cubic-bezier(0, 1, 0, 1)',
      animationDuration: '30s',
    },
    root: {
      width: '100vw',
      height: '100vh',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      fontFamily: FontFamily.MONOSPACE,
      lineHeight: '20px',
      color: theme.fgPrimaryColor,
    },
    dragTargetRoot: {
      cursor: 'copy',
    },
    dragTarget: {
      boxSizing: 'border-box',
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      border: `5px dashed ${theme.selectionPrimaryColor}`,
      pointerEvents: 'none',
    },
    contentContainer: {
      position: 'relative',
      display: 'flex',
      overflow: 'hidden',
      flexDirection: 'column',
      flex: 1,
    },
    landingContainer: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flex: 1,
    },
    landingMessage: {
      maxWidth: 600,
    },
    landingP: {
      marginBottom: 16,
    },
    hide: {
      display: 'none',
    },
    browseButtonContainer: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
    browseButton: {
      marginBottom: 16,
      height: 72,
      flex: 1,
      maxWidth: 256,
      textAlign: 'center',
      fontSize: FontSize.BIG_BUTTON,
      lineHeight: '72px',
      background: theme.selectionPrimaryColor,
      color: theme.altFgPrimaryColor,
      transition: `all ${Duration.HOVER_CHANGE} ease-in`,
      ':hover': {
        background: theme.selectionSecondaryColor,
      },
    },
    link: {
      color: theme.selectionPrimaryColor,
      cursor: 'pointer',
      textDecoration: 'none',
      transition: `all ${Duration.HOVER_CHANGE} ease-in`,
      ':hover': {
        color: theme.selectionSecondaryColor,
      },
    },
  }),
)
