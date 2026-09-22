# Towbar CLI source

The numbered shell fragments in this directory are the source of the installed
`towbar` CLI. Run `pnpm cli:build` after editing them. The generated
`infra/towbar` file remains the standalone executable downloaded by
`install.sh` and installed on a Towbar host.

`pnpm cli:check` verifies that the generated executable matches these sources.
