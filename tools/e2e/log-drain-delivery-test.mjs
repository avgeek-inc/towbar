import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  normalizeServerConfiguration,
  logDrainCredentialSchema,
} from "../../packages/towbar-core/dist/index.js";
import {
  testLogDrainDelivery,
  scanHostKeys,
} from "../../packages/towbar-deployer/dist/index.js";
import { startTestTarget } from "./target.mjs";

const target = await startTestTarget();
try {
  // The production gateway rejects private and special-use destinations. Give
  // the isolated DinD bridge a globally routable-looking host alias so the
  // fixture exercises that same SSRF guard without weakening it.
  const deliveryAddress = "8.8.4.4";
  target.ssh(
    `sudo ip address add ${deliveryAddress}/32 dev docker0 2>/dev/null || true`,
  );
  const upload = (file, content) => {
    const local = path.join(target.directory, file);
    writeFileSync(local, content, { mode: 0o600 });
    execFileSync("docker", ["cp", local, `${target.container}:/root/${file}`]);
  };
  target.ssh(
    `sudo openssl req -x509 -newkey rsa:2048 -nodes -keyout /tmp/drain.key -out /tmp/drain.crt -days 1 -subj /CN=${deliveryAddress} -addext subjectAltName=IP:${deliveryAddress} >/dev/null 2>&1`,
  );
  upload(
    "drain-receiver.py",
    `import http.server,ssl,json,gzip
class Handler(http.server.BaseHTTPRequestHandler):
 def log_message(self,*args): pass
 def do_POST(self):
  data=self.rfile.read(int(self.headers.get('Content-Length',0)))
  if self.headers.get('Content-Encoding')=='gzip': data=gzip.decompress(data)
  ok=self.path=='/v1/logs' and self.headers.get('Authorization')=='Bearer test-only-token' and self.headers.get('Content-Type')=='application/x-protobuf' and len(data)>0
  self.send_response(200 if ok else 401)
  self.send_header('Content-Type','application/x-protobuf')
  self.end_headers()
  if ok:
   with open('/tmp/drain-delivery.json','w') as f: json.dump({'received':True,'bytes':len(data)},f)
s=http.server.HTTPServer(('0.0.0.0',18443),Handler)
ctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);ctx.load_cert_chain('/tmp/drain.crt','/tmp/drain.key')
s.socket=ctx.wrap_socket(s.socket,server_side=True)
s.serve_forever()
`,
  );
  upload(
    "drain-start.sh",
    "#!/bin/bash\nnohup python3 /root/drain-receiver.py >/tmp/drain-receiver.log 2>&1 </dev/null &\n",
  );
  target.ssh("sudo bash /root/drain-start.sh");
  const config = normalizeServerConfiguration({
    ip: "127.0.0.1",
    ssh: { username: "deploy", port: target.port },
  });
  const credential = logDrainCredentialSchema.parse({
    provider: "otlp",
    endpoint: `https://${deliveryAddress}:18443/v1/logs`,
    auth: "bearer",
    apiKey: "test-only-token",
    caCertificate: target.ssh("cat /tmp/drain.crt"),
  });
  const context = {
    config,
    credential,
    serverId: randomUUID(),
    testId: randomUUID(),
    login: { privateKey: readFileSync(target.key, "utf8") },
    trustedHostKeys: await scanHostKeys(config),
  };
  assert.equal((await testLogDrainDelivery(context)).sent, true);
  assert(JSON.parse(target.ssh("sudo cat /tmp/drain-delivery.json")).received);
  assert.equal(
    target.ssh("docker ps -a -q --filter name=towbar-log-test-"),
    "",
  );
  for (const change of [
    { caCertificate: "" },
    { endpoint: `https://${deliveryAddress}:18443/reject` },
  ]) {
    const failed = await testLogDrainDelivery({
      ...context,
      testId: randomUUID(),
      credential: { ...credential, ...change },
    });
    assert.equal(failed.sent, false);
    assert.equal(
      failed.health[0].status,
      change.endpoint ? "auth_failure" : "retrying",
    );
    assert.equal(
      target.ssh("docker ps -a -q --filter name=towbar-log-test-"),
      "",
    );
  }
  await assert.rejects(
    testLogDrainDelivery({ ...context, trustedHostKeys: [] }),
    /not.*trusted/i,
  );
  assert.equal(
    target.ssh("find /tmp -maxdepth 1 -type d -name 'towbar-log-test.*'"),
    "",
  );
  console.log(
    "Delivery test passed over verified SSH and TLS; invalid CA and HTTP rejection fail, and test containers and credentials are cleaned up.",
  );
} finally {
  target.close();
}
