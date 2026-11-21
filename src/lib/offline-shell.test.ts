/** @jest-environment node */
import vm from 'vm'
import {isOfflineShellAsset, offlineRegistrationScript, offlineWorkerSource} from './offline-shell'

const manifest = ['index.html', 'app-ABC.js', 'font-ABC.woff2', 'decoder-ABC.wasm']
const revision = (n: number) => n.toString(16).padStart(64, '0')
type StoredCache = Map<string, Response>
function storage() {
  const values = new Map<string, StoredCache>()
  const network = jest.fn(async (request: Request) => new Response(`network:${request.url}`))
  const key = (request: Request | string) => (typeof request === 'string' ? request : request.url)
  return {
    values,
    network,
    caches: {
      keys: async () => [...values.keys()],
      delete: async (name: string) => values.delete(name),
      open: async (name: string) => {
        if (!values.has(name)) values.set(name, new Map())
        const cache = values.get(name)!
        return {
          match: async (request: Request | string) => cache.get(key(request))?.clone(),
          put: async (request: Request | string, response: Response) => {
            cache.set(key(request), response.clone())
          },
          delete: async (request: Request | string) => cache.delete(key(request)),
          addAll: async (requests: Request[]) => {
            const responses = await Promise.all(requests.map(request => network(request)))
            if (responses.some(response => !response.ok)) throw new Error('Shell fetch failed')
            requests.forEach((request, i) => cache.set(request.url, responses[i].clone()))
          },
        }
      },
    },
  }
}
function worker(
  version: number,
  store: ReturnType<typeof storage>,
  scope = 'https://example.org/app/',
) {
  const listeners = new Map<string, (event: any) => void>()
  const self = {
    registration: {scope},
    addEventListener: (name: string, callback: (event: any) => void) =>
      listeners.set(name, callback),
  }
  vm.runInNewContext(offlineWorkerSource(revision(version), manifest), {
    self,
    caches: store.caches,
    fetch: store.network,
    URL,
    Request,
    Response,
  })
  return {
    lifecycle: async (name: string) => {
      let work: Promise<void> | undefined
      listeners.get(name)!({
        waitUntil: (promise: Promise<void>) => {
          work = promise
        },
      })
      await work
    },
    fetch: async (
      url: string,
      options: {
        method?: string
        mode?: string
        cache?: string
        headers?: Record<string, string>
      } = {},
    ) => {
      let response: Promise<Response> | undefined
      listeners.get('fetch')!({
        request: {
          url,
          method: 'GET',
          mode: 'cors',
          cache: 'default',
          ...options,
          headers: new Headers(options.headers),
        },
        respondWith: (promise: Promise<Response>) => {
          response = promise
        },
      })
      return response ? (await response).text() : null
    },
  }
}

test('only bounded immutable app-shell assets enter generated manifests', () => {
  for (const file of [
    'index.html',
    'app-X.js',
    'app-X.css',
    'font-X.woff2',
    'x.wasm',
    'icon.ico',
    'icon.png',
  ])
    expect(isOfflineShellAsset(file)).toBe(true)
  for (const file of [
    'profile.json',
    'capture.trace.gz',
    'demo.txt',
    'release.txt',
    'app.js.map',
    '../app.js',
    'service-worker.js',
    '/app.js',
    'app.js?profile=secret',
  ])
    expect(isOfflineShellAsset(file)).toBe(false)
  expect(() => offlineWorkerSource(revision(1), [...manifest, 'capture.json'])).toThrow()
  expect(() => offlineWorkerSource(revision(1), ['app.js'])).toThrow()
  expect(() =>
    offlineWorkerSource(revision(1), [
      'index.html',
      ...Array.from({length: 64}, (_, i) => `app-${i}.js`),
    ]),
  ).toThrow()
})

