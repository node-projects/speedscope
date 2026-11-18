import {saveToFile} from './file-format'
import {StackListProfileBuilder} from './profile'

test('downloads release their object URLs after the browser has started reading', async () => {
  const create = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
  const revoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
  const revokeURL = jest.fn()
  Object.defineProperty(URL, 'createObjectURL', {configurable: true, value: () => 'blob:test'})
  Object.defineProperty(URL, 'revokeObjectURL', {configurable: true, value: revokeURL})
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  jest.useFakeTimers()
  try {
    await saveToFile(
      {name: 'test', indexToView: 0, profiles: [new StackListProfileBuilder().build()]},
      {
        yieldControl: () => Promise.resolve(),
      },
    )
    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeURL).not.toHaveBeenCalled()
    jest.advanceTimersByTime(60000)
    expect(revokeURL).toHaveBeenCalledWith('blob:test')
    expect(document.querySelector('a[download]')).toBe(null)
  } finally {
    jest.useRealTimers()
    jest.restoreAllMocks()
    if (create) Object.defineProperty(URL, 'createObjectURL', create)
    else delete (URL as any).createObjectURL
    if (revoke) Object.defineProperty(URL, 'revokeObjectURL', revoke)
    else delete (URL as any).revokeObjectURL
  }
})
