# Towbar release publication

Towbar publishes downloads under `https://oss.avgeek.ltd/towbar`. The [oss-releases](https://github.com/avgeek-oss/oss-releases) repository owns the shared Worker and publication broker. Towbar owns artifact assembly, verification and promotion.

## Credentials and dependencies

Release jobs request a signed GitHub Actions OIDC token. The broker checks the repository and owner IDs, exact main release workflow, event and commit, then returns a 15-minute R2 session restricted to `towbar/`. Jobs need `id-token: write` and the organization variable `CLOUDFLARE_ACCOUNT_ID`. They do not read the parent R2 credentials or Worker deployment token.

The publisher has a separate lockfile and one dependency:

```sh
npm ci --prefix tools/distribution --ignore-scripts
pnpm distribution:test
```

Deploy and configure the reviewed broker before merging the publisher migration. Validate an actual workflow session, including rejection of writes outside `towbar/`, before removing Towbar access to the parent organization secrets. Other products keep their current access until they migrate.

## Publication

**Publish release images** requires a stable tag at exact `main` HEAD and matching package, CLI and installer versions.

1. Build AMD64/ARM64 images and record their digests.
2. Assemble committed artifacts and checksums. Upload the manifest last using create-only writes. Retries require identical bytes.
3. Verify public downloads and install the candidate in a disposable Linux host. Health, version, doctor, upgrade support and restart checks must pass. `TOWBAR_RELEASE_SMOKE=true` allows this candidate while GitHub keeps the release draft.
4. Recheck downloads, write the validation record and conditionally update `towbar/latest.json`. Reject older versions and changed commits for an existing version.
5. Verify stable downloads, then publish GitHub release notes.

Metadata uses `schemaVersion: 1`; the shared [release contract](https://oss.avgeek.ltd/contracts/release.v1.json) defines its fields. Towbar additionally requires its complete artifact set.

An installation failure removes the draft and leaves latest unchanged. Candidate objects remain for investigation. A failed final GitHub publication can be retried.

## Repository transfers

Update `repository.json`, recording the old repository and any changed image registry in their respective `previous*` lists. Run:

```sh
pnpm repository:sync
pnpm --filter @workspace/towbar-core schemas
pnpm docs:sync
pnpm repository:check
```

Generation only writes declared outputs. Update documentation and image references explicitly; CI rejects obsolete aliases. Keep the distribution URL stable across transfers and change the GHCR namespace only when image ownership changes.
