import {checkProfileSnapshot} from '../lib/test-utils'
import {importFromChromeHeapProfile} from './v8heapalloc'

function node(name: string, selfSize = 0) {
  return {
    callFrame: {functionName: name, url: 'file.js', lineNumber: 0, columnNumber: 0, scriptId: '1'},
    selfSize,
    children: [] as any[],
  }
}

test('deep heap trees import without recursion, materialized ancestor paths or input mutation', () => {
  const root = node('root')
  let current = root
  for (let i = 0; i < 20000; i++) {
    const child = node(`${i}`)
    current.children.push(child)
    current = child
  }
  current.selfSize = 123
  const profile = importFromChromeHeapProfile({head: root})
  expect(profile.getTotalWeight()).toBe(123)
  expect(profile.isChronological()).toBe(false)
  expect(Object.keys(root).sort()).toEqual(['callFrame', 'children', 'selfSize'])
  let count = 0
  profile.forEachFrame(() => count++)
  expect(count).toBe(20001)
})

test('empty heap branches create no unused frames, and separate imports use current symbols', () => {
  const root = node('root', 2)
  root.children.push(node('empty'), node('leaf', 3))
  const original = importFromChromeHeapProfile({head: root})
  expect(original.getTotalWeight()).toBe(5)
  let names: string[] = []
  original.forEachFrame(frame => names.push(frame.name))
  expect(names).toEqual(['root', 'leaf'])
  root.callFrame.functionName = 'changed'
  const reimported = importFromChromeHeapProfile({head: root})
  names = []
  reimported.forEachFrame(frame => names.push(frame.name))
  expect(names).toEqual(['changed', 'leaf'])
  expect(importFromChromeHeapProfile({head: node('empty')}).getTotalWeight()).toBe(0)
})

test('invalid heap weights fail clearly', () => {
  for (const weight of [-1, NaN, Infinity]) {
    expect(() => importFromChromeHeapProfile({head: node('invalid', weight)})).toThrow(
      'finite and non-negative',
    )
  }
})

test('importV8HeapAlloc from Chrome', async () => {
  await checkProfileSnapshot('./sample/profiles/Chrome/69/Heap-20181005T144546.heapprofile')
})

test('importV8HeapAlloc from NodeJS', async () => {
  await checkProfileSnapshot('./sample/profiles/node/10.11.0/Heap-20181003T105432.heapprofile')
})
