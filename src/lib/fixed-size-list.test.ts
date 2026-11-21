import {createRowIndexLookup, fixedSizeListRange} from './fixed-size-list'

test('fixed-row ranges stay bounded at the start, middle, end and after a filter shrinks rows', () => {
  expect(fixedSizeListRange(0, 20, 100, 0)).toEqual({
    firstVisibleIndex: 0,
    lastVisibleIndex: -1,
    invisiblePrefixSize: 0,
  })
  expect(fixedSizeListRange(1_000_000_000, 20, 100, 10_000_000_000)).toEqual({
    firstVisibleIndex: 499_999_998,
    lastVisibleIndex: 500_000_006,
    invisiblePrefixSize: 9_999_999_960,
  })
  expect(fixedSizeListRange(100, 20, 100, Infinity)).toEqual({
    firstVisibleIndex: 93,
    lastVisibleIndex: 99,
    invisiblePrefixSize: 1860,
  })
  expect(fixedSizeListRange(3, 20, 100, 1900)).toEqual({
    firstVisibleIndex: 0,
    lastVisibleIndex: 2,
    invisiblePrefixSize: 0,
  })
  expect(fixedSizeListRange(100, 20, 100, -50).firstVisibleIndex).toBe(0)
})

test('range arithmetic includes every viewport row and at most quarter-viewport overscan', () => {
  for (const count of [1, 3, 30, 1000]) {
    for (const height of [0, 1, 40, 95, 100]) {
      for (const requestedOffset of [0, 1, 19, 20, 93, count * 20]) {
        const offset = Math.max(0, Math.min(requestedOffset, Math.max(0, count * 20 - height)))
        const range = fixedSizeListRange(count, 20, height, requestedOffset)
        for (let i = 0; i < count; i++) {
          if (i * 20 < offset + height && (i + 1) * 20 > offset) {
            expect(range.firstVisibleIndex).toBeLessThanOrEqual(i)
            expect(range.lastVisibleIndex).toBeGreaterThanOrEqual(i)
          }
        }
        expect(range.lastVisibleIndex - range.firstVisibleIndex + 1).toBeLessThanOrEqual(
          Math.ceil((height * 1.5) / 20) + 1,
        )
      }
    }
  }
})

test('near-bottom selection and adjacent search navigation scan only once and retain no index map', () => {
  const rows = Array.from({length: 100_000}, (_, id) => ({id}))
  const scan = jest.spyOn(rows, 'indexOf')
  const lookup = createRowIndexLookup(rows)
  expect(scan).not.toHaveBeenCalled()
  expect(lookup(rows[99_990])).toBe(99_990)
  expect(scan).toHaveBeenCalledTimes(1)
  for (let i = 0; i < 20; i++) expect(lookup(rows[99_990])).toBe(99_990)
  for (let i = 99_991; i < rows.length; i++) expect(lookup(rows[i])).toBe(i)
  for (let i = 99_998; i >= 99_990; i--) expect(lookup(rows[i])).toBe(i)
  expect(scan).toHaveBeenCalledTimes(1)
  for (let i = 99_991; i < rows.length; i++) expect(lookup(rows[i])).toBe(i)
  expect(lookup(rows[0])).toBe(0)
  expect(lookup(rows[rows.length - 1])).toBe(rows.length - 1)
  expect(scan).toHaveBeenCalledTimes(1)
  const absent = {id: -1}
  expect(lookup(absent)).toBe(null)
  expect(lookup(absent)).toBe(null)
  expect(scan).toHaveBeenCalledTimes(2)
  const reordered = [...rows].reverse()
  expect(createRowIndexLookup(reordered)(rows[99_990])).toBe(9)
})
