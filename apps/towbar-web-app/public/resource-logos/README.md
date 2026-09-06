# Resource image logos

This is a bundled, curated identity catalog, not a popularity ranking or a registry
search service. The application makes no requests to icon services or Docker Hub
to identify resources. Only exact registered repository identities are matched.

Mappings live in `src/components/resource-image-catalog.json`. Image tags and
digests are ignored for matching. Docker Hub shorthand, `library/`, `docker.io`,
`index.docker.io`, and `registry-1.docker.io` normalize to the same identity.
Other registries and namespaces remain distinct; private mirrors and unrecognized
images retain the Docker fallback. Managed PostgreSQL and Redis keep their existing
logos regardless of their configured image. Identification does not establish
image authenticity, maintenance status, or safety.

## Artwork and attribution

Per-file upstream URLs are recorded in `sources.json`.
Registry or publisher references for the catalog expansion are recorded in
`repository-verification.json`. These establish repository identity at the recorded
date, not a guarantee of continued maintenance or image safety.

- Dashboard Icons by Homarr Labs and contributors, Apache-2.0, revision
  `f651f5798c7d58bff3cff4d3a9c4645d87657bbd`. WebP assets are copied unchanged.
  The license is included in `LICENSE-dashboard-icons`. Theme variants are used
  where available; some dark artwork sits on a light plate in dark mode.
  Mailpit uses a dark plate in both themes to preserve its white envelope.
- Simple Icons, CC0-1.0, revision
  `777807a262bb7384ff406fd4b35fdcd02e9514c3`. SVGs use the catalog's brand colors;
  Temporal and Prefect also have white versions for dark backgrounds.
- Iconify's Logos collection (Gil Barbara's SVG Logos), CC0-1.0, revision
  `ad784891fdb45ab99c31908c58c759333acb6571`. The selected icon bodies are wrapped
  in SVGs using their original view boxes and colors.

Names and artwork belong to their respective owners. They identify the technology
and do not imply endorsement. Collection licenses do not replace brand guidelines.

## Extending the catalog

1. Confirm each complete image repository in the publisher's documentation or
   registry. Use explicit aliases; do not introduce substring, suffix, or broad
   namespace matches. Test tags/digests separately from repository identities.
2. Add a stable product ID, label, repositories, and bundled logo paths to the
   catalog. Add provenance to `sources.json` and retain upstream license notices.
3. Inspect the artwork at 32px in both themes. Add `logoDark`, `darkPlate`, or `darkBackground` when
   needed. Keep assets local and preserve the fixed display dimensions.
4. Run the `resource-image-brand.test.ts` tests and verify the resource list in the
   local fixture. Tests reject duplicate normalized mappings and missing artwork.
