import {checkProfileSnapshot, expectImportFailure} from './test-utils'
import {exportProfileGroup, importSpeedscopeProfiles} from './file-format'
import {FileFormat} from './file-format-spec'

function coloredProfile(color: unknown): FileFormat.File {
  return {
    $schema: 'https://www.speedscope.app/file-format-schema.json',
    shared: {
      frames: [
        {name: 'same function', color},
        {name: 'same function', color: '#00FF00'},
      ],
    },
    profiles: [
      {
        type: 'sampled',
        name: 'colors',
        unit: 'none',
        startValue: 0,
        endValue: 2,
        samples: [[0], [1]],
        weights: [1, 1],
      },
    ],
  } as unknown as FileFormat.File
}

test('native producer colors preserve exact RGB spelling and distinct frame identities', () => {
  const output = exportProfileGroup(importSpeedscopeProfiles(coloredProfile('#8a2BE2')))
  expect(output.shared.frames).toEqual([
    {name: 'same function', color: '#8a2BE2'},
    {name: 'same function', color: '#00FF00'},
  ])
})

test('native producer colors reject CSS expressions, alpha, short hex and nonstrings', () => {
  for (const color of ['red', '#fff', '#12345678', 'url(test)', '', '#12345G', null, 123]) {
    expect(() => importSpeedscopeProfiles(coloredProfile(color))).toThrow('RGB hex')
  }
  expect(() => importSpeedscopeProfiles(coloredProfile(undefined))).not.toThrow()
})

describe('importSpeedscopeProfiles', () => {
  test('0.0.1 evented profile', async () => {
    await checkProfileSnapshot('./sample/profiles/speedscope/0.0.1/simple.speedscope.json')
  })

  test('0.0.1 evented profile (no pretty print)', async () => {
    await checkProfileSnapshot(
      './sample/profiles/speedscope/0.0.1/simple-no-pretty-print.speedscope.json',
    )
  })

  test('0.1.2 sampled profile', async () => {
    await checkProfileSnapshot('./sample/profiles/speedscope/0.1.2/simple-sampled.speedscope.json')
  })

  test('0.6.0 multiple profiles', async () => {
    await checkProfileSnapshot('./sample/profiles/speedscope/0.6.0/two-sampled.speedscope.json')
  })

  test('invalid due to out of order events', async () => {
    // See: https://github.com/jlfwong/speedscope/issues/272
    await expectImportFailure('./sample/profiles/speedscope/invalid/out-of-order-events.json')
  })

  test('invalid due to incomplete trace', async () => {
    await expectImportFailure('./sample/profiles/speedscope/invalid/incomplete-trace.json')
  })
})
