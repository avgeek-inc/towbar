---
title: "Security"
description: "Review Towbar's supported versions, trust model, and private vulnerability reporting path."
---

Towbar deploys code and resolves credentials on infrastructure you control.
Security reports are treated as sensitive.

## Report a vulnerability

Do not open a public issue. Use
[GitHub private vulnerability reporting](https://github.com/avgeek-inc/towbar/security/advisories/new)
for the Towbar repository. If that feature is unavailable, contact the
maintainers through the private address in the repository's GitHub security
settings.

Include the affected version or commit, configuration assumptions, reproduction
steps, impact, and any suggested mitigation. Do not access data or systems you
do not own, and do not include live credentials in the report.

## Supported versions

Security fixes are provided for the latest `1.x` release. Production operators
should pin a reviewed release and subscribe to repository security advisories.

## Security assumptions

- The configured production branch is trusted deployment input and is protected
  by the repository owner.
- Same-repository branches are trusted executable input for Apps with Preview
  enabled. Preview deployments use separate, least-privilege, non-production
  credentials. Fork pull requests are not Preview input.
- Public HTTP services are behind TLS. PostgreSQL, Temporal, Temporal UI, and
  SSH are restricted by host and network controls.
- Secrets are encrypted with AES-256-GCM and remain write-only in public APIs.
  Only owners may change them; audit events and Temporal history exclude values.
- Keep the installation encryption key separate from database backups. Losing
  the key makes stored secrets unrecoverable.
- The optional workspace AWS identity is scoped only to required S3 backup operations.
- Destination hosts use SSH keys, pinned host identity, current security
  updates, and least-privilege network rules.
- Installation secrets are unique, randomly generated, and never committed.

Towbar does not provide a security boundary against a malicious contributor who
is authorized to modify a deployed production or Preview branch. Review, branch
protection, secret separation, and the decision to enable Preview are part of
the trust model.

The repository's canonical [security policy](https://github.com/avgeek-inc/towbar/blob/main/SECURITY.md)
contains the complete and current policy.
