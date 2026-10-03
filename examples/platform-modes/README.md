# Platform deployment examples

`towbar.yml` declares the environment and default build server. Files under
`.towbar/services` declares one workload for each supported Service deployment
mode, including the multi-service Compose workload. Every runtime and tool image is
pinned by digest. Replace the documentation-only server address and domain
before connecting this manifest to a disposable test environment.

Railpack is the recommended source builder. Nixpacks remains available for
compatibility. Cloud Native Buildpacks accept only the reviewed Paketo and
Heroku builder digests exported by `@workspace/towbar-core`.

The examples intentionally exercise more than autodetection: Dockerfile uses a
named target, static runs a bounded build command, Railpack and Nixpacks load
repository configuration files, and Cloud Native Buildpacks loads a project
descriptor. Every source build declares an architecture and an isolated cache
scope so the manifest also covers cache reuse and later inactive-cache cleanup.

The Compose example deliberately combines a repository-built service, a
digest-pinned image service, health-gated dependencies, profiles, overrides,
and managed named volumes. Its maintenance strategy communicates that the
stack is recreated rather than silently promising rolling replacement.

Compose change detection covers the full tracked repository tree by default,
including source and configuration files. Automatic deployment remains opt-in.
For this example in a monorepo, add the following to the Compose entity after
validating a manual deployment:

```yaml
autoDeploy:
  inputs:
    - examples/platform-modes/compose/**
```

The primary Compose file and explicit overrides remain tracked even outside
the scope. Include any shared dependencies when adapting this example. With
`autoDeploy: true`, all tracked repository files participate instead; an
identical-tree commit does not cause another deployment.
