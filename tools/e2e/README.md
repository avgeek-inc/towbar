# Isolated deployment target

Run from the repository root:

```sh
node tools/e2e/target.mjs
```

The harness builds a disposable Linux target with SSH and its own Docker daemon.
It requires Docker support for privileged containers (Docker Desktop or Colima).
It does not mount the host Docker socket or reuse the host daemon's workload
containers and volumes. Only SSH is published, on a random loopback port.

The smoke check connects as the non-root `deploy` user and compares daemon IDs
to verify isolation. It also checks executable paths required by the deployer.
The generated SSH key, container and anonymous volumes are removed on completion
or setup failure. The reusable `towbar-v2-e2e-target:local` image remains cached.

`startTestTarget()` returns the SSH port, private key path, `ssh(command)` and
`close()` for a lifecycle runner. Always call `close()` in `finally`.

This target currently supports private app/resource deployment testing. It does
not emulate Ubuntu systemd or Caddy setup, and its smoke check does not verify
API admission, Temporal workflows, deployments, backups or PR handling.
