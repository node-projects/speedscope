import {h, render} from 'preact'
import {act} from 'preact/test-utils'
import {SelectedFrameDetails} from './selected-frame-details'

test('Sandwich details distinguish same-named functions and update full source locations', async () => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const first = {key: 1, name: 'execute_child', file: 'subprocess.py', line: 12, col: 3}
  try {
    act(() => render(<SelectedFrameDetails frame={first} />, host))
    expect(host.querySelector('section')!.getAttribute('aria-label')).toBe(
      'Selected function details',
    )
    expect(host.textContent).toBe('execute_childsubprocess.py:12:3')
    act(() =>
      render(<SelectedFrameDetails frame={{...first, key: 2, file: 'subprocess32.py'}} />, host),
    )
    expect(host.textContent).toContain('subprocess32.py:12:3')
    act(() => render(<SelectedFrameDetails frame={{key: 3, name: 'long/'.repeat(1000)}} />, host))
    expect(host.querySelector('strong')!.textContent).toBe('long/'.repeat(1000))
    expect(host.textContent).toContain('Source location unavailable')
  } finally {
    act(() => render(null, host))
    host.remove()
    await new Promise(resolve => setTimeout(resolve, 0))
  }
})
