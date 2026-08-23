#!/bin/sh
set -eu

: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${TOWBAR_DATABASE_RUNTIME_PASSWORD:?TOWBAR_DATABASE_RUNTIME_PASSWORD is required}"

psql --set=ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=runtime_password="$TOWBAR_DATABASE_RUNTIME_PASSWORD" <<'SQL'
SELECT 'CREATE ROLE towbar_app LOGIN PASSWORD ' || quote_literal(:'runtime_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'towbar_app') \gexec
ALTER ROLE towbar_app PASSWORD :'runtime_password';
GRANT CONNECT ON DATABASE towbar TO towbar_app;
GRANT USAGE ON SCHEMA public TO towbar_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO towbar_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO towbar_app;
ALTER DEFAULT PRIVILEGES FOR ROLE towbar IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO towbar_app;
ALTER DEFAULT PRIVILEGES FOR ROLE towbar IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO towbar_app;
SQL
