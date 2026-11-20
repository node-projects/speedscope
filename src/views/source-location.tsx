import {h} from 'preact'
import {FrameInfo} from '../lib/profile'
import {sourceLink} from '../lib/source-links'
import {sourceLinkConfigAtom} from '../app-state/display-preferences'
import {useAtom} from '../lib/atom'

export function SourceLocation({frame}: {frame: Pick<FrameInfo, 'file' | 'line' | 'col'>}) {
  const config = useAtom(sourceLinkConfigAtom)
  if (!frame.file) return null
  const location =
    frame.file +
    (frame.line != null ? `:${frame.line}` : '') +
    (frame.col != null ? `:${frame.col}` : '')
  const href = sourceLink(frame, config)
  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open ${location}`}
      style={{color: 'inherit'}}
      onClick={ev => ev.stopPropagation()}
    >
      {location}
    </a>
  ) : (
    <span>{location}</span>
  )
}
