# Towbar web app

Private deployment dashboard for `app.towbar.dev`. It reads manifest-owned
Sources, Apps, Resources, and Servers from the API and exposes only operational
actions. Resources remain nested inside their owning Source alongside Apps,
Servers, and deployment history.

The Server Overview owns preparation: it recommends a fresh Ubuntu target,
shows the durable setup steps, and keeps deployables visibly in `Server Setup
Pending` until the Server is ready.

App and Resource pages show observed health/drift and bounded runtime actions.
Their configuration and lifecycle are read-only projections of the Source
manifest; removal and restoration happen through Git and Source sync.
Database Resource pages expose verified backup policy, manual capture, and
retained S3 artifact metadata. When configured by the manifest, the Resource
connection view exposes non-secret private-network and SSH-tunnel coordinates
for tools such as TablePlus. Database restores remain a manual operator task.
Server pages list only Source-scoped orphan candidates from the latest check;
owner-confirmed cleanup is destructive and persistent volumes are never
removed automatically.

## Local UI fixture

Run the app against representative, read-only data without starting the Towbar
control plane:

```sh
pnpm --filter towbar-web-app dev:fixture-api
NEXT_PUBLIC_TOWBAR_API_BASE_URL=http://127.0.0.1:4420 pnpm --filter towbar-web-app dev
```

The fixture covers every authenticated page, including nested Source, App,
Resource, Server, Deployment, and Source Sync routes. It listens on port 4420
to remain isolated from the normal Towbar API development port.
