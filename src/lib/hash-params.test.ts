import {getHashParams} from './hash-params'
import {ViewMode} from './view-mode'

test('getHashParams', () => {
  expect(getHashParams('#profileURL=data:application/json;base64,e30=')).toEqual({
    profileURL: 'data:application/json;base64,e30=',
  })
  expect(getHashParams('')).toEqual({})
  expect(getHashParams('#')).toEqual({})
  expect(getHashParams('#title=hello')).toEqual({title: 'hello'})
  expect(getHashParams('#localProfilePath=file:///tmp/file.js')).toEqual({
    localProfilePath: 'file:///tmp/file.js',
  })
  expect(
    getHashParams(
      '#profileURL=https://raw.githubusercontent.com/jlfwong/speedscope/main/sample/profiles/speedscope/0.1.2/simple-sampled.speedscope.json',
    ),
  ).toEqual({
    profileURL:
      'https://raw.githubusercontent.com/jlfwong/speedscope/main/sample/profiles/speedscope/0.1.2/simple-sampled.speedscope.json',
  })
  expect(getHashParams('#title=hello&localProfilePath=file:///tmp/file.js')).toEqual({
    title: 'hello',
    localProfilePath: 'file:///tmp/file.js',
  })
  expect(getHashParams('#title=hello%20world')).toEqual({
    title: 'hello world',
  })
  expect(getHashParams('#profileAccepts=application%2Fjson')).toEqual({
    profileAccepts: 'application/json',
  })
  expect(getHashParams('#abc=bcd')).toEqual({})
  expect(getHashParams('garbage')).toEqual({})
  expect(getHashParams('#view=tracks')).toEqual({viewMode: ViewMode.MULTI_TRACK})
})
