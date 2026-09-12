import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
import { fileURLToPath } from "node:url";
import { startTestTarget } from "./target.mjs";
import {
  checkOriginEndpoint,
  checkPublicEndpoint,
} from "../../packages/towbar-deployer/dist/endpoint-health.js";

export async function startHttpsTarget() {
  const target = await startTestTarget({ systemd: true, https: true });
  const previousCertificates = getCACertificates("default");
  const previousBundle = process.env.CURL_CA_BUNDLE;
  const close = () => {
    setDefaultCACertificates(previousCertificates);
    if (previousBundle === undefined) delete process.env.CURL_CA_BUNDLE;
    else process.env.CURL_CA_BUNDLE = previousBundle;
    target.close();
  };
  try {
    const config =
      '{\n local_certs\n}\nimport /etc/caddy/towbar/*.caddy\nbootstrap.127.0.0.1.nip.io {\n respond "test HTTPS ready"\n}\n';
    target.ssh(
      `printf '%s' '${Buffer.from(config).toString("base64")}' | base64 -d | sudo tee /etc/caddy/Caddyfile >/dev/null && sudo systemctl reload caddy`,
    );
    const certificate = target.ssh(
      "sudo cat /root/.local/share/caddy/pki/authorities/local/root.crt",
    );
    const caPath = path.join(target.directory, "test-root.pem");
    writeFileSync(caPath, certificate);
    setDefaultCACertificates([...previousCertificates, certificate]);
    process.env.CURL_CA_BUNDLE = caPath;
    return { ...target, close };
  } catch (error) {
    close();
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = await startHttpsTarget();
  try {
    const signal = AbortSignal.timeout(20_000);
    await checkOriginEndpoint(
      "127.0.0.1",
      "bootstrap.127.0.0.1.nip.io",
      "/",
      signal,
    );
    await checkPublicEndpoint("bootstrap.127.0.0.1.nip.io", "/", signal);
    assert.equal(
      await (await fetch("https://bootstrap.127.0.0.1.nip.io")).text(),
      "test HTTPS ready",
    );
    console.log(
      "Real Caddy HTTPS passed origin and hostname checks with process-local CA trust.",
    );
  } finally {
    target.close();
  }
}
