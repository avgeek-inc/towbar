# Platform deployment examples

`towbar.yml` declares one workload for each supported application deployment
mode plus a multi-service Compose workload. Every runtime and tool image is
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
