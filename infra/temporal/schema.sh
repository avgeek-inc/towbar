#!/bin/sh
set -eu

# Initialization is additive and versioned by the upstream SQL tooling.
# Never pass --overwrite or drop a database during startup.
temporal-sql-tool --db temporal setup-schema --version 0.0
temporal-sql-tool --db temporal update-schema --schema-dir /etc/temporal/schema/postgresql/v12/temporal/versioned
temporal-sql-tool --db temporal_visibility setup-schema --version 0.0
temporal-sql-tool --db temporal_visibility update-schema --schema-dir /etc/temporal/schema/postgresql/v12/visibility/versioned
