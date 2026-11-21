# Hosting and publishing

Repository: [node-projects/speedscope](https://github.com/node-projects/speedscope).
Package: [`@node-projects/speedscope`](https://www.npmjs.com/package/@node-projects/speedscope).
Hosted application: [node-projects.github.io/speedscope](https://node-projects.github.io/speedscope/).
The npm command remains `speedscope`; Node.js 22+ is required for the CLI.

## GitHub Actions

| Workflow | Trigger | Result |
| --- | --- | --- |
| [ci.yml](../.github/workflows/ci.yml) | PR, push to `main`, manual | Tests Node.js 22/24 on Linux/Windows, checks npm contents and uploads offline ZIPs. |
| [pages.yml](../.github/workflows/pages.yml) | Push to `main`, manual | Tests, builds `dist/pages` and deploys GitHub Pages. |
| [release.yml](../.github/workflows/release.yml) | Published GitHub release, manual retry | Uses the release tag as the npm version, tests, packs, attaches archives and publishes to npm. |

## Pages setup

In repository **Settings → Pages → Build and deployment**, select **GitHub Actions**
as the source. This repository is configured for workflow deployment. The deploy
job uses the `github-pages` environment with `pages: write` and `id-token: write`.
No custom domain or upstream `speedscope.app` CNAME is installed.

The site uses relative asset URLs and works at the `/speedscope/` project path.
`npm run build:pages` creates the HTTP site, schema and release metadata in
`dist/pages`. It does not overwrite the offline npm build in `dist/release`.
Local profile imports stay in the browser; profileURL requests fetch from the
explicitly requested host and require that host's CORS permission.

To redeploy the current `main`, use the Actions page or:

```sh
gh workflow run pages.yml --repo node-projects/speedscope --ref main
```

## First publication: 2.0.0

The first fork version, **2.0.0**, was published manually by the maintainer on
2026-11-18. The bootstrap process was:

```sh
npm ci
npm test
npm publish --access public
```

`prepack` builds the offline app automatically. This first publication did not
require GitHub OIDC. The trusted publisher below is now configured.
Creating a `v2.0.0` GitHub release afterward is safe: the workflow detects the
existing npm version, attaches its standalone ZIP and skips re-publishing npm.
For a new version, it attaches the newly built npm tarball as well.

## npm trusted publishing after the first publication

The original npm trusted publisher, created on 2026-11-18, expired before its
first automated publication. It was recreated on 2026-11-21 and successfully
published **2.1.0** through the [release workflow retry](https://github.com/node-projects/speedscope/actions/runs/44884626601/attempts/2).
This validates end-to-end OIDC publication for the following GitHub Actions identity:

- Organization/user: `node-projects`
- Repository: `speedscope`
- Workflow filename: `release.yml`
- Environment: leave empty (the npm job does not use an environment)
- Allow the `npm publish` action.

The workflow already uses Node.js 24 and `id-token: write`, so future published
GitHub releases can authenticate through OIDC without an npm token secret.
The saved publisher also includes npm's default staging permission; the workflow
uses direct publication. No GitHub environment restriction is configured because
the publish job does not declare an environment.

To inspect the configuration, an authorized npm maintainer can run:

```sh
npm trust list @node-projects/speedscope --json
```

For recovery/recreation, npm 11.15+ supports the equivalent CLI setup:

```sh
npm trust github @node-projects/speedscope --repository node-projects/speedscope --file release.yml --allow-publish
```

npm requires fresh two-factor authentication for these account operations. The
original setup used the CLI's browser authentication flow; the replacement used
npm's package settings in the browser. No credentials were added to the repository.
Recreating an existing publisher is not a routine
release step.

New publisher configurations must complete their first successful automated
publish within **two days**, otherwise npm expires them. Creating a GitHub release
for an already-published version does not validate OIDC because this workflow
skips the npm publish step for that version. Use the next new version (for example
`v2.0.1`) when ready. The recreated connection completed this validation with
2.1.0; the two-day deadline applies to new, unvalidated connections.

If publication fails with `E404` while the package exists, inspect **Trusted
Publisher** in npm package settings. On 2026-11-21 this displayed **Expired**;
the runner's Node/npm versions and OIDC permission were already correct. Delete
the expired connection, recreate the same identity with direct publication
allowed, then retry the failed job or dispatch the existing release tag.
npm may require separate fresh authentication checks to view settings, delete
the expired connection and save its replacement. Verify the retry's publish
step and the registry's version/dist-tag afterward. No code or tag change was
needed for this recovery.

See [npm's trusted publisher setup](https://docs.npmjs.com/trusted-publishers/).
The repository URL in package.json points to this fork, as required for provenance.

The workflow uses OIDC and needs no npm token secret. The npm account setup can
only be completed after the package exists and by an authorized npm maintainer.
Keep the workflow filename and repository settings exact. Allow direct `npm publish`
for this publisher. There is no npm credential included in this repository.

Version 2.0.0 is available from npm, and the README's npm badge and installation
command now refer to the published scoped package.

## Publish a release

1. Merge the desired code, including these workflows, to `main` and wait for CI.
2. Create a GitHub release pointing to that commit with a new tag such as `v2.0.1`
   (or `2.0.1`). Release titles are descriptive; the **tag** determines the version.
3. Publish the release. The workflow checks out the tag, sets package.json and
   package-lock.json to `2.0.1` in the runner, tests and packs the application.
4. The workflow attaches `speedscope-2.0.1.zip` and the scoped npm `.tgz` to the
   GitHub release, then publishes the same tarball to npm with provenance.

Use a canonical SemVer tag, optionally prefixed by lowercase `v`. Versions with
prerelease identifiers (for example `v2.1.0-rc.1`) use npm's `next` dist-tag.
Marking a GitHub release as a prerelease also selects `next`. Stable releases use
`latest`. Build metadata (`+...`), abbreviated versions and leading-zero numeric
identifiers are rejected. Draft releases do not publish.

The checked-in package version is a development baseline. Release version changes
are confined to the runner; the workflow does not create another commit or tag.
npm versions are immutable: choose a new version for changed release contents.
Pages follows `main` independently, so publishing an older release cannot roll
the hosted site back.

If publishing fails after archives were attached (for example before npm auth was
configured), fix authorization and manually run **Publish npm release**, supplying
the existing release tag. The release must already exist and be non-draft. Retry
with the existing tag. If that npm version already exists, the workflow skips npm
publishing and leaves its immutable contents and distribution tags unchanged.

For local packaging checks without publishing:

```sh
npm test
npm run prepack
npm pack --dry-run --ignore-scripts
```

The offline archive includes local fonts and embedded JFR WASM. Extract the ZIP
and open `index.html`. The published npm package includes the CLI, offline app and
`FileFormat` types, with the upstream MIT license retained.
