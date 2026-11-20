/** @jest-environment node */
import {StackListProfileBuilder} from './profile'
import {ByteFormatter} from './value-formatters'
import {searchProfiles} from './multi-profile-search'
import {SearchMode} from './profile-search'

function profile(name: string, key: string | number, file: string) {
  const builder = new StackListProfileBuilder()
  builder.setName(name)
  builder.appendSampleWithWeight([{key, name: 'run', file}], 7)
  return builder.build()
}
test('search finds distinct original profiles and files without combining units or weights', async () => {
  const a = profile('worker', 0, 'a.ts'),
    b = profile('other', '0', 'b.ts')
  b.setValueFormatter(new ByteFormatter())
  const derived = profile('combined', 0, 'c.ts')
  derived.setDerived(true)
  const sources = [a, derived, b]
  const result = await searchProfiles(sources, 'RUN')
  expect(result.matches.map(m => [m.profileIndex, m.profile, m.frame.key])).toEqual([
    [0, a, 0],
    [2, b, '0'],
  ])
  expect(result.matches.map(m => m.frame.getTotalWeight())).toEqual([7, 7])
  expect(result.matches.map(m => m.profile.getWeightUnit())).toEqual(['none', 'bytes'])
  expect((await searchProfiles(sources, 'run', {includeDerived: true})).matches).toHaveLength(3)
  expect(
    (await searchProfiles(sources, 'B.TS', {mode: SearchMode.EXACT})).matches[0].profileIndex,
  ).toBe(2)
  expect((await searchProfiles(sources, 'ru', {mode: SearchMode.WHOLE_WORD})).matches).toHaveLength(
    0,
  )
})
test('result caps are honest and stop scanning once a further match is found', async () => {
  const builder = new StackListProfileBuilder()
  for (let i = 0; i < 10000; i++) builder.appendSampleWithWeight([{key: i, name: 'run'}], 1)
  const source = builder.build()
  const result = await searchProfiles([source], 'run', {limit: 5})
  expect(result.matches).toHaveLength(5)
  expect(result.truncated).toBe(true)
  const exact = await searchProfiles([profile('only', 0, 'a.ts')], 'run', {limit: 1})
  expect(exact.truncated).toBe(false)
})
test('long searches yield and cancellation never returns partial results', async () => {
  const builder = new StackListProfileBuilder()
  for (let i = 0; i < 10000; i++) builder.appendSampleWithWeight([{key: i, name: `symbol${i}`}], 1)
  const controller = new AbortController()
  let pauses = 0
  await expect(
    searchProfiles([builder.build()], 'missing', {
      signal: controller.signal,
      yieldControl: async () => {
        if (++pauses === 2) controller.abort()
      },
    }),
  ).rejects.toMatchObject({name: 'AbortError'})
  expect(pauses).toBe(2)
})
