import {h} from 'preact'
import {StyleSheet, css} from 'aphrodite'
import {FrameInfo} from '../lib/profile'
import {SourceLocation} from './source-location'
import {useTheme, withTheme} from './themes/theme'

export function SelectedFrameDetails({frame}: {frame: FrameInfo}) {
  const style = getStyle(useTheme())
  return (
    <section aria-label="Selected function details" className={css(style.panel)}>
      <strong>{frame.name}</strong>
      <div>{frame.file ? <SourceLocation frame={frame} /> : 'Source location unavailable'}</div>
    </section>
  )
}
const getStyle = withTheme(theme =>
  StyleSheet.create({
    panel: {
      flexShrink: 0,
      maxHeight: 120,
      overflow: 'auto',
      overflowWrap: 'anywhere',
      padding: 6,
      color: theme.fgPrimaryColor,
      background: theme.bgPrimaryColor,
      borderBottom: `1px solid ${theme.fgSecondaryColor}`,
      fontSize: 12,
    },
  }),
)
