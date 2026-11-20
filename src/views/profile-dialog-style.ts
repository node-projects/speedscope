import {StyleSheet} from 'aphrodite'
import {withTheme} from './themes/theme'

export const getProfileDialogStyle = withTheme(theme =>
  StyleSheet.create({
    dialog: {
      width: 'min(640px, calc(100vw - 32px))',
      maxHeight: '90vh',
      boxSizing: 'border-box',
      overflow: 'auto',
      padding: 20,
      border: `1px solid ${theme.fgSecondaryColor}`,
      borderRadius: 6,
      background: theme.bgPrimaryColor,
      color: theme.fgPrimaryColor,
      font: '14px/1.5 system-ui, sans-serif',
      textAlign: 'left',
      '::backdrop': {background: 'rgba(0, 0, 0, 0.55)'},
    },
    form: {
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    },
    heading: {margin: 0, fontSize: 20, fontWeight: 600},
    text: {margin: 0},
    source: {margin: 0, overflowWrap: 'anywhere'},
    label: {display: 'flex', flexDirection: 'column', gap: 4},
    control: {
      font: 'inherit',
      color: theme.fgPrimaryColor,
      background: theme.bgSecondaryColor,
      border: `1px solid ${theme.fgSecondaryColor}`,
      padding: 6,
      ':disabled': {opacity: 0.5},
    },
    textarea: {resize: 'vertical'},
    buttons: {display: 'flex', gap: 8, justifyContent: 'flex-end'},
  }),
)
