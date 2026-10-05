# Towbar release publication

Towbar publishes downloads under `https://oss.avgeek.ltd/towbar`. The shared Worker and its deployment workflow live in [avgeek-oss/oss-releases](https://github.com/avgeek-oss/oss-releases).

This repository owns artifact assembly, upload, verification and promotion. Organization secrets `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` grant access to the release bucket. `CLOUDFLARE_ACCOUNT_ID` is an organization variable. Towbar does not need the Worker deployment token.

## Publication

**Publish release images** requires a stable tag at exact `main` HEAD and matching package, CLI and installer versions.

1. Build public AMD64/ARM64 images and record their digests.
2. Assemble committed artifacts and checksums. Upload the manifest last using create-only writes. Retries require identical bytes.
3. Verify public downloads and install the candidate in a disposable Linux host. Health, version, doctor, upgrade support and restart checks must pass. `TOWBAR_RELEASE_SMOKE=true` allows this explicit candidate while GitHub keeps the release draft.
4. Recheck downloads, write the validation record and conditionally update `towbar/latest.json`. Reject older versions and changed commits for an existing version.
5. Verify the stable installer, metadata and schemas, then publish GitHub release notes.

An installation failure removes the draft and leaves latest unchanged. Candidate objects remain for investigation. A failed final GitHub publication can be retried.

## Repository transfers

Update `repository.json`, then run:

```sh
pnpm repository:sync
pnpm --filter @workspace/towbar-core schemas
pnpm docs:sync
```

CI checks the stable repository ID, current owner and generated references. Keep the distribution URL stable across transfers. Change the GHCR namespace only when image ownership also changes.
