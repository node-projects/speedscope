import {StyleSheet} from 'aphrodite'
import {FontSize, Sizes} from './style'
import {withTheme} from './themes/theme'

export const getFlamechartStyle = withTheme(theme =>
  StyleSheet.create({
    hoverCount: {
      color: theme.weightColor,
    },
    fill: {
      width: '100%',
      height: '100%',
      position: 'absolute',
      left: 0,
      top: 0,
    },
    minimap: {
      height: Sizes.MINIMAP_HEIGHT,
      borderBottom: `${Sizes.SEPARATOR_HEIGHT}px solid ${theme.fgSecondaryColor}`,
      ':focus-visible': {outline: `2px solid ${theme.fgPrimaryColor}`, outlineOffset: -2},
    },
    overviewHint: {
      position: 'absolute',
      top: 2,
      left: 5,
      padding: '1px 3px',
      fontSize: FontSize.LABEL,
      background: theme.bgPrimaryColor,
      color: theme.fgPrimaryColor,
      pointerEvents: 'none',
    },
    overviewDescription: {
      position: 'absolute',
      width: 1,
      height: 1,
      overflow: 'hidden',
      clipPath: 'inset(50%)',
      whiteSpace: 'nowrap',
    },
    panZoomView: {
      flex: 1,
    },

    detailView: {
      display: 'grid',
      height: Sizes.DETAIL_VIEW_HEIGHT,
      overflow: 'hidden',
      gridTemplateColumns: '120px 120px 1fr',
      gridTemplateRows: 'repeat(4, 1fr)',
      borderTop: `${Sizes.SEPARATOR_HEIGHT}px solid ${theme.fgSecondaryColor}`,
      fontSize: FontSize.LABEL,
      position: 'absolute',
      background: theme.bgPrimaryColor,
      width: '100vw',
      bottom: 0,
    },
    stackTraceViewPadding: {
      padding: 5,
    },
    stackTraceView: {
      height: Sizes.DETAIL_VIEW_HEIGHT,
      lineHeight: `${FontSize.LABEL + 2}px`,
      overflow: 'auto',
      '::-webkit-scrollbar': {
        background: theme.bgPrimaryColor,
      },
      '::-webkit-scrollbar-thumb': {
        background: theme.fgSecondaryColor,
        borderRadius: 20,
        border: `3px solid ${theme.bgPrimaryColor}`,
        ':hover': {
          background: theme.fgPrimaryColor,
        },
      },
    },
    stackLine: {
      whiteSpace: 'nowrap',
    },
    stackSelect: {
      color: 'inherit',
      font: 'inherit',
      background: 'transparent',
      border: 0,
      padding: 0,
      cursor: 'pointer',
      ':hover': {textDecoration: 'underline'},
      ':focus-visible': {outline: `1px solid ${theme.fgPrimaryColor}`},
    },
    stackFileLine: {
      color: theme.fgSecondaryColor,
    },
    statsTable: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gridTemplateRows: `repeat(3, ${FontSize.LABEL + 10}px)`,
      gridGap: '1px 1px',
      textAlign: 'center',
      paddingRight: 1,
    },
    statsTableHeader: {
      gridColumn: '1 / 3',
    },
    statsTableCell: {
      position: 'relative',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
    },
    thisInstanceCell: {
      background: theme.selectionPrimaryColor,
      color: theme.altFgPrimaryColor,
    },
    allInstancesCell: {
      background: theme.selectionSecondaryColor,
      color: theme.altFgPrimaryColor,
    },
    barDisplay: {
      position: 'absolute',
      top: 0,
      left: 0,
      background: 'rgba(0, 0, 0, 0.2)',
      width: '100%',
    },
  }),
)
