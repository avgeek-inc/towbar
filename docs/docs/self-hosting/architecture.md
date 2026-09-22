---
title: "Architecture"
description: "Understand Towbar's control plane, deployment plane, workflows, and trust boundaries."
---

Towbar has a control plane and a deployment plane.

## Control plane

- `towbar-api` owns HTTP authentication, GitHub integration, source
  reconciliation, inventory, and operation admission. Browser/core routes use
  the published listener; signed worker routes use a separate, un-published
  Compose-network listener.
- `towbar-worker` executes Temporal workflows and activities. API-to-worker
  callbacks are signed with an installation-wide HMAC secret.
- `towbar-web-app` owns the operator dashboard, first-run setup, and login on one
  public origin. The marketing and documentation website is maintained
  separately from this self-hosted control plane.
- PostgreSQL stores control-plane state. The API uses a restricted runtime role;
  migrations use the database owner role. Initial Admin setup is an atomic,
  single-use API operation.
- Temporal provides durable queues, retries, and serialized per-server work. Separate one-time schema and namespace initialization jobs use the pinned upstream administration image; the server stores history in PostgreSQL. Its APIs stay inside the trusted control-plane network, and the operator UI is loopback-only. This internal Temporal connection does not use dashboard authentication.

## Deployment plane

```mermaid
flowchart LR
  GitHub[GitHub] --> API[API]
  Browser[Dashboard] --> API
  API --> DB[(PostgreSQL)]
  API --> Temporal[Temporal]
  Temporal --> Worker[Worker]
  Worker --> SSH[SSH with pinned host key]
  SSH --> Host[Ubuntu: Docker and Caddy]
```

Each Repository is a GitHub repository with a `towbar.yml` and the entity files under `.towbar/`. Successful
syncs normalize Apps and Resources into Repository-scoped database records. Servers
are workspace-owned physical hosts and may run workloads from multiple Repositories.
Static integration credentials are installation-scoped runtime configuration and are never persisted in PostgreSQL. Dynamic GitHub installation metadata and encrypted GitLab OAuth grants are workspace-scoped. Deployment history and
deployable runtime observations remain Repository-scoped.

When a deployment is admitted, Towbar snapshots the selected manifest state and
resolves current encrypted Towbar secrets only when execution starts. The worker
connects to the target Ubuntu host over SSH, builds or pulls the requested
image, starts a replacement container, verifies health, updates the proxy, and
retains only the configured release set.

## Preview lifecycle

For an App with Preview enabled, a relevant same-repository pull request event
signals one durable workflow per Repository and pull request. The API reads current
GitHub state and changed files before reconciling. Apps with path-aware
`autoDeploy.inputs` are admitted only when the pull request changes a matching
path; incomplete GitHub file listings fail safe by remaining eligible. Repeated
events coalesce while deployments retain immutable snapshots and independent
history. Preview runtime identities,
containers, releases, Caddy routes, and exact DNS records are isolated from
production. The per-server coordinator gives production and maintenance work
priority and applies a separate bounded Preview concurrency. Promotion checks
that the commit is still the environment's latest before changing its route,
so stale work cannot replace a newer Preview. Failures preserve the last
healthy release.

Pull request merge, closure, or retargeting, plus expiry, manifest disablement,
and an Admin action, all enter the same durable cleanup path. Cleanup
revalidates Towbar-owned runtime identities and removes only that Preview's
containers, images, Caddy route, and DNS record. Apps and Resources in the
production inventory are unchanged. GitHub Deployment statuses mirror the
Preview lifecycle, while one aggregate PR comment reports every App's build
status and Preview URL. Towbar updates that comment in place when the GitHub
App has deployment and pull-request write permission.

## Secret resolution

Secret values are encrypted database records, separate from manifest snapshots. Entity files declare required keys; successful sync adds unset slots, preserves existing values and references, and removes deleted declarations. Admins and Members edit values in Towbar; only Admins reveal stored values. Missing required values block deployment, not sync. Shared values are not inherited automatically: child variables explicitly reference `{{globals.ENV_KEY}}` or `{{source.ENV_KEY}}` using the same stage. Repository references stay in the child’s environment; global values are shared across environments when referenced. Resources support runtime values in each named environment. Preview values and references never fall back to the target environment’s persistent secrets. The Admin-only reveal operation returns a stored value or reference expression without resolving it and disables caching. For Admins, File mode uses the bulk-reveal endpoint for the selected scope, environment and stage. Members preserve masks or submit replacements without loading existing values.

The API encrypts each record with AES-256-GCM using `TOWBAR_CREDENTIALS_KEY`, binding ciphertext to workspace, owner, environment, stage, and record identity. An advisory transaction lock and expected revision protect both first writes and updates. Audit events contain metadata only. Deployment execution reads a consistent database snapshot and records only the revisions used; plaintext stays in execution memory and protected transfer files, outside Temporal history. Saving does not enqueue work. Image rollback resolves current runtime credentials.

## Repository trust

Repository contents are trusted deployment input. Anyone who can change the
branch mapped to a connected environment or an enabled Preview pull request can execute its
build and runtime behavior with the secrets assigned to that environment.
Protect mapped branches and restrict Preview credentials accordingly.

## Trust boundaries

1. Browser to the Towbar public origin, with `/v1/*` routed to the API.
2. GitHub or GitLab webhook to the API, authenticated with its environment-configured webhook secret.
3. API to worker/internal routes, authenticated with HMAC signatures and replay
   protection.
4. API to encrypted database records, unlocked by a separately stored installation key.
5. Worker to destination servers, authenticated by editor-managed SSH keys and
   pinned host identity.
6. Containers to Repository-declared Docker networks and volumes on destination
   hosts.

See the [security guide](/docs/self-hosting/security) for supported security assumptions and
reporting instructions.
