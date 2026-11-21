# Single-HTML build

From a repository checkout with dependencies installed, run:

```sh
npm run build:single-file
```

The result is `dist/speedscope-standalone.html`. Application code, CSS, fonts,
icons, the example recording, import-worker code and WebAssembly decoders are
embedded in that document. It needs no companion assets or source maps. The
license texts included in the existing standalone release remain in the HTML
as inert JSON, alongside bundle license comments. CI builds this option on
Windows/Linux and uploads it with each standalone artifact.

Combined validation passed 413 Jest tests in 71 suites, 307 snapshots, five
Node tests, type checking, lint and schema/backlog checks. Browser QA imported
the embedded example, local JFR and the private PLC gzip from this one document;
the preview server logged only the document request and browser errors were
empty. The browser tool blocks file-protocol navigation, so no `file://` startup
claim is made here.

Serve the document from your own HTTP server or copy it for portable use. It
registers no service worker and contains no recording supplied by the user.
Local imports stay in the browser. Explicit remote recording links still need
their server and CORS permissions. The existing multi-file standalone ZIP,
CLI and hosted Pages builds remain available independently.

## Content Security Policy

One document simplifies deployment but does not remove the app's CSP needs.
The build prints the SHA-256 source hash for its inline application script;
use that exact build-specific value in `script-src` if allowing inline code
by hash. Rebuilding changes the hash. Workers use Blob URLs; decoders use
WebAssembly; fonts and icons use data URLs. Aphrodite and component styles
still require dynamically inserted styles and inline style attributes.

Browser verification used the following HTTP response policy, serving only
the HTML document and rejecting all other request paths:

```text
default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval' blob:; style-src 'unsafe-inline'; font-src data:; img-src data:; connect-src data:; worker-src blob:;
```

That policy allowed the embedded example and local JFR/PLC imports without
companion requests. It blocks remote recordings and source-map network fetches;
add only the required remote origins to your own deployment's `connect-src`.
This is an observed deployment example, not a recommendation to relax an
existing application's policy. Strict policies forbidding inline styles still
need a style-engine/attribute integration strategy. Browser file-URL startup
could not be checked by the browser automation tool, which permits HTTP(S) only.

This extends [#108](https://github.com/jlfwong/speedscope/issues/108) with a true
single-document option. Strict-CSP embedding and a supported multi-instance
library API remain separate work.
