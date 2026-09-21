import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import {
  UnsafeComposeConfigurationError,
  validateComposeRepository,
} from "./compose-security.js";

async function fixture(files: Record<string, string>) {
  const root = await mkdtemp(path.join(tmpdir(), "towbar-compose-security-"));
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return root;
}

void describe("Compose repository admission", () => {
  void test("accepts project-scoped services and recursive local includes", async () => {
    const root = await fixture({
      "compose.yml": `
include:
  - common/compose.yml
services:
  web:
    image: example.test/web@sha256:${"a".repeat(64)}
    env_file: config/web.env
    volumes:
      - data:/srv/data
volumes:
  data: {}
`,
      "common/compose.yml": `
services:
  worker:
    build:
      context: ..
      dockerfile: docker/Workerfile
`,
      "config/web.env": "MODE=production\n",
      "docker/Workerfile": "FROM scratch\n",
    });
    try {
      await validateComposeRepository(root, ["compose.yml"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  void test("rejects remote includes, external resources, published ports and host binds", async () => {
    const unsafeDocuments = [
      "include: https://example.test/compose.yml\nservices: {}\n",
      "services:\n  web:\n    image: x\nvolumes:\n  data:\n    external: true\n",
      "services:\n  web:\n    image: x\n    ports:\n      - '8080:80'\n",
      "services:\n  web:\n    image: x\n    volumes:\n      - './data:/data'\n",
    ];
    for (const content of unsafeDocuments) {
      const root = await fixture({ "compose.yml": content });
      try {
        await assert.rejects(
          validateComposeRepository(root, ["compose.yml"]),
          UnsafeComposeConfigurationError,
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  });

  void test("rejects Docker socket access, security overrides and host-backed volume drivers", async () => {
    const unsafeDocuments = [
      "services:\n  web:\n    image: x\n    use_api_socket: true\n",
      "services:\n  web:\n    image: x\n    cap_add: [NET_ADMIN]\n",
      "services:\n  web:\n    image: x\n    security_opt: [seccomp=unconfined]\n",
      "services:\n  web:\n    image: x\n    volumes: [data:/data]\nvolumes:\n  data:\n    driver: local\n    driver_opts:\n      type: none\n      o: bind\n      device: /\n",
      "services:\n  web:\n    image: x\nnetworks:\n  default:\n    attachable: true\n",
    ];
    for (const content of unsafeDocuments) {
      const root = await fixture({ "compose.yml": content });
      try {
        await assert.rejects(
          validateComposeRepository(root, ["compose.yml"]),
          UnsafeComposeConfigurationError,
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  });

  void test("rejects host-visible BuildKit cache, output and gateway configuration", async () => {
    const unsafeBuilds = [
      "cache_to: [type=local,dest=/tmp/output]",
      "output: [type=local,dest=/tmp/output]",
      "extra_hosts: [host.docker.internal=host-gateway]",
    ];
    for (const build of unsafeBuilds) {
      const root = await fixture({
        "compose.yml": `services:\n  web:\n    build:\n      context: .\n      ${build}\n`,
      });
      try {
        await assert.rejects(
          validateComposeRepository(root, ["compose.yml"]),
          UnsafeComposeConfigurationError,
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  });

  void test("rejects a repository symlink used as an include", async () => {
    const outside = await fixture({ "outside.yml": "services: {}\n" });
    const root = await fixture({
      "compose.yml": "include: linked.yml\nservices: {}\n",
    });
    await symlink(
      path.join(outside, "outside.yml"),
      path.join(root, "linked.yml"),
    );
    try {
      await assert.rejects(
        validateComposeRepository(root, ["compose.yml"]),
        UnsafeComposeConfigurationError,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
