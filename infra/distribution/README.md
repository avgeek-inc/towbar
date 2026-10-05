# OSS release distribution

`oss.avgeek.ltd` is served by the `avgeek-oss-releases` Cloudflare Worker. Its R2 binding points to the private bucket with the same name. The bucket has no public development URL; the Worker exposes only known artifact routes within the `towbar/`, `mill/`, `rootset/`, and `vitalog/` prefixes. Towbar owns the shared Worker deployment. Other projects reuse the artifact contract and publication credentials rather than deploy another Worker.

Towbar endpoints:

- `/towbar/install.sh`: installer for the latest validated version.
- `/towbar/releases/latest.json`: validated version, commit, checksums, and release notes.
- `/towbar/releases/v2.X.Y/release.json`: version metadata, including whether installation validation passed.
- `/towbar/releases/v2.X.Y/{install.sh,towbar,source.tar.gz,towbar-images.json,SHA256SUMS}`: immutable downloads.
- `/towbar/schemas/{repository,app,compose,resource}.v2.json`: schemas from the latest validated release; versioned copies are also under `/towbar/releases/v2.X.Y/schemas/`.

The stable installer, latest metadata, and moving schemas use `Cache-Control: no-store`. Immutable version downloads use a one-year cache lifetime. The Worker does not expose bucket listings, validation markers, arbitrary object keys, or write methods. A product without a promoted release returns 404.

## Credentials

GitHub organization `avgeek-oss` stores `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`, selected for Towbar, Mill, Rootset, and Vitalog. These credentials have object read/write access only to `avgeek-oss-releases`; the separate product prefixes prevent filename collisions. Add a repository to the organization secret's selected-repository policy only when it is trusted to publish into this shared bucket.

Organization variable `CLOUDFLARE_ACCOUNT_ID` is available to the same projects. `CLOUDFLARE_API_TOKEN` is restricted to Towbar because it owns the shared Worker. The deployment token needs Worker scripts write and account settings read, `avgeek.ltd` Worker routes write and zone read, and read access to the release bucket.

Run **Deploy shared OSS release host** from reviewed `main` before the first R2 release. It validates repository identity and distribution tests before deploying the Worker and custom domain. Deployment does not publish or promote a product release.

## Publication

**Publish release images** requires a stable version tag at the exact `main` commit with matching package, CLI, and installer versions. It builds all three AMD64/ARM64 images, checks anonymous GHCR access, and assembles the source archive, CLI, pinned installer, image manifest, schemas, checksums, and release metadata from that commit.

Uploads use conditional create-only writes. A rerun can reuse an object only if its contents match byte-for-byte; conflicting immutable artifacts stop publication. The source archive contains committed files only. The release manifest is uploaded after every artifact has been checked and uploaded.

The workflow checks every download through the public domain, then installs the candidate from its versioned installer in a disposable Linux host. `TOWBAR_RELEASE_SMOKE=true` permits only this explicit candidate installation while its GitHub release remains a draft. Health, version, doctor, System Health upgrade support, and restart checks must pass before the publish job can run. A failed installation withdraws the draft release and leaves latest unchanged; candidate objects stay immutable for investigation.

Promotion rechecks every public artifact, creates an immutable validation record, and replaces `towbar/latest.json` with a conditional write against its previous ETag. It refuses older versions and same-version commit changes. This one pointer selects the stable installer, update metadata, and moving schemas together. The publisher then verifies the stable metadata, installer, and schema downloads through the domain. Only after promotion does GitHub publish the release notes. A failure in that final GitHub step can be retried without rebuilding or promoting a different version.

## Repository transfers

`repository.json` separates GitHub source identity, stable numeric repository ID, image registry namespace, and distribution URLs. After a transfer, update this file and run `pnpm repository:sync`, regenerate schemas, and sync docs. CI compares the immutable upstream repository ID with `GITHUB_REPOSITORY` to catch stale ownership after another transfer; forks keep validating the upstream identity. Runtime code uses generated constants, and CI rejects outdated repository links. Historical rename fixtures intentionally keep their old account names.

Keep the distribution URL stable when changing GitHub ownership. GHCR namespaces are an independent decision and must be updated explicitly if the image publishing account changes.
