# OSS release distribution

Towbar manages the shared release host at `oss.avgeek.ltd`. The Worker reads a private R2 bucket and exposes approved product prefixes from `wrangler.json`. It is release infrastructure, separate from the Towbar application.

| Host                        | Contents                                                     |
| --------------------------- | ------------------------------------------------------------ |
| GitHub                      | Source, issues and release notes                             |
| GHCR                        | Container images pinned by digest                            |
| R2 through `oss.avgeek.ltd` | Installers, source archives, metadata, checksums and schemas |

## Routes

Under `/towbar/`:

- `install.sh` and `releases/latest.json` select the latest validated release.
- `releases/v2.X.Y/` contains `release.json`, `install.sh`, `towbar`, `source.tar.gz`, `towbar-images.json`, `SHA256SUMS` and `schemas/`.
- `schemas/` selects schemas from the latest validated release.

Stable routes disable caching. Versioned downloads cache for one year. The Worker rejects writes and unknown object paths. Stable routes return 404 until a release is promoted.

## Credentials and deployment

Organization secrets `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` grant selected repositories object read/write access to the release bucket. These repositories share bucket access; prefixes prevent filename collisions, not cross-project writes.

`CLOUDFLARE_ACCOUNT_ID` is an organization variable. The `CLOUDFLARE_API_TOKEN` secret is restricted to Towbar. It permits Worker deployment, routes for `avgeek.ltd`, account and zone reads, and release-bucket reads.

Run **Deploy shared OSS release host** from reviewed `main` before the first release. It deploys the Worker and custom domain without promoting a product version.

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
