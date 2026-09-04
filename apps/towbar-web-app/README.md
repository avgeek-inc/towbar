# Towbar web app

Self-hosted deployment dashboard for Towbar. It reads manifest-owned
Sources, Apps, Resources, and Servers from the API and exposes only operational
actions. Resources remain nested inside their owning Source alongside Apps,
and Servers; Apps and Resources expose their own deployment history.

The web app also owns `/login` and the locked first-run owner setup. Password
authentication creates the API session directly; Towbar has no separate SSO
application, authorization-code callback, signup, or public password-reset UI.

The Server Overview owns preparation: it recommends a fresh Ubuntu target,
shows the durable setup steps, and keeps deployables visibly in `Server Setup
Pending` until the Server is ready.

App and Resource pages show observed health/drift and bounded runtime actions.
Infrastructure settings and lifecycle are projections of the Source manifest;
removal and restoration happen through Git and Source sync. Secrets are
editor-owned and independent of sync. Source Settings holds shared production
values for build, runtime, pre-deploy, and post-deploy. Apps override each stage;
resources inherit and override runtime only. Owners can start with an empty
configuration and add, replace, or delete values, then Save or Save and deploy.
Saved values remain write-only: only key names, origins, and revisions return.
Server Settings holds SSH and Cloudflare credentials.
Source, App, and Resource Settings each expose one operator control for pausing
new automatic deployments. A Source pause applies to all of its deployables;
manual deployment actions remain available.
Apps with Preview enabled expose pull request environments, stable URLs,
expiry, latest deployment status, and an owner cleanup action from the App
page. Preview build and deployment secret bindings are edited independently
from production bindings.
Database Resource pages expose verified backup policy, manual capture, and
retained S3 artifact metadata. When configured by the manifest, the Resource
connection view exposes non-secret private-network and SSH-tunnel coordinates
for tools such as TablePlus. Owners can restore an individually assured,
retained PostgreSQL or Redis backup through an isolated candidate, validated
promotion, and bounded rollback-volume retention.
Server pages show host capacity on Overview and container capacity in an
Apps/Resources tab. Host CPU, memory, Docker disk pressure, and uptime are shown
separately from the runtime inventory, whose CPU and memory values include
compact usage meters. The owning Source repeats those meters in its Apps and
Resources inventories without a separate sync-status column. Server pages also
list only Source-scoped orphan candidates from the latest check; owner-confirmed
cleanup is destructive and persistent volumes are never removed automatically.
Trusted SSH host keys can be explicitly untrusted from the Server's Host Keys
tab after confirmation.
Source pages also expose immutable pull-request deployment plans from their
GitHub Checks. The plan detail shows current and target identities, validation,
create/update/archive/restore/no-op rows, changed field names, and matched
repository paths without secret values.
Deployment details show the immutable Docker image digest and platform together
with the source commit, manifest digest, and selected source-input digest.
Source Settings also contains a Notifications section for Slack and SMTP
destinations. Provider credentials are configured in installation Settings →
Notifications and stored encrypted. Owners select event categories and supply only a Slack channel ID
or email recipients; recent operational events appear in the application
header without exposing provider secrets in the browser.

## Local UI fixture

Run the app against representative synthetic data without starting the Towbar
control plane:

```sh
pnpm --filter towbar-web-app dev:fixture-api
NEXT_PUBLIC_TOWBAR_API_BASE_URL=http://127.0.0.1:4420 pnpm --filter towbar-web-app dev
```

The fixture covers every authenticated page, including nested Source, App,
Resource, Server, Deployment, Deployment Plan, and Source Sync routes. It
listens on port 4420 to remain isolated from the normal Towbar API development
port.
