# Towbar worker

Temporal worker for Source reconciliation, per-server bounded coordination,
server preflight checks, and isolated deployments. Workflow payloads contain
only durable identifiers; recoverable credentials are fetched from the signed
internal API inside activities.

The server coordinator honors manifest `buildConcurrency`, runs independent app
deployments in parallel up to that bound, serializes the same app, and keeps
server checks exclusive. Self-deployment uses a delayed cleanup handoff after
the candidate worker is healthy and its release is durable.

Push-triggered roots queue immediately after Source sync. A successful
automatic deployment asks the API to admit any newly eligible `autoDeploy`
dependents. A dependency is ready when its current release matches its desired
deployment digest, so an unchanged dependency may remain on an older Source
commit. Source reconciliation and admission requests may each use up to two
minutes of the five-minute Temporal activity attempt so repository-tree
materialization is not constrained by the default internal request timeout.
Failed dependency chains do not continue.

The same coordinator serializes a Resource with itself. Stateful Resource
promotion stops the current container only after the selected image is ready,
reuses stable volumes, and restarts the prior container when pre-commit
validation fails.

The coordinator also runs bounded Resource operations. Operations for one
deployable serialize with its deployments; server-wide orphan cleanup is an
exclusive barrier. A durable maintenance workflow wakes every five minutes to
request read-only reconciliation and due UTC cron backups. S3 credentials and SSH
keys are resolved only inside activities and never enter workflow history.
