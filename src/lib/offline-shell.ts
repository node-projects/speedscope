// Build-time policy for the hosted app shell. No imported recordings or runtime
// response bodies are added to these caches.
export function isOfflineShellAsset(name: string): boolean {
  return (
    name === 'index.html' ||
    (name !== 'service-worker.js' && /^[\w.-]+\.(?:js|css|wasm|woff2|png|ico)$/.test(name))
  )
}

export const offlineRegistrationScript = `(() => {
  const base = new URL('./', document.baseURI);
  if (!/^https?:$/.test(base.protocol) || !window.isSecureContext || !('serviceWorker' in navigator)) return;
  const local = base.hostname === 'localhost' || base.hostname === '127.0.0.1' || base.hostname === '[::1]';
  if (local && base.pathname === '/') return;
  const register = () => navigator.serviceWorker.register(new URL('service-worker.js', base).href,
    {scope: base.href, updateViaCache: 'none'}).catch(() => {});
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, {once: true});
})();`

export const offlineWorkerRuntime = `
const scopeURL = new URL(self.registration.scope);
const prefix = 'node-projects-speedscope-offline:' + encodeURIComponent(scopeURL.pathname) + ':';
const shellPrefix = prefix + 'shell:';
const cacheName = shellPrefix + CONFIG.version;
const metadataName = prefix + 'metadata-v1';
const metadataURL = key => new URL('__offline_metadata__/' + key, scopeURL).href;
const shellURLs = CONFIG.assets.map(name => new URL(name, scopeURL).href);
const allowed = new Set(shellURLs);
const indexURL = new URL('index.html', scopeURL).href;

async function marker(cache, key) {
  const response = await cache.match(metadataURL(key));
  return response ? response.text() : null;
}
async function prune(keep) {
  const names = await caches.keys();
  await Promise.all(names.filter(name => name.startsWith(shellPrefix) && !keep.has(name)).map(name => caches.delete(name)));
}
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const metadata = await caches.open(metadataName);
    const active = await marker(metadata, 'active');
    const waiting = await marker(metadata, 'waiting');
    // Keep the active shell and previous waiting shell until this install has
    // succeeded. A failed new deployment cannot destroy either offline copy.
    await prune(new Set([active, waiting, cacheName]));
    try {
      const cache = await caches.open(cacheName);
      await cache.addAll(shellURLs.map(url => new Request(url, {cache: 'reload', credentials: 'same-origin'})));
      await metadata.put(metadataURL('waiting'), new Response(cacheName));
    } catch (error) {
      if (cacheName !== active && cacheName !== waiting) await caches.delete(cacheName);
      throw error;
    }
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const metadata = await caches.open(metadataName);
    const waiting = await marker(metadata, 'waiting');
    await metadata.put(metadataURL('active'), new Response(cacheName));
    // Preserve a newer successfully installed update if it is already waiting.
    await prune(new Set([cacheName, waiting]));
    if (waiting === cacheName) await metadata.delete(metadataURL('waiting'));
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || request.cache === 'no-store' || url.origin !== scopeURL.origin || url.search || request.headers.has('Range')) return;
  let key = url.href;
  if (request.mode === 'navigate' && (url.pathname === scopeURL.pathname || key === indexURL)) key = indexURL;
  if (!allowed.has(key)) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    return await cache.match(key) || fetch(request);
  })());
});
// Deliberately no skipWaiting, clients.claim, runtime cache insertion or reload:
// an open recording continues with its current app version until all tabs close.
`

export function offlineWorkerSource(version: string, assets: string[]): string {
  if (
    !/^[a-f0-9]{64}$/.test(version) ||
    assets.length > 64 ||
    !assets.includes('index.html') ||
    assets.some(name => !isOfflineShellAsset(name))
  )
    throw new Error('Invalid offline shell manifest')
  return `const CONFIG = ${JSON.stringify({version, assets})};\n${offlineWorkerRuntime}`
}
