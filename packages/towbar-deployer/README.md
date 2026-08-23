# Towbar deployer

The isolated Towbar executor. It fetches one immutable GitHub commit, verifies a
pinned SSH host key, optionally uses a private `ssh.host` for SSH and direct
origin verification while keeping the server `ip` for public routing and DNS,
transfers a minimal Docker build context, builds with BuildKit secret mounts,
starts and checks a candidate, reconciles guarded Cloudflare orange-cloud
records when declared, renders Caddy routing, and promotes only after
validation.

Apps use Docker's default bridge unless `container.network` explicitly names an
existing network. The executor verifies a declared network before building and
attaches the candidate and any declared deployment hooks to it.

Pre- and post-deploy hooks execute in disposable containers from the selected
image, with the app's network and resource limits, an explicit hook-only secret
bundle, a timeout, and redacted output. Pre-deploy failure aborts promotion;
post-deploy failure leaves the committed release live with a warning. A worker
deploying itself schedules delayed cleanup so its current activity can return
before the previous worker container is removed.

Credential values are accepted only in memory, written to mode `0600`
ephemeral files when an external tool requires a file, and removed in `finally`
cleanup. Command output is streamed progressively through a caller-provided
redacting log hook while the remote command is still running. BuildKit mounts
do not persist secret contents by default, but a
repository Dockerfile is executable build logic and is trusted not to copy or
exfiltrate the app's own declared build secrets.

Every candidate receives `SOURCE_COMMIT` for the selected immutable revision,
along with Towbar's app, deployment, and commit metadata variables.

Resource deployments pull a versioned image, create a release-owned local tag,
and replace only the current Resource container. Logical volume names map to
stable Docker volumes scoped by the Resource database ID. If health or routing
fails before release commit, Towbar removes the candidate and restarts the
previous container. It never deletes persistent volumes automatically.
Resources on a declared Docker network receive their normalized stable alias.
When `access.sshTunnel.hostPort` is present, Towbar publishes the Resource port
as `127.0.0.1:hostPort` only. Before stopping the current container it rejects
alias conflicts, Docker port conflicts, and non-Docker loopback listeners.
Loopback publication requires Docker Engine 28 or newer.

Runtime operations target only the current retained container and re-check its
Towbar ownership labels. PostgreSQL backups use validated `pg_dump` archives;
Redis backups use validated RDB snapshots. Towbar does not execute database
restores; retained S3 artifacts are restored manually when required. Server
inspection is read-only. Orphan cleanup accepts only explicitly selected,
Source-labeled objects and revalidates them against the current/previous
release ledger; it never invokes a global Docker prune.
