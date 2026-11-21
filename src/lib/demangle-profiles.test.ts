/** @jest-environment node */
import {CallTreeProfileBuilder} from './profile'
import {demangleProfiles} from './demangle-profiles'
import {DemangleDiagnostics} from './demangle/demangle-diagnostics'
import {loadDemangling} from './demangle'

jest.mock('./demangle', () => ({
  loadDemangling: jest.fn(async (onFailure?: (name: string) => void) => (name: string) => {
    if (name.startsWith('_Zfail')) {
      onFailure?.(name)
      return name
    }
    return `decoded ${name}`
  }),
}))

const load = loadDemangling as jest.Mock

function profile(names: string[]) {
  const builder = new CallTreeProfileBuilder()
  names.forEach((name, index) => {
    const frame = {key: index, name}
    builder.enterFrame(frame, index * 2)
    builder.leaveFrame(frame, index * 2 + 1)
  })
  return builder.build()
}

beforeEach(() => load.mockClear())

test('recording-wide failure diagnostics preserve names, call geometry and weights', async () => {
  const profiles = Array.from({length: 3}, () => profile(['_Zfail0', '_Zfail1', '_Zfail2']))
  const before = profiles.map(item =>
    Array.from(item.getCallEvents(), event => [event.open, event.node.frame.name, event.value]),
  )
  const warn = jest.spyOn(console, 'warn')
  warn.mockImplementation(() => {})
  try {
    await demangleProfiles(profiles)
    expect(warn).toHaveBeenCalledTimes(3)
    expect(warn.mock.calls[2][0]).toBe(
      'Demangling preserved 9 symbol observations after native or cached decoding failures; 7 additional examples suppressed.',
    )
    expect(profiles.map(item => item.getTotalWeight())).toEqual([5, 5, 5])
    expect(
      profiles.map(item =>
        Array.from(item.getCallEvents(), event => [event.open, event.node.frame.name, event.value]),
      ),
    ).toEqual(before)
    warn.mockClear()
    await demangleProfiles(profiles)
    expect(warn).toHaveBeenCalledTimes(3)
  } finally {
    warn.mockRestore()
  }
})

test('long symbol traversal yields and cancellation stops before later frames and profiles', async () => {
  const now = jest.spyOn(Date, 'now')
  now.mockReturnValue(0)
  try {
    const first = profile(Array.from({length: 9000}, (_, index) => `_Zwork${index}`))
    const second = profile(['_Zlater'])
    const controller = new AbortController()
    const yieldControl = jest.fn(async () => controller.abort())
    await expect(
      demangleProfiles([first, second], {signal: controller.signal, yieldControl}),
    ).rejects.toMatchObject({name: 'AbortError'})
    expect(yieldControl).toHaveBeenCalledTimes(1)
    const names = Array.from(first.getFrames(), frame => frame.name)
    expect(names.slice(0, 4096).every(name => name.startsWith('decoded '))).toBe(true)
    expect(names[4096]).toBe('_Zwork4096')
    expect(Array.from(second.getFrames(), frame => frame.name)).toEqual(['_Zlater'])
  } finally {
    now.mockRestore()
  }
})

test('pre-cancelled and ordinary profiles do not initialize the native decoder', async () => {
  const item = profile(['ordinary'])
  const controller = new AbortController()
  controller.abort()
  await expect(demangleProfiles([item], {signal: controller.signal})).rejects.toMatchObject({
    name: 'AbortError',
  })
  await demangleProfiles([item])
  expect(load).not.toHaveBeenCalled()
})

test('many small profiles yield browser tasks and stop before later profiles on cancellation', async () => {
  const now = jest.spyOn(Date, 'now')
  now.mockReturnValue(0)
  try {
    const profiles = Array.from({length: 300}, (_, index) => profile([`_Zsmall${index}`]))
    const controller = new AbortController()
    const yieldControl = jest.fn(async () => controller.abort())
    await expect(
      demangleProfiles(profiles, {signal: controller.signal, yieldControl}),
    ).rejects.toMatchObject({name: 'AbortError'})
    expect(yieldControl).toHaveBeenCalledTimes(1)
    expect(Array.from(profiles[255].getFrames(), frame => frame.name)).toEqual([
      'decoded _Zsmall255',
    ])
    expect(Array.from(profiles[256].getFrames(), frame => frame.name)).toEqual(['_Zsmall256'])
  } finally {
    now.mockRestore()
  }
})

test('elapsed work between small profiles yields before the count fallback', async () => {
  const now = jest.spyOn(Date, 'now')
  now.mockReturnValueOnce(0).mockReturnValue(8)
  try {
    const item = profile(['_Zsmall'])
    const controller = new AbortController()
    const yieldControl = jest.fn(async () => controller.abort())
    await expect(
      demangleProfiles([item], {signal: controller.signal, yieldControl}),
    ).rejects.toMatchObject({name: 'AbortError'})
    expect(Array.from(item.getFrames(), frame => frame.name)).toEqual(['_Zsmall'])
  } finally {
    now.mockRestore()
  }
})

test('native initialization failures remain visible to the caller', async () => {
  const error = new Error('Native initialization failed')
  load.mockRejectedValueOnce(error)
  const item = profile(['_Zwork'])
  await expect(demangleProfiles([item])).rejects.toBe(error)
  expect(Array.from(item.getFrames(), frame => frame.name)).toEqual(['_Zwork'])
})

test('failure examples escape controls and bound formatting; summaries are idempotent', () => {
  const warn = jest.spyOn(console, 'warn')
  warn.mockImplementation(() => {})
  try {
    const diagnostics = new DemangleDiagnostics()
    diagnostics.warn('_Zline\n\u0085\u2028\u2029')
    diagnostics.warn('_Z' + '\n'.repeat(100000))
    for (let index = 0; index < 10000; index++) diagnostics.warn('_Zother')
    diagnostics.flush()
    diagnostics.flush()
    expect(warn).toHaveBeenCalledTimes(3)
    expect(String(warn.mock.calls[0][0])).toContain('\\u000a\\u0085\\u2028\\u2029')
    for (const call of warn.mock.calls) {
      expect(String(call[0]).length).toBeLessThanOrEqual(600)
      expect(String(call[0])).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/)
    }
    expect(warn.mock.calls[2][0]).toContain('10002 symbol observations')
  } finally {
    warn.mockRestore()
  }
})
