/** @jest-environment node */
import {
  TraceEventDiagnostics,
  diagnosticFrameKey,
  TRACE_EVENT_DIAGNOSTIC_EXAMPLES_PER_KIND,
  TRACE_EVENT_DIAGNOSTIC_KEY_LENGTH,
} from './trace-event-diagnostics'
import {importTraceEvents} from './trace-event'
import {exportProfileGroup} from '../lib/file-format'

const kinds = ['empty-stack', 'name-mismatch', 'argument-mismatch', 'open-at-eof'] as const

test('diagnostic quotas bound lazy examples in every category and flush exactly once', () => {
  const warn = jest.spyOn(console, 'warn')
  warn.mockImplementation(() => {})
  try {
    const diagnostics = new TraceEventDiagnostics()
    const format = jest.fn(() => 'example')
    for (const kind of kinds)
      for (let index = 0; index < 10000; index++) diagnostics.warn(kind, format)
    expect(format).toHaveBeenCalledTimes(4 * TRACE_EVENT_DIAGNOSTIC_EXAMPLES_PER_KIND)
    expect(warn).toHaveBeenCalledTimes(8)
    diagnostics.flush()
    expect(warn).toHaveBeenCalledTimes(9)
    for (const kind of kinds)
      expect(
        warn.mock.calls.filter(call => String(call[0]).startsWith(`[Trace Event: ${kind}]`)),
      ).toHaveLength(2)
    expect(warn.mock.calls[8][0]).toBe(
      'Trace Event import diagnostics: empty-stack=10000, name-mismatch=10000, argument-mismatch=10000, open-at-eof=10000. 39992 additional examples suppressed.',
    )
    diagnostics.flush()
    expect(warn).toHaveBeenCalledTimes(9)
  } finally {
    warn.mockRestore()
  }
})

test('diagnostic keys and prefix-inclusive example messages are bounded', () => {
  const key = 'SQL 😀 '.repeat(20000)
  expect(diagnosticFrameKey(key).length).toBeLessThanOrEqual(TRACE_EVENT_DIAGNOSTIC_KEY_LENGTH)
  expect(diagnosticFrameKey(key).startsWith('SQL')).toBe(true)
  expect(diagnosticFrameKey(42)).toBe('42')
  expect(diagnosticFrameKey('short')).toBe('short')
  expect(diagnosticFrameKey('a\nb\rc\t\u2028\u2029\u0085')).toBe(
    'a\\u000ab\\u000dc\\u0009\\u2028\\u2029\\u0085',
  )
  const controls = diagnosticFrameKey('\n\u0085\u2028'.repeat(100000))
  expect(controls.length).toBeLessThanOrEqual(TRACE_EVENT_DIAGNOSTIC_KEY_LENGTH)
  expect(controls).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/)
  const warn = jest.spyOn(console, 'warn')
  warn.mockImplementation(() => {})
  try {
    const diagnostics = new TraceEventDiagnostics()
    diagnostics.warn('name-mismatch', () => key)
    expect(String(warn.mock.calls[0][0]).length).toBeLessThanOrEqual(2048)
  } finally {
    warn.mockRestore()
  }
})

function malformedThreads() {
  const threads = Array.from({length: 3}, (_, tid) => [
    {ph: 'E', ts: 0, name: 'empty', pid: 1, tid},
    {ph: 'B', ts: 1, name: 'outer', args: {version: 1}, pid: 1, tid},
    {ph: 'E', ts: 2, name: 'wrong', pid: 1, tid},
    {ph: 'E', ts: 3, name: 'outer', args: {version: 2}, pid: 1, tid},
    {ph: 'B', ts: 4, name: 'open', pid: 1, tid},
    {ph: 'X', ts: 5, dur: 1, name: 'tick', pid: 1, tid},
  ])
  return ([] as (typeof threads)[number][number][]).concat(...threads)
}

test('imports share quotas across threads, reset per recording and preserve recovery geometry and exports', () => {
  const warn = jest.spyOn(console, 'warn')
  warn.mockImplementation(() => {})
  try {
    const group = importTraceEvents(malformedThreads())
    const output = exportProfileGroup(group)
    expect(group.profiles).toHaveLength(3)
    for (const profile of group.profiles) {
      expect(profile.getTotalWeight()).toBe(6)
      expect(profile.getTimelineOrigin()).toEqual({clock: 'trace-event:wall', start: 0})
      expect(
        Array.from(profile.getCallEvents(), event => [
          event.open,
          event.node.frame.name,
          event.value,
        ]),
      ).toEqual([
        [true, 'outer {"version":1}', 1],
        [false, 'outer {"version":1}', 3],
        [true, 'open', 4],
        [true, 'tick', 5],
        [false, 'tick', 6],
        [false, 'open', 6],
      ])
    }
    expect(warn).toHaveBeenCalledTimes(9)
    expect(warn.mock.calls[8][0]).toBe(
      'Trace Event import diagnostics: empty-stack=3, name-mismatch=3, argument-mismatch=3, open-at-eof=3. 4 additional examples suppressed.',
    )
    const firstCalls = warn.mock.calls.map(call => call[0])
    warn.mockClear()
    expect(exportProfileGroup(importTraceEvents(malformedThreads()))).toEqual(output)
    expect(warn.mock.calls.map(call => call[0])).toEqual(firstCalls)
    expect(output.shared.frames.map(frame => frame.name)).toEqual([
      'outer {"version":1}',
      'open',
      'tick',
      'outer {"version":1}',
      'open',
      'tick',
      'outer {"version":1}',
      'open',
      'tick',
    ])
  } finally {
    warn.mockRestore()
  }
})

test('clean imports and unused diagnostic instances emit no summaries', () => {
  const warn = jest.spyOn(console, 'warn')
  warn.mockImplementation(() => {})
  try {
    const diagnostics = new TraceEventDiagnostics()
    diagnostics.flush()
    diagnostics.flush()
    const events = [{ph: 'X', ts: 0, dur: 5, name: 'work'}]
    importTraceEvents(events)
    expect(warn).not.toHaveBeenCalled()
  } finally {
    warn.mockRestore()
  }
})