test('install precaches the shell and fetch intercepts only exact allowed URLs and entry points', async () => {
  const store = storage(),
    active = worker(1, store)
  await active.lifecycle('install')
  await active.lifecycle('activate')
  expect(store.network).toHaveBeenCalledTimes(manifest.length)
  expect(await active.fetch('https://example.org/app/', {mode: 'navigate'})).toBe(
    'network:https://example.org/app/index.html',
  )
  expect(await active.fetch('https://example.org/app/index.html', {mode: 'navigate'})).toContain(
    'index.html',
  )
  expect(await active.fetch('https://example.org/app/app-ABC.js')).toContain('app-ABC.js')
  for (const url of [
    'https://example.org/app/profile.trace',
    'https://example.org/app/demo.txt',
    'https://example.org/app/__speedscope_profile__/local.json',
    'https://elsewhere.example/app/app-ABC.js',
    'https://example.org/app/app-ABC.js?token=secret',
    'https://example.org/another/',
  ])
    expect(await active.fetch(url, {mode: 'navigate'})).toBe(null)
  expect(await active.fetch('https://example.org/app/app-ABC.js', {cache: 'no-store'})).toBe(null)
  expect(await active.fetch('https://example.org/app/app-ABC.js', {method: 'POST'})).toBe(null)
  expect(
    await active.fetch('https://example.org/app/app-ABC.js', {headers: {Range: 'bytes=0-2'}}),
  ).toBe(null)
  expect(store.network).toHaveBeenCalledTimes(manifest.length)
})

test('many waiting deployments keep at most three shell generations and tiny scope metadata', async () => {
  const store = storage(),
    active = worker(1, store)
  await active.lifecycle('install')
  await active.lifecycle('activate')
  store.values.set('unrelated-cache', new Map())
  for (let version = 2; version <= 12; version++) {
    await worker(version, store).lifecycle('install')
    expect(
      [...store.values.keys()].filter(name => name.includes(':shell:')).length,
    ).toBeLessThanOrEqual(3)
    const metadata = [...store.values.entries()].find(([name]) => name.endsWith('metadata-v1'))![1]
    expect(metadata.size).toBeLessThanOrEqual(2)
  }
  expect(await active.fetch('https://example.org/app/app-ABC.js')).toContain('app-ABC.js')
  await worker(12, store).lifecycle('activate')
  expect([...store.values.keys()].filter(name => name.includes(':shell:'))).toHaveLength(1)
  expect(store.values.has('unrelated-cache')).toBe(true)
})

test('failed updates preserve active and already-waiting shells; cleanup is scope-local', async () => {
  const store = storage(),
    active = worker(1, store),
    waiting = worker(2, store)
  await active.lifecycle('install')
  await active.lifecycle('activate')
  await waiting.lifecycle('install')
  const other = worker(8, store, 'https://example.org/another-app/')
  await other.lifecycle('install')
  await other.lifecycle('activate')
  const before = [...store.values.keys()].sort()
  store.network.mockImplementationOnce(async () => new Response('failed', {status: 503}))
  await expect(worker(3, store).lifecycle('install')).rejects.toThrow('Shell fetch failed')
  expect([...store.values.keys()].sort()).toEqual(before)
  expect(await active.fetch('https://example.org/app/app-ABC.js')).toContain('app-ABC.js')
  expect(await waiting.fetch('https://example.org/app/app-ABC.js')).toContain('app-ABC.js')
  expect(await other.fetch('https://example.org/another-app/app-ABC.js')).toContain('another-app')
})

test('cache misses go to network without growing the app-shell cache', async () => {
  const store = storage(),
    active = worker(1, store)
  await active.lifecycle('install')
  await active.lifecycle('activate')
  const shell = [...store.values.entries()].find(([name]) => name.includes(':shell:'))![1]
  shell.delete('https://example.org/app/app-ABC.js')
  const size = shell.size
  expect(await active.fetch('https://example.org/app/app-ABC.js')).toContain('app-ABC.js')
  expect(shell.size).toBe(size)
})

test('registration stays on secure app scopes and skips standalone/local root servers', async () => {
  for (const [url, secure, expected] of [
    ['https://example.org/app/#profileURL=secret', true, true],
    ['http://127.0.0.1:9000/app/', true, true],
    ['http://localhost:9000/', true, false],
    ['http://127.0.0.1:9000/index.html', true, false],
    ['file:///C:/app/index.html', true, false],
    ['http://example.org/app/', false, false],
  ] as const) {
    const register = jest.fn(async () => ({}))
    vm.runInNewContext(offlineRegistrationScript, {
      URL,
      document: {baseURI: url, readyState: 'complete'},
      window: {isSecureContext: secure},
      navigator: {serviceWorker: {register}},
    })
    expect(register.mock.calls.length).toBe(expected ? 1 : 0)
    if (expected) {
      expect(register.mock.calls[0][0]).toMatch(/\/app\/service-worker\.js$/)
      expect(register.mock.calls[0][0]).not.toContain('secret')
    }
  }
})
