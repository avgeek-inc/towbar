import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  normalizeServerConfiguration,
  logDrainCredentialSchema,
} from "../../packages/towbar-core/dist/index.js";
import {
  reconcileLogDrains,
  scanHostKeys,
  logDrainGatewayImage,
} from "../../packages/towbar-deployer/dist/index.js";
import { startTestTarget } from "./target.mjs";

const target = await startTestTarget();
try {
  const upload = (file, content) => {
    const local = path.join(target.directory, file);
    writeFileSync(local, content, { mode: 0o600 });
    execFileSync("docker", ["cp", local, `${target.container}:/root/${file}`]);
  };
  const deliveryAddress = "8.8.4.4";
  target.ssh(
    `sudo ip address add ${deliveryAddress}/32 dev docker0 2>/dev/null || true`,
  );
  target.ssh(
    `sudo openssl req -x509 -newkey rsa:2048 -nodes -keyout /tmp/receiver.key -out /tmp/receiver.crt -days 1 -subj /CN=${deliveryAddress} -addext subjectAltName=IP:${deliveryAddress} >/dev/null 2>&1`,
  );
  upload(
    "receiver.py",
    `import http.server,ssl,json,threading,gzip
counts={};seen=set();ready=False;complete=False;lock=threading.Lock()
class Handler(http.server.BaseHTTPRequestHandler):
 def log_message(self,*args): pass
 def do_POST(self):
  global ready,complete
  length=int(self.headers.get('Content-Length',0));data=self.rfile.read(length)
  with lock:
   if self.path=='/loki':
    if self.headers.get('Content-Encoding')=='gzip': data=gzip.decompress(data)
    for stream in json.loads(data)['streams']:
     for value in stream['values']:
      message=json.loads(value[1])['message']
      if message=='LOAD_READY': ready=True
      elif message=='LOAD_COMPLETE': complete=True
      elif ':' in message: seen.add(int(message.split(':',1)[0]))
    counts['uniqueLines']=len(seen);counts['ready']=ready;counts['complete']=complete
   counts[self.path]=counts.get(self.path,0)+1
   with open('/tmp/received.json','w') as f: json.dump(counts,f)
  self.send_response(401 if self.path=='/otlp' else 200)
  self.send_header('Content-Length','0');self.end_headers()
s=http.server.ThreadingHTTPServer(('0.0.0.0',18443),Handler)
c=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);c.load_cert_chain('/tmp/receiver.crt','/tmp/receiver.key');s.socket=c.wrap_socket(s.socket,server_side=True);s.serve_forever()
`,
  );
  upload(
    "start-receiver.sh",
    "nohup python3 /root/receiver.py >/tmp/receiver.log 2>&1 </dev/null &\n",
  );
  target.ssh("sudo bash /root/start-receiver.sh");
  const serverId = randomUUID();
  const config = normalizeServerConfiguration({
    ip: "127.0.0.1",
    ssh: { username: "deploy", port: target.port },
  });
  const caCertificate = target.ssh("cat /tmp/receiver.crt");
  const context = {
    serverId,
    config,
    login: { privateKey: readFileSync(target.key, "utf8") },
    trustedHostKeys: await scanHostKeys(config),
    credentials: [
      ...["otlp", "loki"].map((provider) =>
        logDrainCredentialSchema.parse({
          provider,
          endpoint: `https://${deliveryAddress}:18443/${provider}`,
          auth: "bearer",
          apiKey: "test-only-token",
          caCertificate,
        }),
      ),
    ],
    targets: [
      {
        containerName: "log-load",
        appId: randomUUID(),
        name: "Load test",
        environment: "test",
        providers: ["otlp", "loki"],
      },
    ],
  };
  const base = `/var/lib/towbar/log-drains/${serverId}`;
  const vector = `towbar-log-drains-${serverId}`,
    controller = `towbar-log-delivery-${serverId}`;
  await reconcileLogDrains(context);
  upload(
    "load.py",
    `import time,sys,json,os
while not os.path.exists('/control/start'):
 print('LOAD_READY',flush=True)
 time.sleep(.5)
start=time.monotonic()
for i in range(80000):
 print(str(i)+':'+('x'*8192))
 if i%1000==0: time.sleep(.1)
print('LOAD_COMPLETE',flush=True)
with open('/control/load-result.json','w') as f: json.dump({'seconds':time.monotonic()-start,'lines':80000},f)
time.sleep(180)
`,
  );
  target.ssh(
    `sudo mkdir -p /root/log-load-control && sudo chmod 777 /root/log-load-control`,
  );
  target.ssh(
    `docker run -d --name log-load --label towbar.managed=true --memory 64m --cpus 0.5 --log-opt max-size=1g --log-opt max-file=1 --mount type=bind,src=/root/load.py,dst=/load.py,readonly --mount type=bind,src=/root/log-load-control,dst=/control ${logDrainGatewayImage} python -u /load.py`,
  );
  let sourceReady = false;
  const sourceDeadline = Date.now() + 60000;
  while (Date.now() < sourceDeadline) {
    const raw = target.ssh(
      "sudo cat /tmp/received.json 2>/dev/null || printf '{}'",
    );
    if (JSON.parse(raw || "{}").ready) {
      sourceReady = true;
      break;
    }
    await delay(500);
  }
  assert(
    sourceReady,
    "The forwarder must attach to the application log stream",
  );
  target.ssh("sudo touch /root/log-load-control/start");
  const unrelated = target.ssh(
    `docker run --rm --memory 32m --cpus 0.25 ${logDrainGatewayImage} python -c 'print("application-work-complete")'`,
  );
  assert.equal(unrelated, "application-work-complete");
  let peakVector = 0,
    peakController = 0,
    completed;
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const usage = target.ssh(
      `docker stats --no-stream --format '{{.Name}} {{.MemUsage}}' ${vector} ${controller}`,
    );
    for (const line of usage.split("\n")) {
      const match = /^(\S+) ([0-9.]+)([KMGT]iB)/.exec(line);
      if (!match) continue;
      const mib =
        Number(match[2]) *
        { KiB: 1 / 1024, MiB: 1, GiB: 1024, TiB: 1048576 }[match[3]];
      if (match[1] === vector) peakVector = Math.max(peakVector, mib);
      else peakController = Math.max(peakController, mib);
    }
    const raw = target.ssh(
      "sudo cat /root/log-load-control/load-result.json 2>/dev/null || true",
    );
    if (raw) {
      completed = JSON.parse(raw);
      break;
    }
    await delay(1000);
  }
  assert(
    completed,
    "The application must finish writing logs without waiting for destinations",
  );
  assert(completed.seconds < 120);
  let health;
  const deliveryDeadline = Date.now() + 120000;
  while (Date.now() < deliveryDeadline) {
    health = JSON.parse(target.ssh(`sudo cat ${base}/state/status.json`));
    const delivery = JSON.parse(
      target.ssh("sudo cat /tmp/received.json 2>/dev/null || printf '{}'") ||
        "{}",
    );
    if (
      health.otlp.status === "auth_failure" &&
      delivery.complete &&
      delivery.uniqueLines === 80000
    )
      break;
    await delay(1000);
  }

  assert.equal(health.otlp.status, "auth_failure");
  assert(
    health.loki.acceptedBatches > 1,
    "An authentication-failed destination must not block a healthy destination",
  );
  assert(
    health.loki.acceptedBatches < completed.lines / 5,
    "Logs must be batched rather than sent one request per line",
  );
  const counts = JSON.parse(target.ssh("sudo cat /tmp/received.json"));
  assert.equal(
    counts.uniqueLines,
    80000,
    "Every application log must reach the healthy destination",
  );
  assert.equal(counts.complete, true);
  assert.equal(
    counts["/otlp"],
    1,
    "No upstream retry after authentication rejection",
  );
  for (const name of [vector, controller]) {
    assert.equal(
      target.ssh(
        `docker inspect -f '{{.State.OOMKilled}} {{.RestartCount}} {{.State.Running}}' ${name}`,
      ),
      "false 0 true",
    );
  }
  assert(peakVector < 256 && peakController < 128);
  const before = target.ssh(`docker inspect -f '{{.Id}}' ${vector}`);
  const reconciled = await reconcileLogDrains(context);
  assert.equal(
    target.ssh(`docker inspect -f '{{.Id}}' ${vector}`),
    before,
    "Health polls must not restart a running stream",
  );
  assert.equal(
    reconciled.health.find((item) => item.provider === "otlp").status,
    "auth_failure",
  );
  console.log(
    JSON.stringify({
      ...completed,
      peakVectorMiB: peakVector,
      peakControllerMiB: peakController,
      acceptedBatches: health.loki.acceptedBatches,
      authAttempts: counts["/otlp"],
      unrelatedApplicationWork: "passed",
    }),
  );
} finally {
  target.close();
}
