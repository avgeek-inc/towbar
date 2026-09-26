---
title: "Secrets"
description: "Configure secrets in Towbar or import them from Infisical and Doppler."
---

There are two ways to give a workload secrets:

1. [Save them in Towbar](/docs/secrets/towbar). Declare the variable names in the service or datastore manifest, sync the repository, and enter the values in Towbar. Towbar stores the values separately from Git and supplies them during deployment.
2. [Import them from an external service](/docs/secrets/external). Configure an Infisical or Doppler integration, then point the workload manifest at a project and optional scope. Towbar reads that scope at deployment and supplies its secrets as runtime variables.

Choose one owner for each variable. If the same name is present in Towbar and an external source, Towbar stops the deployment rather than choosing a value silently. You can use Towbar for some variables and an external service for others in the same workload.

**Shared secrets** are part of the Towbar option. They let several workloads reference one workspace value with `{{globals.KEY}}`; they are not another source that is injected automatically. The [Towbar secrets guide](/docs/secrets/towbar#reuse-a-shared-value) shows how to set one up.
