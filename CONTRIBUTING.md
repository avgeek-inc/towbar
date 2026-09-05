# Contributing to Towbar

Thank you for helping improve Towbar.

## Before you start

- Use an issue for significant behavior or schema changes so the design can be
  discussed before implementation.
- Never include customer data, private keys, access tokens, production IPs, or
  proprietary assets in an issue, fixture, test, or commit.
- Security vulnerabilities must follow [SECURITY.md](SECURITY.md), not a public
  issue.

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

## Linear release reporting

Publishing a GitHub release runs `Report release to Linear`. It checks out the
released tag and syncs its version, release notes, GitHub link, and commits since
the previous version tag to the Linear pipeline. Include Linear issue identifiers
such as `AVG-5` in branch names or commit messages so they can be linked to the
release; linked GitHub pull requests are also detected.

Set the repository secret `LINEAR_ACCESS_KEY` to the pipeline access key from
Linear. A continuous pipeline creates completed releases on sync; a scheduled
pipeline collects the release for its configured stage workflow. This reports
GitHub publication; production deployment success is tracked separately by
`Deploy release`. To retry reporting, rerun the failed reporting job. The release
tag is the version identifier, so retries target the same Linear release.

Project stewardship and the current code owner are recorded in
[MAINTAINERS.md](MAINTAINERS.md).

By contributing, you agree that your contributions are licensed under the
Apache License 2.0.
