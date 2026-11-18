import {importFromJSSelfProfiling} from './js-self-profiling'
import {checkProfileSnapshot} from '../lib/test-utils'

test('imports JS Self-Profiling through format detection', async () => {
  await checkProfileSnapshot('./sample/profiles/js-self-profiling/simple.json')
})

const simple = {
  resources: ['app.js'],
  frames: [{name: 'main', resourceId: 0, line: 1, column: 2}],
  stacks: [{frameId: 0}],
  samples: [
    {timestamp: 0, stackId: 0},
    {timestamp: 10, stackId: 0},
  ],
}

test('uses zero-valued frame, stack and resource IDs', () => {
  const profile = importFromJSSelfProfiling(simple)
  const frame = profile.getGroupedCalltreeRoot().children[0].frame
  expect(frame.file).toBe('app.js')
  expect(frame.line).toBe(1)
  expect(frame.col).toBe(2)
  expect(profile.getTotalWeight()).toBe(10)
  expect(profile.getWeightUnit()).toBe('milliseconds')
})

test('handles empty traces and a single sample', () => {
  expect(importFromJSSelfProfiling({...simple, samples: []}).getTotalWeight()).toBe(0)
  const profile = importFromJSSelfProfiling({...simple, samples: [simple.samples[0]]})
  expect(profile.getTotalWeight()).toBe(1)
  expect(profile.getWeightUnit()).toBe('none')
})

test('rejects missing references, cyclic stacks and invalid timestamps', () => {
  expect(() => importFromJSSelfProfiling({...simple, stacks: [{frameId: 0, parentId: 0}]})).toThrow(
    'cyclic',
  )
  expect(() => importFromJSSelfProfiling({...simple, stacks: [{frameId: 2}]})).toThrow('frame ID')
  expect(() => importFromJSSelfProfiling({...simple, stacks: []})).toThrow('stack ID')
  expect(() => importFromJSSelfProfiling({...simple, resources: []})).toThrow('resource ID')
  expect(() => importFromJSSelfProfiling({...simple, samples: [{timestamp: Infinity}]})).toThrow(
    'timestamp',
  )
  expect(() =>
    importFromJSSelfProfiling({...simple, samples: [{timestamp: 1}, {timestamp: 0}]}),
  ).toThrow('out of order')
})
