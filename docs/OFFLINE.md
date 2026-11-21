# Hosted offline use

The hosted HTTP build caches its application shell after a successful online
visit in a service-worker-capable secure browser. Once installation has finished,
the app's entry page can reopen without a network connection. Import a recording
from your computer again after reopening; an open recording remains in memory
when the network disconnects.

This caches application code, styles, fonts, icons and WebAssembly decoders only.
Imported recordings, remote `profileURL` responses, the CLI's local profile
endpoint, source maps supplied by users, the built-in example recording and
arbitrary network responses are not saved. A `profileURL` link can open the
offline app shell, but its remote recording still needs a network connection.
The built-in example also needs the network. Application caching is not a saved
recording feature.

Use the app's ordinary entry URL, such as `/speedscope/` or
`/speedscope/index.html`. Hash parameters are supported; query-string entry URLs
are not intercepted. Neither arbitrary paths within the scope nor cross-origin
URLs are intercepted. Explicit `no-store` requests and range requests bypass
the worker as well.

## Updates

Shell revisions are derived from the generated HTML, immutable asset contents
and worker policy. An update is installed in the background and waits for all
tabs using the previous app version to close. Open recordings are not reloaded
or replaced automatically. Close all app tabs, then reopen the app to adopt a
waiting update. Offline reopening can continue to use the last installed shell
if no newer version has been downloaded.

Each application scope owns at most three shell generations: the active shell,
the previous waiting shell and the newest installation/waiting shell. One small
metadata cache holds only active/waiting cache names. A failed new install keeps
the active and previously waiting versions usable. Activation removes obsolete
owned shell caches; caches belonging to other apps/scopes are left untouched.
There is no runtime cache insertion. Builds reject more than 64 shell files or
more than 16 MiB of shell assets.

Browser storage restrictions, quota pressure or manually clearing site data can
remove the offline copy. The app continues to work online if registration or
installation is unavailable. The worker uses the browser's ordinary
[installation and waiting lifecycle](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers)
without `skipWaiting`, `clients.claim` or forced reloads.

## Build and local behavior

`npm run build:pages` emits the worker and hosted registration script.
`npm run prepack` retains the existing portable standalone ZIP behavior and
does not emit/register a service worker. The ordinary development server also
does not register one. File-protocol pages remain independent of service workers.

Localhost root pages are excluded to avoid controlling another local app or CLI
session. A deliberate hosted-build preview under a subdirectory such as
`http://127.0.0.1:PORT/app/` can register a worker limited to that directory.
For browser verification, complete an online visit there, stop the server, then
reload the same entry URL. Use a dedicated preview origin/port and clear its
site storage afterward if you no longer need the preview's offline shell.
