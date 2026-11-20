import {FrameInfo} from './profile'

export interface SourceLinkConfig {
  editor: 'vscode' | 'vscode-insiders' | 'web'
  template: string
  fromPrefix: string
  toPrefix: string
}
export const defaultSourceLinkConfig: SourceLinkConfig = {
  editor: 'vscode',
  template: 'https://github.com/owner/repository/blob/main/{file}#L{line}',
  fromPrefix: '',
  toPrefix: '',
}
export function validateSourceLinkConfig(value: unknown): SourceLinkConfig {
  const config = value as SourceLinkConfig | null
  if (
    !config ||
    !['vscode', 'vscode-insiders', 'web'].includes(config.editor) ||
    typeof config.template !== 'string' ||
    typeof config.fromPrefix !== 'string' ||
    typeof config.toPrefix !== 'string' ||
    config.template.length > 2048 ||
    config.fromPrefix.length > 4096 ||
    config.toPrefix.length > 4096
  )
    throw new Error('Invalid source-link settings')
  if (config.editor === 'web') {
    if (
      !config.template.includes('{file}') ||
      /[{}]/.test(config.template.replace(/\{(?:file|line|column)\}/g, ''))
    )
      throw new Error('Use {file}, {line} and {column} placeholders; {file} is required')
    const authority = config.template.match(/^https?:\/\/([^/?#]*)/i)?.[1]
    if (!authority || /[{}]/.test(authority)) throw new Error('Use a fixed HTTP or HTTPS host')
    const url = new URL(
      config.template.replace(/\{file\}/g, 'example.ts').replace(/\{(?:line|column)\}/g, '1'),
    )
    if (url.username || url.password) throw new Error('Use a web URL without embedded credentials')
  }
  return {...config}
}

function normalizePath(path: string): string {
  if (/^file:\/\//i.test(path)) {
    try {
      const url = new URL(path)
      path = (url.hostname ? `//${url.hostname}` : '') + decodeURIComponent(url.pathname)
      if (/^\/[a-z]:\//i.test(path)) path = path.slice(1)
    } catch {
      return ''
    }
  }
  return path.replace(/\\/g, '/')
}
export function mappedSourcePath(path: string, config: SourceLinkConfig): string | null {
  path = normalizePath(path)
  const cleanPrefix = (value: string) => {
    const normalized = normalizePath(value)
    return /^\/+$/.test(normalized) ? '/' : normalized.replace(/\/+$/, '')
  }
  const prefix = cleanPrefix(config.fromPrefix)
  const target = cleanPrefix(config.toPrefix)
  if (!path) return null
  let suffix = path
  if (prefix) {
    const windows = /^[a-z]:\//i.test(path) || path.startsWith('//')
    const compare = windows ? path.toLowerCase() : path
    const expected = windows ? prefix.toLowerCase() : prefix
    if (compare !== expected && !compare.startsWith(expected === '/' ? '/' : expected + '/'))
      return null
    suffix = path.slice(prefix.length).replace(/^\/+/, '')
  }
  if (target) return (target === '/' ? '/' : target + '/') + suffix.replace(/^\/+/, '')
  return prefix ? suffix : path
}
export function sourceLink(
  frame: Pick<FrameInfo, 'file' | 'line' | 'col'>,
  config: SourceLinkConfig | null,
): string | null {
  if (!config || !frame.file || frame.file.length > 4096) return null
  try {
    config = validateSourceLinkConfig(config)
    const path = mappedSourcePath(frame.file, config)
    if (!path) return null
    const coordinate = (n?: number) => (n !== undefined && Number.isSafeInteger(n) && n > 0 ? n : 1)
    const line = coordinate(frame.line),
      column = coordinate(frame.col)
    const encoded = path
      .split('/')
      .map((part, i) =>
        config!.editor !== 'web' && i === 0 && /^[a-z]:$/i.test(part)
          ? part
          : encodeURIComponent(part),
      )
      .join('/')
    let result: string
    if (config.editor === 'web') {
      result = config.template
        .replace(/\{file\}/g, encoded.replace(/^\/+/, ''))
        .replace(/\{line\}/g, String(line))
        .replace(/\{column\}/g, String(column))
      const url = new URL(result)
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null
    } else {
      if (!path.startsWith('/') && !/^[a-z]:\//i.test(path)) return null
      result = `${config.editor}://file${
        encoded.startsWith('/') ? '' : '/'
      }${encoded}:${line}:${column}`
    }
    return result.length <= 8192 ? result : null
  } catch {
    return null
  }
}
