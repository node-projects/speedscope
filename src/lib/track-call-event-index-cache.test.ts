import {StackListProfileBuilder} from './profile'
import {
  TrackCallEventIndexCache,
  MAX_TRACK_CALL_EVENT_INDICES,
} from './track-call-event-index-cache'

function profile(name: string) {
  const builder = new StackListProfileBuilder()
  builder.appendSampleWithWeight([{key: name, name}], 1)
  return builder.build()
}

test('a session LRU reuses completed indices, touches recent entries and never retains more than32 profiles', async () => {
  const cache = new TrackCallEventIndexCache()
  const profiles = Array.from({length: MAX_TRACK_CALL_EVENT_INDICES + 1}, (_, i) =>
    profile(String(i)),
  )
  const builds = profiles.map(input => jest.spyOn(input, 'createCallEventRangeIndex'))
  const first = await cache.get(profiles[0])
  for (let i = 1; i < MAX_TRACK_CALL_EVENT_INDICES; i++) await cache.get(profiles[i])
  expect(cache.size).toBe(32)
  expect(await cache.get(profiles[0])).toBe(first)
  await cache.get(profiles[32])
  expect(cache.size).toBe(32)
  await cache.get(profiles[1])
  expect(builds[1]).toHaveBeenCalledTimes(2)
  expect(builds[0]).toHaveBeenCalledTimes(1)
  cache.clear()
  expect(cache.size).toBe(0)
})

test('clearing a session invalidates pending builds and cannot restore references to a replaced recording', async () => {
  const input = profile('old')
  const index = await input.createCallEventRangeIndex()
  let complete!: (value: typeof index) => void
  jest.spyOn(input, 'createCallEventRangeIndex').mockImplementation(
    () =>
      new Promise(resolve => {
        complete = resolve
      }),
  )
  const cache = new TrackCallEventIndexCache()
  const pending = cache.get(input)
  cache.clear()
  complete(index)
  await expect(pending).rejects.toMatchObject({name: 'AbortError'})
  expect(cache.size).toBe(0)
  await cache.get(profile('new'))
  expect(cache.size).toBe(1)
})

test('aborted requests neither construct nor touch cached indices', async () => {
  const input = profile('sample')
  const build = jest.spyOn(input, 'createCallEventRangeIndex')
  const cache = new TrackCallEventIndexCache()
  const controller = new AbortController()
  controller.abort()
  await expect(cache.get(input, {signal: controller.signal})).rejects.toMatchObject({
    name: 'AbortError',
  })
  expect(build).not.toHaveBeenCalled()
  const index = await cache.get(input)
  await expect(cache.get(input, {signal: controller.signal})).rejects.toMatchObject({
    name: 'AbortError',
  })
  expect(await cache.get(input)).toBe(index)
  expect(build).toHaveBeenCalledTimes(1)
})
