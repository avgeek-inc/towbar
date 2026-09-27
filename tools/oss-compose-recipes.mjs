// These projects need a Compose feature (a config file, command, or a mount
// outside the paths accepted by a single Towbar Service manifest).
export const ossComposeRecipes = {
  101: {
    routedService: "plausible",
    port: 8000,
    internalServices: ["plausible_db", "plausible_events_db"],
    why: "Plausible Community Edition uses PostgreSQL for accounts and sites, ClickHouse for events, and its own application data directory. They share one Compose network. This example keeps both databases private; Towbar does not treat their Compose volumes as managed Datastores.",
    values: {
      POSTGRES_PASSWORD: "Generate a unique PostgreSQL password.",
      BASE_URL: "https://plausible-ce.example.com",
      SECRET_KEY_BASE:
        "Generate at least 64 random bytes for sessions and encryption.",
    },
    files: [
      [
        "deploy/plausible-ce/compose.yml",
        {
          services: {
            plausible_db: {
              image:
                "postgres:16-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea",
              environment: {
                POSTGRES_USER: "plausible",
                POSTGRES_DB: "plausible",
                POSTGRES_PASSWORD: "${POSTGRES_PASSWORD}",
              },
              volumes: ["postgres-data:/var/lib/postgresql/data"],
              healthcheck: {
                test: ["CMD-SHELL", "pg_isready -U plausible -d plausible"],
                interval: "10s",
                retries: 10,
              },
            },
            plausible_events_db: {
              image:
                "clickhouse/clickhouse-server:24.12-alpine@sha256:cd450891db46cc6ffe313ca2b0fb7dbfb897a6873ca74a724cbe050a2cf62621",
              environment: { CLICKHOUSE_SKIP_USER_SETUP: "1" },
              volumes: [
                "events-data:/var/lib/clickhouse",
                "events-logs:/var/log/clickhouse-server",
              ],
              healthcheck: {
                test: [
                  "CMD-SHELL",
                  "wget -q -O - http://127.0.0.1:8123/ping || exit 1",
                ],
                interval: "10s",
                retries: 10,
              },
            },
            plausible: {
              image:
                "ghcr.io/plausible/community-edition:v3.2.1@sha256:33e60bfb40f2df5da00f8753b76fad04f67dba3abe6d73eb516e440e3fb62985",
              command: [
                "sh",
                "-c",
                "/entrypoint.sh db createdb && /entrypoint.sh db migrate && /entrypoint.sh run",
              ],
              depends_on: {
                plausible_db: { condition: "service_healthy" },
                plausible_events_db: { condition: "service_healthy" },
              },
              environment: {
                BASE_URL: "${BASE_URL}",
                SECRET_KEY_BASE: "${SECRET_KEY_BASE}",
                HTTP_PORT: "8000",
                TMPDIR: "/var/lib/plausible/tmp",
                DATABASE_URL:
                  "postgres://plausible:${POSTGRES_PASSWORD}@plausible_db:5432/plausible",
                CLICKHOUSE_DATABASE_URL:
                  "http://plausible_events_db:8123/plausible_events_db",
              },
              volumes: ["plausible-data:/var/lib/plausible"],
            },
          },
          volumes: {
            "postgres-data": {},
            "events-data": {},
            "events-logs": {},
            "plausible-data": {},
          },
        },
      ],
    ],
    steps: [
      "Give the server enough memory for ClickHouse as well as the application; the official low-memory configuration is a separate tuning step.",
      "Back up PostgreSQL, ClickHouse, and Plausible's own data volume together. These Compose databases do not receive Towbar Datastore backup/restore operations.",
    ],
    check:
      "Create an account and a site, install its tracking snippet on a test page, and confirm a visit appears. Then restart the project and verify historical visits remain.",
  },
  107: {
    routedService: "keycloak",
    port: 8080,
    internalServices: ["postgresql"],
    why: "Keycloak needs PostgreSQL and a production start command. Towbar routes HTTPS to Keycloak's internal HTTP port; its hostname and proxy-header settings must match that route. The database is a private Compose service here, not a Towbar-managed Datastore.",
    values: {
      POSTGRES_PASSWORD: "Generate a unique PostgreSQL password.",
      KC_BOOTSTRAP_ADMIN_PASSWORD:
        "Generate a strong first administrator password.",
    },
    files: [
      [
        "deploy/keycloak/compose.yml",
        {
          services: {
            postgresql: {
              image:
                "postgres:16-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea",
              environment: {
                POSTGRES_DB: "keycloak",
                POSTGRES_USER: "keycloak",
                POSTGRES_PASSWORD: "${POSTGRES_PASSWORD}",
              },
              volumes: ["database:/var/lib/postgresql/data"],
              healthcheck: {
                test: ["CMD-SHELL", "pg_isready -U keycloak -d keycloak"],
                interval: "10s",
                retries: 10,
              },
            },
            keycloak: {
              image:
                "quay.io/keycloak/keycloak:26.3.3@sha256:6a7217a100bd3e5de4063a27a538ef999a3c5a88c4b4ec0ffc0a642aee7b2597",
              command: ["start"],
              depends_on: { postgresql: { condition: "service_healthy" } },
              environment: {
                KC_DB: "postgres",
                KC_DB_URL: "jdbc:postgresql://postgresql:5432/keycloak",
                KC_DB_USERNAME: "keycloak",
                KC_DB_PASSWORD: "${POSTGRES_PASSWORD}",
                KC_HOSTNAME: "https://keycloak.example.com",
                KC_HTTP_ENABLED: "true",
                KC_PROXY_HEADERS: "xforwarded",
                KC_BOOTSTRAP_ADMIN_USERNAME: "admin",
                KC_BOOTSTRAP_ADMIN_PASSWORD: "${KC_BOOTSTRAP_ADMIN_PASSWORD}",
              },
            },
          },
          volumes: { database: {} },
        },
      ],
    ],
    steps: [
      "Use `start`, never `start-dev`, for this public hostname. Replace the hostname in the Compose file and Towbar route together.",
      "Back up the PostgreSQL volume before changing Keycloak versions. The example uses the standard image; an optimized custom image is an optional later improvement.",
    ],
    check:
      "Finish the administrator login, create a realm and test user, then confirm the realm remains after redeployment. Verify external redirect URLs use HTTPS.",
  },
  108: {
    routedService: "server",
    port: 9000,
    internalServices: ["postgresql", "worker"],
    why: "authentik needs PostgreSQL, a web server, and a background worker. Server and worker share the same application data volume. This minimal stack omits the upstream Docker socket mount, so Docker-managed outposts must be arranged separately.",
    values: {
      PG_PASS: "Generate a unique PostgreSQL password (under 100 characters).",
      AUTHENTIK_SECRET_KEY:
        "Generate a long random key; retain it across upgrades.",
    },
    files: [
      [
        "deploy/authentik/compose.yml",
        {
          services: {
            postgresql: {
              image:
                "postgres:16-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea",
              environment: {
                POSTGRES_DB: "authentik",
                POSTGRES_USER: "authentik",
                POSTGRES_PASSWORD: "${PG_PASS}",
              },
              volumes: ["database:/var/lib/postgresql/data"],
              healthcheck: {
                test: ["CMD-SHELL", "pg_isready -U authentik -d authentik"],
                interval: "10s",
                retries: 10,
              },
            },
            server: {
              image:
                "ghcr.io/goauthentik/server:2026.8.3@sha256:ab9b4e8cc4ab3f8d1198d2db6aeea66bafea1963b3f2843589e0d163f97d9849",
              command: ["server"],
              depends_on: { postgresql: { condition: "service_healthy" } },
              environment: {
                AUTHENTIK_POSTGRESQL__HOST: "postgresql",
                AUTHENTIK_POSTGRESQL__NAME: "authentik",
                AUTHENTIK_POSTGRESQL__USER: "authentik",
                AUTHENTIK_POSTGRESQL__PASSWORD: "${PG_PASS}",
                AUTHENTIK_SECRET_KEY: "${AUTHENTIK_SECRET_KEY}",
              },
              volumes: ["data:/data"],
            },
            worker: {
              image:
                "ghcr.io/goauthentik/server:2026.8.3@sha256:ab9b4e8cc4ab3f8d1198d2db6aeea66bafea1963b3f2843589e0d163f97d9849",
              command: ["worker"],
              user: "root",
              depends_on: { postgresql: { condition: "service_healthy" } },
              environment: {
                AUTHENTIK_POSTGRESQL__HOST: "postgresql",
                AUTHENTIK_POSTGRESQL__NAME: "authentik",
                AUTHENTIK_POSTGRESQL__USER: "authentik",
                AUTHENTIK_POSTGRESQL__PASSWORD: "${PG_PASS}",
                AUTHENTIK_SECRET_KEY: "${AUTHENTIK_SECRET_KEY}",
              },
              volumes: ["data:/data", "certs:/certs"],
            },
          },
          volumes: { database: {}, data: {}, certs: {} },
        },
      ],
    ],
    steps: [
      "Use a server with at least two CPU cores and 2 GB of RAM, as required by the upstream Compose guide. Save `PG_PASS` and `AUTHENTIK_SECRET_KEY` before deploying.",
      "Back up PostgreSQL and the shared data/certificate volumes together. Without the Docker socket, deploy any future outposts manually.",
    ],
    check:
      "Open `/if/flow/initial-setup/` to set the first `akadmin` password, create a test application and provider, and confirm the worker is healthy after a redeploy.",
  },
  122: {
    routedService: "immich-server",
    port: 2283,
    internalServices: ["immich-machine-learning", "redis", "database"],
    why: "Immich needs its server, machine-learning service, Valkey, and a PostgreSQL image with the vector extensions Immich expects. Towbar's generic PostgreSQL Datastore preset is not a substitute for that image. All persistent data stays in named Compose volumes.",
    values: {
      DB_PASSWORD:
        "Generate an alphanumeric PostgreSQL password, as the upstream guide recommends.",
    },
    files: [
      [
        "deploy/immich/compose.yml",
        {
          services: {
            "immich-server": {
              image:
                "ghcr.io/immich-app/immich-server:v3@sha256:79cc1623323d5894922686d8743b4780181428f98eecbfb58ce12c41ef02d1ea",
              depends_on: ["redis", "database"],
              environment: {
                DB_HOSTNAME: "database",
                DB_USERNAME: "immich",
                DB_DATABASE_NAME: "immich",
                DB_PASSWORD: "${DB_PASSWORD}",
                REDIS_HOSTNAME: "redis",
              },
              volumes: ["library:/data"],
            },
            "immich-machine-learning": {
              image:
                "ghcr.io/immich-app/immich-machine-learning:v3@sha256:60dfcf266a9ef3b7376f5678e8c980d4fb61db5fc48c078fe8a326ab1535d60d",
              volumes: ["model-cache:/cache"],
            },
            redis: {
              image:
                "valkey/valkey:9@sha256:418652cfb58ef879d4978c33553735d7147016032d5aefaa14c828e611eb9dfd",
            },
            database: {
              image:
                "ghcr.io/immich-app/postgres:14-vectorchord0.4.3-pgvectors0.2.0@sha256:bcf63357191b76a916ae5eb93464d65c07511da41e3bf7a8416db519b40b1c23",
              environment: {
                POSTGRES_PASSWORD: "${DB_PASSWORD}",
                POSTGRES_USER: "immich",
                POSTGRES_DB: "immich",
                POSTGRES_INITDB_ARGS: "--data-checksums",
              },
              volumes: ["postgres:/var/lib/postgresql/data"],
              shm_size: "128mb",
            },
          },
          volumes: { library: {}, "model-cache": {}, postgres: {} },
        },
      ],
    ],
    steps: [
      "Use a server that meets Immich's published CPU, memory, and storage requirements. Set `DB_PASSWORD` before deployment and keep the PostgreSQL volume on local storage, not a network share.",
      "The Compose project database is not a Towbar-managed Datastore. Back up both the `library` and `postgres` volumes; a database backup alone cannot restore photos.",
    ],
    check:
      "Upload a few photos, wait for thumbnails and search jobs, then redeploy and verify both media and metadata remain.",
  },
  104: {
    routedService: "prometheus",
    port: 9090,
    private: true,
    why: "Prometheus needs a scrape configuration as well as a persistent metrics directory. This first instance scrapes itself only; add explicit targets before expecting host or application metrics.",
    files: [
      [
        "deploy/prometheus/compose.yml",
        {
          services: {
            prometheus: {
              image:
                "prom/prometheus:v3.5.0@sha256:63805ebb8d2b3920190daf1cb14a60871b16fd38bed42b857a3182bc621f4996",
              configs: [
                { source: "scrape", target: "/etc/prometheus/prometheus.yml" },
              ],
              volumes: ["metrics:/prometheus"],
            },
          },
          configs: { scrape: { file: "./prometheus.yml" } },
          volumes: { metrics: {} },
        },
      ],
      [
        "deploy/prometheus/prometheus.yml",
        {
          global: { scrape_interval: "30s" },
          scrape_configs: [
            {
              job_name: "prometheus",
              static_configs: [{ targets: ["localhost:9090"] }],
            },
          ],
        },
      ],
    ],
    steps: [
      "Keep this service private until you put authentication in front of its UI and API.",
      "Edit `prometheus.yml` to add only targets reachable from this Compose network. The sample self-scrape cannot discover Towbar Services automatically.",
    ],
    check:
      'Check `Status → Targets` from a trusted connection or query `up{job="prometheus"}` from the server. Back up the `metrics` volume if the historical samples matter.',
  },
  106: {
    routedService: "gatus",
    port: 8080,
    why: "Gatus needs a versioned list of endpoints to check. The sample checks one public URL; it does not require a separate database for this first setup.",
    files: [
      [
        "deploy/gatus/compose.yml",
        {
          services: {
            gatus: {
              image:
                "twinproduction/gatus@sha256:094eb186e55235db367e90e9d56140e5897b7044c41de23cde4cc18e6da1242e",
              configs: [{ source: "checks", target: "/config/config.yaml" }],
            },
          },
          configs: { checks: { file: "./config.yaml" } },
        },
      ],
      [
        "deploy/gatus/config.yaml",
        {
          endpoints: [
            {
              name: "Example site",
              url: "https://example.com",
              interval: "1m",
              conditions: ["[STATUS] == 200"],
            },
          ],
        },
      ],
    ],
    steps: [
      "Replace the example endpoint with a URL you control. Add alerting only after the basic check works; destination credentials belong in Towbar runtime secrets, not this file.",
    ],
    check:
      "Open the status page, verify that the endpoint has a recent successful check, then temporarily use a failing URL to confirm the failure appears.",
  },
  117: {
    routedService: "linkding",
    port: 9090,
    why: "linkding uses SQLite by default. Its database and generated signing key live under `/etc/linkding/data`, a mount path Towbar's single-Service manifest does not accept. A named Compose volume preserves both without introducing PostgreSQL.",
    values: {
      LD_SUPERUSER_NAME: "Choose the first administrator username.",
      LD_SUPERUSER_PASSWORD: "Generate a long first administrator password.",
      LD_CSRF_TRUSTED_ORIGINS: "https://linkding.example.com",
    },
    files: [
      [
        "deploy/linkding/compose.yml",
        {
          services: {
            linkding: {
              image:
                "sissbruecker/linkding:1.42.0@sha256:12ffd6f3b48c5d46543d2f38030de1f476d8dcff5f486eb75c9c7cb5941e7127",
              environment: {
                LD_SUPERUSER_NAME: "${LD_SUPERUSER_NAME}",
                LD_SUPERUSER_PASSWORD: "${LD_SUPERUSER_PASSWORD}",
                LD_CSRF_TRUSTED_ORIGINS: "${LD_CSRF_TRUSTED_ORIGINS}",
              },
              volumes: ["data:/etc/linkding/data"],
            },
          },
          volumes: { data: {} },
        },
      ],
    ],
    steps: [
      "Save the three runtime values before deploying. The initial administrator variables create a user only if that username does not already exist.",
      "Back up the `data` volume; it holds bookmarks, archived pages, and the signing key.",
    ],
    check:
      "Sign in, add a bookmark, redeploy, and verify the account and bookmark still work.",
  },
  127: {
    routedService: "ntfy",
    port: 80,
    why: "ntfy needs a `serve` command and an explicit access policy. This Compose project stores its message cache and user database in one named volume; it needs no SQL Datastore.",
    files: [
      [
        "deploy/ntfy/compose.yml",
        {
          services: {
            ntfy: {
              image:
                "binwiederhier/ntfy:v2.15.0@sha256:aa10e84da624f65be107f9317dbf6e212fa812e0ebf62e74d032d0762eccc930",
              command: ["serve"],
              configs: [{ source: "server", target: "/etc/ntfy/server.yml" }],
              volumes: ["data:/var/cache/ntfy"],
            },
          },
          configs: { server: { file: "./server.yml" } },
          volumes: { data: {} },
        },
      ],
      [
        "deploy/ntfy/server.yml",
        {
          "base-url": "https://ntfy.example.com",
          "cache-file": "/var/cache/ntfy/cache.db",
          "auth-file": "/var/cache/ntfy/user.db",
          "auth-default-access": "deny-all",
        },
      ],
    ],
    steps: [
      "Create an administrator with ntfy's `user add --role=admin` command in the running container before publishing private topics. `deny-all` blocks anonymous reads and writes by default.",
      "Back up the `data` volume if cached notifications or account records must survive server loss.",
    ],
    check:
      "Publish and subscribe to a test topic with the administrator credentials. Verify that an unauthenticated request is denied.",
  },
};
