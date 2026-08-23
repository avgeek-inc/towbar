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

## Pull requests

- Keep each change focused.
- Add tests for behavior changes.
- Update the schema and documentation together.
- Explain security, migration, and rollback implications when applicable.
- Preserve Source scoping and avoid logging secret values.

Project stewardship and the current code owner are recorded in
[MAINTAINERS.md](MAINTAINERS.md).

By contributing, you agree that your contributions are licensed under the
Apache License 2.0.
