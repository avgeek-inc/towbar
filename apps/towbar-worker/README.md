# Towbar worker

Temporal worker for Source reconciliation, per-server bounded coordination,
server preflight checks, and isolated deployments. Workflow payloads contain
only durable identifiers; recoverable credentials are fetched from the signed
internal API inside activities.

The server coordinator honors manifest `buildConcurrency`, runs independent app
deployments in parallel up to that bound, serializes the same app, and keeps
server checks and preparation exclusive. Preparation installs or validates the
host runtime in activities, persists each step through signed API callbacks,
and never puts SSH credentials into workflow history. Self-deployment uses a delayed cleanup handoff after
the candidate worker is healthy and its release is durable.

Eligible roots queue independently after a successful webhook or operator
Source sync. Towbar applies no cross-deployment ordering; the server coordinator
only enforces per-server concurrency and per-deployable serialization. Source
reconciliation and admission requests may each use up to two minutes of the
five-minute Temporal activity attempt so repository-tree materialization is not
constrained by the default internal request timeout.

The same coordinator serializes a Resource with itself. Stateful Resource
promotion stops the current container only after the selected image is ready,
reuses stable volumes, and restarts the prior container when pre-commit
validation fails.

The coordinator also runs bounded Resource operations. Operations for one
deployable serialize with its deployments; server-wide orphan cleanup is an
exclusive barrier. A durable maintenance workflow wakes every five minutes to
request read-only reconciliation and due UTC cron backups. S3 credentials and SSH
keys are resolved only inside activities and never enter workflow history.
