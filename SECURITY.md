# Security policy

Towbar deploys code and resolves credentials on infrastructure you control.
Security reports are treated as sensitive.

## Reporting a vulnerability

Do not open a public issue. Use GitHub's private vulnerability reporting for
this repository. If that feature is unavailable, contact the maintainers through
the private address listed in the repository's GitHub security settings.

Include the affected version or commit, configuration assumptions, reproduction
steps, impact, and any suggested mitigation. Do not access data or systems you
do not own, and do not include live credentials in the report.

We will acknowledge a complete report as soon as practical and coordinate a fix
and disclosure timeline with the reporter.

## Supported versions

Security fixes are provided for the latest `1.x` release. Production operators
should pin a reviewed release and subscribe to repository security advisories.

## Security assumptions

- The configured Git branch is trusted deployment input and is protected by the
  repository owner.
- Towbar's public HTTP services are deployed behind TLS.
- PostgreSQL, Temporal, Temporal UI, and SSH are restricted by host and network
  controls rather than exposed broadly.
- AWS identities are scoped to the Secrets Manager paths required by one Source.
  Read access covers declared execution secrets; write access is limited to App
  environment bundles intentionally managed through Towbar.
- The installation owner is trusted to reveal values for attached App,
  Resource, and shared environment bundles. Reveal responses are not cached,
  persisted in PostgreSQL, or written to application logs.
- Destination hosts use SSH keys, pinned host identity, current security
  updates, and least-privilege network rules.
- Installation secrets are unique, randomly generated, and never committed.
- Owner password-reset environment values are high-entropy, used only for the
  documented recovery restart, and removed immediately after the password is
  changed in Settings.

Towbar does not provide a security boundary against a malicious contributor who
is authorized to modify the deployment branch. Review and branch protection are
part of the trust model.
