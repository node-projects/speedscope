import {h, render} from 'preact'
import {act} from 'preact/test-utils'
import {StackListProfileBuilder} from '../lib/profile'
import {compareProfiles, ComparisonNode} from '../lib/profile-comparison'
import {ProfileComparisonGraph, comparisonNodeDescription} from './profile-comparison-graph'

let host: HTMLDivElement
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
})
afterEach(() => {
  act(() => render(null, host))
  host.remove()
})
function profile(values: [string[], number][]) {
  const builder = new StackListProfileBuilder()
  for (const [names, value] of values)
    builder.appendSampleWithWeight(
      names.map(name => ({key: name, name, file: 'app.ts', line: 10})),
      value,
    )
  return builder.build()
}

test('comparison tiles show signed colors and accessible baseline/candidate/self/total details', async () => {
  const baseline = profile([
    [['increase'], 2],
    [['decrease'], 8],
    [['same'], 3],
  ])
  const candidate = profile([
    [['increase'], 5],
    [['decrease'], 4],
    [['same'], 3],
  ])
  const model = await compareProfiles(baseline, candidate, {mode: 'absolute'})
  const select = jest.fn(),
    drill = jest.fn()
  act(() =>
    render(<ProfileComparisonGraph model={model} onSelect={select} onDrill={drill} />, host),
  )
  const increased = model.nodes.find(node => node.frame?.name === 'increase')!
  const decreased = model.nodes.find(node => node.frame?.name === 'decrease')!
  const unchanged = model.nodes.find(node => node.frame?.name === 'same')!
  const tile = (node: ComparisonNode) =>
    host.querySelector<HTMLButtonElement>(`[data-comparison-node="${node.id}"]`)!
  expect(tile(increased).getAttribute('data-change')).toBe('increase')
  expect(tile(decreased).getAttribute('data-change')).toBe('decrease')
  expect(tile(unchanged).getAttribute('data-change')).toBe('unchanged')
  expect(tile(increased).title).toContain('Baseline total: 2; self: 2')
  expect(tile(increased).title).toContain('Candidate total: 5; self: 5')
  expect(tile(increased).title).toContain('Delta total: +3; self: +3')
  expect(tile(increased).getAttribute('aria-label')).toBe(tile(increased).title)
  act(() => tile(increased).click())
  expect(select).toHaveBeenCalledWith(increased)
  act(() => {
    tile(increased).dispatchEvent(new MouseEvent('dblclick', {bubbles: true}))
  })
  expect(drill).toHaveBeenCalledWith(increased)
  act(() =>
    render(
      <ProfileComparisonGraph
        model={model}
        selectedNode={increased}
        onSelect={select}
        onDrill={drill}
      />,
      host,
    ),
  )
  expect(tile(increased).getAttribute('aria-pressed')).toBe('true')
  expect(host.textContent).toContain('not elapsed time')
})

test('normalized descriptions distinguish proportions and signed percentage-point changes', async () => {
  const model = await compareProfiles(
    profile([
      [['work'], 5],
      [['other'], 5],
    ]),
    profile([
      [['work'], 15],
      [['other'], 5],
    ]),
    {mode: 'normalized'},
  )
  const node = model.nodes.find(value => value.frame?.name === 'work')!
  expect(comparisonNodeDescription(model, node)).toContain('Baseline total: 50.00%')
  expect(comparisonNodeDescription(model, node)).toContain('Candidate total: 75.00%')
  expect(comparisonNodeDescription(model, node)).toContain('Delta total: +25.00 percentage points')
})

test('narrow comparison tiles retain their envelope width without padding or border minimums', async () => {
  const source = profile([
    [['large'], 998],
    [['tiny'], 2],
  ])
  const model = await compareProfiles(source, source, {mode: 'absolute'})
  act(() =>
    render(<ProfileComparisonGraph model={model} onSelect={() => {}} onDrill={() => {}} />, host),
  )
  const tiny = model.nodes.find(node => node.frame?.name === 'tiny')!
  const tile = host.querySelector<HTMLButtonElement>(`[data-comparison-node="${tiny.id}"]`)!
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(parseFloat(tile.style.width)).toBeCloseTo(0.2)
  const computed = getComputedStyle(tile)
  expect(computed.paddingLeft).toBe('0px')
  expect(computed.paddingRight).toBe('0px')
  // jsdom serializes border:none as an empty side style.
  expect(['', 'none']).toContain(computed.borderTopStyle)
  expect(tile.children.length).toBe(0)
  expect(tile.getAttribute('aria-label')).toContain('Baseline total: 2')
})

test('deep comparison graphs mount only viewport rows and reveal deeper rows on scroll', async () => {
  const names = Array.from({length: 300}, (_, index) => `depth${index}`)
  const source = profile([[names, 1]])
  const model = await compareProfiles(source, source, {mode: 'absolute'})
  act(() =>
    render(<ProfileComparisonGraph model={model} onSelect={() => {}} onDrill={() => {}} />, host),
  )
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(host.querySelectorAll('[data-comparison-node]').length).toBeLessThan(20)
  expect(host.textContent).toContain('first 128 levels')
  const viewport = host.querySelector<HTMLDivElement>(
    '[aria-label="Scrollable comparison flamegraph"]',
  )!
  act(() => {
    viewport.scrollTop = 26 * 60
    viewport.dispatchEvent(new Event('scroll', {bubbles: true}))
  })
  const depths = [...host.querySelectorAll('[data-comparison-node]')].map(element =>
    Number(element.getAttribute('data-depth')),
  )
  expect(Math.min(...depths)).toBe(59)
  expect(Math.max(...depths)).toBeLessThan(75)
  const focus = model.nodes.find(node => node.frame?.name === 'depth250')!
  act(() =>
    render(
      <ProfileComparisonGraph
        model={model}
        focusNode={focus}
        onSelect={() => {}}
        onDrill={() => {}}
      />,
      host,
    ),
  )
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(host.querySelector('[data-depth="0"]')!.textContent).toContain('depth250')
})

test('empty models display an empty state and huge symbols do not inflate every graph label', async () => {
  const empty = profile([])
  const model = await compareProfiles(empty, empty, {mode: 'absolute'})
  act(() =>
    render(<ProfileComparisonGraph model={model} onSelect={() => {}} onDrill={() => {}} />, host),
  )
  expect(host.querySelectorAll('[data-comparison-node]')).toHaveLength(0)
  const long = 'verylong'.repeat(5_000)
  const filled = await compareProfiles(profile([[[long], 1]]), profile([[[long], 2]]), {
    mode: 'absolute',
  })
  const node = filled.nodes.find(item => item.frame)!
  expect(comparisonNodeDescription(filled, node).length).toBeLessThan(1500)
})
