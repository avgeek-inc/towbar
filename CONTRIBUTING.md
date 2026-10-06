# Contributing to Towbar

Thank you for helping improve Towbar.

## Before you start

- Use an issue for significant behavior or schema changes so the design can be
  discussed before implementation.
- Never include customer data, private keys, access tokens, production IPs, or
  proprietary assets in an issue, fixture, test, or commit.
- Security vulnerabilities must follow [SECURITY.md](SECURITY.md), not a public
  issue.

## Design system dependency

The dashboard uses `@avgeek-oss/design-system` from GitHub Packages. Shared UI
belongs in that package; Towbar owns API calls, access checks, routing, and
product-specific composition in `apps/towbar-web-app` and `packages/towbar-web-ui`.
Use the package's documented exports and import its stylesheet once. The Next.js
navigation adapter connects shared links to Towbar's router.

[GitHub Packages requires authentication](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry)
for public npm packages. For local installs, sign in with a personal access token
(classic) with `read:packages`:

```bash
npm login --scope=@avgeek-oss --auth-type=legacy --registry=https://npm.pkg.github.com
```

For source Docker builds, export `NODE_AUTH_TOKEN` with the same registry read
permission. Compose passes it as a BuildKit secret only to the web installer.
Do not put tokens in `.npmrc`, build arguments, tracked files, or image layers.
Installed Towbar hosts pulling release images do not need this npm token.
GitHub Actions uses its scoped `GITHUB_TOKEN` with package read permission.

## Local checks

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
```

Prefer the narrowest package check while iterating. Run the root verification
before opening a pull request. Validate Compose changes with:

```bash
cp .env.example .env
# Replace placeholders with non-production test values.
docker compose config --quiet
docker compose build
```

## Public demo

The public demo uses the current dashboard and session-isolated development
fixtures. See [its architecture, checks, and activation runbook](infra/demo/README.md).
Changes to fixture routes must be reviewed against the public gateway allowlist.

## Documentation

The Mintlify project lives in `docs/`, organized into Guides, Self-hosting, and
Reference. Write task pages around prerequisites, the action, and a way to verify
the result. Keep manifest field details in the reference and link to them from guides.
Use documentation-only IPs and domains, and never include credentials in examples
or screenshots. Feature screenshots should include light and dark variants,
descriptive alt text, and enough resolution for Retina displays.

When the public manifest schema or starter manifest changes, update their
published copies:

```bash
pnpm docs:sync
pnpm docs:check
```

`pnpm docs:check` verifies page metadata, navigation, internal links, and published
artifacts. Core tests parse the YAML examples against the deployment contract.

Install the [Mintlify CLI](https://www.mintlify.com/docs/cli/install), then run
`mint dev` from `docs/` for a local preview. Before publishing, run `mint validate`
and `mint broken-links` from that directory. Review changed pages on desktop and
mobile, in light and dark mode. Configure Mintlify with `/docs` as this repository's
documentation path.

## Pull requests

- Keep each change focused.
- Add tests for behavior changes.
- Update the schema and documentation together.
- Explain security, migration, and rollback implications when applicable.
- Preserve Source scoping and avoid logging secret values.

## Release images

Update only the release version in the root `package.json`, then run
`pnpm cli:build` and commit the generated installer and CLI files. The dashboard,
API, installer, and CLI all use that version. `pnpm cli:check`, CI, and the release
workflow reject stale generated scripts. Update the release notes in
`CHANGELOG.md`; version numbers in historical notes and test scenarios do not
need to change.

Edit the installer in `infra/install.sh.in` and CLI modules in `infra/towbar-cli/`.
`install.sh`, `infra/towbar`, and `infra/towbar-cli/00-version.sh` are generated;
run `pnpm cli:build` after changing their sources. Installed hosts do not need
Node.js to run them.

After the release pull request merges, create and push the matching `v2.x.y` tag
from the merge commit, then run
the **Publish release images** workflow from `main` with that tag. The workflow
refuses a tag that does not point at the selected `main` commit.

The workflow builds the API, worker, and dashboard for `linux/amd64` and
`linux/arm64`, publishes them to GitHub Container Registry, creates a draft release,
and attaches `towbar-images.json`. The manifest records immutable image digests. The
workflow publishes the assembled release, installs it in local mode on a disposable
GitHub-hosted Ubuntu runner, runs `towbar doctor`, and proves that `towbar restart`
reuses the running application containers. Its diagnostic evidence is retained for
14 days. A failed smoke test deletes the release and tag so the installer cannot
select it; immutable release tag names cannot be reused, so fix the failure under a
new patch version.

GHCR package visibility is separate from repository visibility. The three Towbar
container packages must be public so an installation can pull them without GitHub
credentials. The workflow verifies anonymous access before attaching the manifest.
When a package is published for the first time, set its visibility to **Public**
in the organization package settings and rerun the failed manifest job.

Project stewardship and the current code owner are recorded in
[MAINTAINERS.md](MAINTAINERS.md).

By contributing, you agree that your contributions are licensed under the
Apache License 2.0.
