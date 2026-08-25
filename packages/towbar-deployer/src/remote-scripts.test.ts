import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildRemoteScript,
  configureCaddyScript,
  ensureNetworkRemoteScript,
  finalizeRemoteScript,
  hookRemoteScript,
  rollbackCandidateScript,
  scheduleFinalizeRemoteScript,
  startRemoteScript,
  startResourceRemoteScript,
} from "./remote-scripts.js";

void describe("remote deployment scripts", () => {
  void it("creates declared Docker networks idempotently", () => {
    assert.match(ensureNetworkRemoteScript, /docker network inspect/);
    assert.match(ensureNetworkRemoteScript, /docker network create/);
    assert.match(ensureNetworkRemoteScript, /--driver bridge/);
    assert.match(ensureNetworkRemoteScript, /towbar\.managed=true/);
  });

  void it("retains only the image tags supplied by the release ledger", () => {
    assert.match(finalizeRemoteScript, /for retained_image in "\$@"/);
    assert.match(
      finalizeRemoteScript,
      /if test "\$image" = "\$retained_image"/,
    );
    assert.doesNotMatch(finalizeRemoteScript, /CreatedAt/);
  });

  void it("restores both the Caddy route and Cloudflare environment", () => {
    assert.match(rollbackCandidateScript, /caddy\.previous\.state/);
    assert.match(rollbackCandidateScript, /cloudflare\.previous\.state/);
    assert.match(rollbackCandidateScript, /systemctl daemon-reload/);
    assert.match(
      rollbackCandidateScript,
      /docker start "\$previous_container"/,
    );
  });

  void it("does not log the Cloudflare token through Caddy's environment dump", () => {
    assert.match(configureCaddyScript, /EnvironmentFile=/);
    assert.match(configureCaddyScript, /ExecStart=/);
    assert.doesNotMatch(configureCaddyScript, /--environ/);
    assert.doesNotMatch(rollbackCandidateScript, /--environ/);
  });

  void it("bounds remote archive expansion before extracting", () => {
    assert.match(buildRemoteScript, /gzip -cd/);
    assert.match(buildRemoteScript, /max_expanded_bytes/);
    assert.match(buildRemoteScript, /max_archive_entries/);
    assert.match(buildRemoteScript, /--no-same-owner --no-same-permissions/);
  });

  void it("injects runtime secrets by key without putting values in argv", () => {
    assert.match(startRemoteScript, /secrets\/runtime/);
    assert.match(startRemoteScript, /secret_path\.read_text/);
    assert.match(startRemoteScript, /\("--env", secret_path\.name\)/);
    assert.match(startRemoteScript, /subprocess\.run/);
    assert.match(startRemoteScript, /\/usr\/bin\/docker run/);
    assert.doesNotMatch(startRemoteScript, /--env-file/);
  });

  void it("publishes the selected source revision to application runtimes", () => {
    assert.match(
      startRemoteScript,
      /--env "SOURCE_COMMIT=\$TOWBAR_COMMIT_SHA"/,
    );
  });

  void it("publishes applications on explicit restart-stable loopback ports", () => {
    assert.match(startRemoteScript, /port_minimum = 20_000/);
    assert.match(
      startRemoteScript,
      /127\.0\.0\.1:\{host_port\}:\{container_port\}/,
    );
    assert.match(startRemoteScript, /towbar\.host-port=__TOWBAR_HOST_PORT__/);
    assert.match(startRemoteScript, /port is already allocated/);
    assert.doesNotMatch(startRemoteScript, /127\.0\.0\.1::\$container_port/);
  });

  void it("starts resources with stable labeled volumes and stops only the previous release", () => {
    assert.match(startResourceRemoteScript, /docker volume create/);
    assert.match(
      startResourceRemoteScript,
      /towbar-\$deployable_id-\$logical_name/,
    );
    assert.match(
      startResourceRemoteScript,
      /docker stop --time 30 "\$previous_container"/,
    );
    assert.match(
      startResourceRemoteScript,
      /--label "towbar\.resource=\$deployable_id"/,
    );
    assert.match(
      startResourceRemoteScript,
      /--label "towbar\.deployable=\$TOWBAR_DEPLOYABLE_ID"/,
    );
    assert.match(
      startResourceRemoteScript,
      /--label "towbar\.source=\$TOWBAR_SOURCE_ID"/,
    );
    assert.match(startResourceRemoteScript, /secret_path\.read_text/);
    assert.doesNotMatch(startResourceRemoteScript, /--env-file/);
  });

  void it("keeps Resource aliases stable and publishes fixed access only on loopback", () => {
    assert.match(startResourceRemoteScript, /--network-alias/);
    assert.match(
      startResourceRemoteScript,
      /127\.0\.0\.1:\$host_port:\$container_port/,
    );
    assert.match(startResourceRemoteScript, /Docker network alias/);
    assert.match(startResourceRemoteScript, /Loopback host port/);
    assert.match(startResourceRemoteScript, /Docker Engine 28 or newer/);
    assert.match(startResourceRemoteScript, /probe\.bind\(\("127\.0\.0\.1"/);
    assert.doesNotMatch(
      startResourceRemoteScript,
      /docker_command\+=\(-p "\$host_port:/,
    );
  });

  void it("runs hooks in the built image with isolated secret injection and a timeout", () => {
    assert.match(hookRemoteScript, /secrets\/hooks\/\$hook_name/);
    assert.match(hookRemoteScript, /\/usr\/bin\/timeout/);
    assert.match(hookRemoteScript, /\/usr\/bin\/docker run --rm/);
    assert.match(hookRemoteScript, /secret_path\.read_text/);
    assert.match(hookRemoteScript, /"\$image_tag" "\$@"/);
  });

  void it("can defer self-managed worker cleanup until its activity returns", () => {
    assert.match(scheduleFinalizeRemoteScript, /sleep "\$delay_seconds"/);
    assert.match(scheduleFinalizeRemoteScript, /nohup bash -c/);
    assert.match(scheduleFinalizeRemoteScript, /label=towbar\.app=\$app_id/);
    assert.match(scheduleFinalizeRemoteScript, /name" != "\$container_name/);
  });
});
