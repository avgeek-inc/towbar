export const managedResourceTypes = [
  "postgres",
  "mysql",
  "mariadb",
  "mongodb",
  "redis",
  "dragonfly",
  "keydb",
  "clickhouse",
] as const;
export type ManagedResourceType = (typeof managedResourceTypes)[number];
export type ResourceType = ManagedResourceType;
export type DeployableKind = "app" | "compose" | ResourceType;

export const managedResourceCompatibility = {
  postgres: {
    image:
      "postgres:17-alpine@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73",
    architectures: ["amd64", "arm64"],
    majorVersion: 17,
    port: 5_432,
    volumePath: "/var/lib/postgresql/data",
    resources: { cpus: 1, memory: "1g" },
    healthCommand: [
      "sh",
      "-c",
      'pg_isready -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-postgres}"',
    ],
  },
  mysql: {
    image:
      "mysql:8.4@sha256:85b9bf2e29cf836ecb8c2a15a935d4ba0c606631dff1dd79531a11983c638f2a",
    architectures: ["amd64", "arm64"],
    majorVersion: 8,
    port: 3_306,
    volumePath: "/var/lib/mysql",
    resources: { cpus: 0.5, memory: "512m" },
    healthCommand: [
      "sh",
      "-c",
      'mysqladmin ping -h 127.0.0.1 -u root -p"$MYSQL_ROOT_PASSWORD" --silent',
    ],
  },
  mariadb: {
    image:
      "mariadb:11.8@sha256:8b5f33ebd85d1775657e974ed10434128bb493c80e826ceaa54074fd1a92a112",
    architectures: ["amd64", "arm64"],
    majorVersion: 11,
    port: 3_306,
    volumePath: "/var/lib/mysql",
    resources: { cpus: 0.5, memory: "512m" },
    healthCommand: [
      "sh",
      "-c",
      'mariadb-admin ping -h 127.0.0.1 -u root -p"$MYSQL_ROOT_PASSWORD" --silent',
    ],
  },
  mongodb: {
    image:
      "mongo:8.0@sha256:4968f22d0c6c10ef29952f3e807f62872ba22b3312f25803564fbfc08255efc2",
    architectures: ["amd64", "arm64"],
    majorVersion: 8,
    port: 27_017,
    volumePath: "/data/db",
    resources: { cpus: 0.5, memory: "512m" },
    healthCommand: [
      "sh",
      "-c",
      'mongosh --quiet --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --eval "quit(db.adminCommand({ping:1}).ok ? 0 : 1)"',
    ],
  },
  redis: {
    image:
      "redis:8-alpine@sha256:becdda6c7f4b3fb42e42fd7f120bbf5c54c4caaaf16f26da24e4563d2c1f0576",
    architectures: ["amd64", "arm64"],
    majorVersion: 8,
    port: 6_379,
    volumePath: "/data",
    resources: { cpus: 0.5, memory: "512m" },
    healthCommand: [
      "sh",
      "-c",
      'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning ping',
    ],
  },
  dragonfly: {
    image:
      "docker.dragonflydb.io/dragonflydb/dragonfly:v1.33.1@sha256:de1a932e51bf50d96bb8bee1b5bde96b429de38e3cab369238aeec3a93f5fdba",
    architectures: ["amd64", "arm64"],
    majorVersion: 1,
    port: 6_379,
    volumePath: "/data",
    resources: { cpus: 0.5, memory: "512m" },
    healthCommand: [
      "sh",
      "-c",
      'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning ping',
    ],
  },
  keydb: {
    image:
      "eqalpha/keydb:x86_64_v6.3.4@sha256:eceb1806730c7850395b8262300182c2e15a6e5dacbf0b72cbab110518caf43f",
    architectures: ["amd64"],
    majorVersion: 6,
    port: 6_379,
    volumePath: "/data",
    resources: { cpus: 0.5, memory: "512m" },
    healthCommand: [
      "sh",
      "-c",
      'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning ping',
    ],
  },
  clickhouse: {
    image:
      "clickhouse/clickhouse-server:25.8-alpine@sha256:87e0a5b72f5465b18eacca7c76850e7ff551c9795c50e451f5646299e5e24146",
    architectures: ["amd64", "arm64"],
    majorVersion: 25,
    port: 8_123,
    volumePath: "/var/lib/clickhouse",
    resources: { cpus: 1, memory: "1g" },
    healthCommand: [
      "sh",
      "-c",
      'clickhouse-client --user "$CLICKHOUSE_USER" --password "$CLICKHOUSE_PASSWORD" --query "SELECT 1"',
    ],
  },
} as const satisfies Record<
  ManagedResourceType,
  {
    image: string;
    architectures: readonly ("amd64" | "arm64")[];
    majorVersion: number;
    port: number;
    volumePath: string;
    resources: { cpus: number; memory: string };
    healthCommand: readonly string[];
  }
>;
