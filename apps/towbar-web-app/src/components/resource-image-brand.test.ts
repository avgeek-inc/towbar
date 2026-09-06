import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import catalog from "./resource-image-catalog.json";
import {
  normalizeImageRepository,
  resourceImageBrand,
} from "./resource-image-brand";

void test("recognizes tagged, digested, and fully qualified Docker Hub identities", () => {
  for (const image of [
    "temporalio/server",
    "temporalio/server:1.28.0",
    "docker.io/temporalio/server:latest",
    `index.docker.io/temporalio/server:stable@sha256:${"a".repeat(64)}`,
    "registry-1.docker.io/temporalio/server",
  ]) {
    assert.equal(resourceImageBrand("image", image).label, "Temporal", image);
  }
  for (const image of [
    "postgres:17-alpine",
    "library/postgres",
    "docker.io/postgres",
    "docker.io/library/postgres",
  ]) {
    assert.equal(resourceImageBrand("image", image).label, "PostgreSQL", image);
  }
  assert.equal(
    resourceImageBrand("image", "axllent/mailpit:v1.27").label,
    "Mailpit",
  );
  assert.equal(
    resourceImageBrand("image", "quay.io/keycloak/keycloak:26").label,
    "Keycloak",
  );
  assert.equal(
    resourceImageBrand("image", "ghcr.io/paperless-ngx/paperless-ngx:latest")
      .label,
    "Paperless-ngx",
  );
});

void test("does not guess product identity from a private registry, suffix, tag, or lookalike", () => {
  for (const image of [
    "private.example/temporalio/server",
    "localhost:5000/axllent/mailpit",
    "company/postgres",
    "eviltemporalio/server",
    "temporalio/server-extra",
    "example/app:redis",
    "quay.io/axllent/mailpit",
    `sha256:${"a".repeat(64)}`,
    "",
    "https://docker.io/redis",
    "redis:",
    "redis@bad",
    "redis@sha256:",
    "redis@sha256:aaaa@another",
    "redis garbage",
    "REDIS",
    "docker.io//redis",
  ]) {
    assert.equal(resourceImageBrand("image", image).label, "Image", image);
  }
  assert.equal(
    normalizeImageRepository("registry.example:5000/team/redis:7"),
    "registry.example:5000/team/redis",
  );
});

void test("managed resource types keep their existing identity", () => {
  assert.equal(
    resourceImageBrand("postgres", "company/custom-db").logo,
    "/resource-types/postgres.png",
  );
  assert.equal(
    resourceImageBrand("redis", "company/custom-cache").logo,
    "/resource-types/redis.png",
  );
});

void test("every catalog entry has unique valid repositories and bundled artwork", () => {
  const repositories = new Set<string>();
  const ids = new Set<string>();
  for (const brand of catalog) {
    assert.ok(!ids.has(brand.id), brand.id);
    ids.add(brand.id);
    assert.ok(brand.repositories.length > 0, brand.id);
    for (const image of brand.repositories) {
      const key = normalizeImageRepository(image);
      assert.ok(key, image);
      assert.ok(!repositories.has(key), `Duplicate mapping: ${key}`);
      repositories.add(key);
      assert.equal(resourceImageBrand("image", image).label, brand.label);
    }
    for (const asset of [brand.logo, brand.logoDark].filter(
      (asset): asset is string => Boolean(asset),
    )) {
      assert.match(asset!, /^\/resource-logos\/[a-z0-9-]+\.(webp|svg)$/u);
      const path = new URL(`../../public${asset}`, import.meta.url);
      assert.ok(existsSync(path), asset);
      if (asset!.endsWith(".svg")) {
        assert.doesNotMatch(
          readFileSync(path, "utf8"),
          /<script|<foreignObject|\bon\w+=|(?:href|src)=["'](?:https?:|data:)/iu,
        );
      }
    }
  }
});
