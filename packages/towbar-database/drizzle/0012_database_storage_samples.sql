CREATE TABLE "towbar_database_storage_samples" (
  "sampled_at" timestamp with time zone PRIMARY KEY DEFAULT now() NOT NULL,
  "towbar_bytes" bigint NOT NULL,
  "monitoring_bytes" bigint NOT NULL
);
