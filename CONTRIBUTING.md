# Contributing to the node-projects speedscope fork

Contributors of all skill levels are welcome. This project builds on
[jlfwong/speedscope](https://github.com/jlfwong/speedscope) and retains its MIT
license and attribution. Please follow the [code of conduct](CODE_OF_CONDUCT.md).

## Development

Use Node.js 22 or 24 with npm. From Windows, macOS or Linux:

```sh
git clone https://github.com/node-projects/speedscope.git
cd speedscope
npm ci
npm run serve
```

Open `http://localhost:8000`. The development server uses esbuild and tsx;
it prints its address in the terminal. Set `SPEEDSCOPE_PORT` to choose another
port (PowerShell: `$env:SPEEDSCOPE_PORT='8080'; npm run serve`).

Most application code is TypeScript. See [src/README.md](src/README.md) for an
overview. Use `npm run prettier` or your editor's Prettier integration to format
changes.

## Checks and builds

```sh
npm test
npm run coverage
npm run prepack
npm run build:pages
```

`npm test` runs type checking, lint, Jest, Node CLI/release tests and schema
validation. The Node fixture setup script extracts non-Instruments sample ZIPs
on all platforms. `npm run jest -- --testPathPatterns=profile` narrows Jest tests.

`prepack` produces `dist/release` and `dist/speedscope-<version>.zip` for offline
use and npm packaging. `build:pages` produces `dist/pages` for HTTP hosting.
Serve it through any static HTTP server when checking the Pages build; the HTTP
build uses modules and should not be opened through `file://`.

For performance-sensitive changes, preserve measured totals and frame identity,
include a meaningful regression and compare representative large profiles.
See [benchmark commands and limits](docs/LARGE_TRACE_PERFORMANCE.md).

## Pull requests and releases

Open issues and PRs against [node-projects/speedscope](https://github.com/node-projects/speedscope).
Explain the behavior change, its purpose and validation. Large features benefit
from an issue describing the intended data model and UI first. Include screenshots
for visual changes.

The [upstream PR review](docs/UPSTREAM_PR_REVIEW.md) and
[issue review](docs/UPSTREAM_ISSUE_REVIEW.md) record this fork's integration decisions.
Keep upstream importer documentation links when they still describe the supported
format. Do not rewrite historical changelog links as if this fork authored those releases.

GitHub Actions checks Linux and Windows on Node.js 22/24. Pages deploys from
`main`; npm publishes from GitHub releases. See [release setup](docs/RELEASING.md).
