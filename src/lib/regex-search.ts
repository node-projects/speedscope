import {RE2JS} from 're2js'

export const REGEX_SEARCH_LIMITS = {patternCharacters: 256, expandedSize: 4096, repeatCount: 1000}

// Conservative preflight before RE2JS expands counted repetitions. It estimates
// instruction cost, not matching semantics; RE2JS remains the syntax authority.
function checkExpansion(pattern: string) {
  const groups = [{sum: 0, last: 0}]
  const add = (cost: number) => {
    const current = groups[groups.length - 1]
    current.sum += cost
    current.last = cost
    if (current.sum > REGEX_SEARCH_LIMITS.expandedSize)
      throw new Error('Regex expansion exceeds 4,096 states; simplify counted repetitions')
  }
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]
    if (ch === '\\') {
      i++
      if (pattern[i] === 'Q') {
        const end = pattern.indexOf('\\E', i + 1)
        const stop = end < 0 ? pattern.length : end
        add(Math.max(1, stop - i - 1))
        i = end < 0 ? pattern.length : end + 1
      } else {
        if (['p', 'P', 'x'].includes(pattern[i]) && pattern[i + 1] === '{') {
          const end = pattern.indexOf('}', i + 2)
          if (end >= 0) i = end
        }
        add(1)
      }
    } else if (ch === '[') {
      // Never interpret escaped brackets or quantifier-looking class content.
      if (pattern[i + 1] === '^') i++
      if (pattern[i + 1] === ']') i++
      while (++i < pattern.length) {
        if (pattern[i] === '\\') i++
        else if (pattern[i] === ']') break
      }
      add(1)
    } else if (ch === '(') groups.push({sum: 0, last: 0})
    else if (ch === ')' && groups.length > 1) add(groups.pop()!.sum + 2)
    else if (ch === '{') {
      const match = /^\{([0-9]+)(?:,([0-9]*))?\}/.exec(pattern.slice(i))
      if (!match) {
        add(1)
        continue
      }
      const low = Number(match[1])
      const high = match[2] === undefined ? low : match[2] === '' ? low + 1 : Number(match[2])
      if (low > REGEX_SEARCH_LIMITS.repeatCount || high > REGEX_SEARCH_LIMITS.repeatCount)
        throw new Error('Regex repetition exceeds 1,000; use a simpler expression')
      const current = groups[groups.length - 1]
      const cost = current.last * Math.max(1, high) + 2
      current.sum -= current.last
      add(cost)
      i += match[0].length - 1
    } else if (ch === '*' || ch === '+' || ch === '?') {
      const current = groups[groups.length - 1]
      current.sum += 2
      current.last += 2
      if (current.sum > REGEX_SEARCH_LIMITS.expandedSize)
        throw new Error('Regex expansion exceeds 4,096 states')
    } else add(1)
  }
  if (groups.some(group => group.sum > REGEX_SEARCH_LIMITS.expandedSize))
    throw new Error('Regex expansion exceeds 4,096 states')
}

let cached: {pattern: string; regex: RE2JS} | null = null
export function compileSearchRegex(pattern: string): RE2JS {
  if (pattern.length > REGEX_SEARCH_LIMITS.patternCharacters)
    throw new Error('Use at most 256 regex characters')
  if (cached?.pattern === pattern) return cached.regex
  checkExpansion(pattern)
  const regex = RE2JS.compile(pattern, RE2JS.CASE_INSENSITIVE)
  if (regex.programSize() > REGEX_SEARCH_LIMITS.expandedSize)
    throw new Error('Regex program exceeds 4,096 states; simplify the expression')
  cached = {pattern, regex}
  return regex
}
