import {profileWindowTitle, sourceFileName, weightPercentage} from './profile-context'
import {formatPercent} from './utils'

test('window titles distinguish the loaded file from internal recording and thread names', () => {
  expect(profileWindowTitle({name: 'recording', sourceName: 'capture.json'})).toBe(
    'capture.json — recording - speedscope',
  )
  expect(profileWindowTitle({name: 'capture.json', sourceName: 'capture.json'})).toBe(
    'capture.json - speedscope',
  )
  expect(
    profileWindowTitle({name: 'recording', sourceName: 'capture.json'}, 'Custom session'),
  ).toBe('Custom session - speedscope')
  expect(profileWindowTitle({name: 'recording'})).toBe('recording - speedscope')
  expect(profileWindowTitle({name: ''})).toBe('profile - speedscope')
})
test('runtime filename metadata retains the leaf only and limits display size', () => {
  expect(sourceFileName('C:\\private\\work\\PLC.trace.gz')).toBe('PLC.trace.gz')
  expect(sourceFileName('/private/capture 雪.json')).toBe('capture 雪.json')
  expect(sourceFileName('/private/capture.trace/')).toBe('capture.trace')
  expect(sourceFileName('bad\nname\u0000.json')).toBe('badname.json')
  expect(sourceFileName('a'.repeat(5000)).length).toBe(1024)
})
test('weight percentages handle empty profiles and finite extreme values', () => {
  expect(weightPercentage(0, 0)).toBe(0)
  expect(weightPercentage(5, 0)).toBe(0)
  expect(weightPercentage(Number.MAX_VALUE / 2, Number.MAX_VALUE)).toBe(50)
  expect(weightPercentage(3, 2)).toBe(150)
  expect(weightPercentage(NaN, 2)).toBe(0)
  expect(formatPercent(weightPercentage(0, 0))).toBe('0%')
  expect(formatPercent(0.001)).toBe('<0.01%')
})
