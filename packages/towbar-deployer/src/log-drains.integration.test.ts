import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  type LogDrainCredential,
  logDrainEndpoint,
} from "@workspace/towbar-core";
import { buildLogDrainConfiguration, logDrainImage } from "./log-drains.js";
const docker = (...args: string[]) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const dockerLogs = (name: string) => {
  const result = spawnSync("docker", ["logs", name], { encoding: "utf8" });
  return result.stdout + result.stderr;
};
void test("provider-specific manifest attributes are included in log records", () => {
  const config = buildLogDrainConfiguration(
    "11111111-1111-4111-8111-111111111111",
    [
      {
        kind: "container",
        appId: "app",
        deploymentId: "deployment",
        repositoryId: "repository",
        teamId: "team",
        containerName: "towbar-app",
        name: "Website",
        environment: "production",
        providers: ["axiom", "otlp"],
        attributes: { axiom: { team: "payments" }, otlp: { tier: "critical" } },
      },
    ],
    [
      {
        provider: "axiom",
        apiKey: "test_token_1234",
        dataset: "logs",
        ingestHost: "us-east-1.aws.edge.axiom.co",
      },
      {
        provider: "otlp",
        endpoint: "https://collector.example.com/v1/logs",
        auth: "none",
        username: "",
        apiKey: "",
        headers: [],
        caCertificate: "",
      },
    ],
  );
  assert(config);
  assert.match(JSON.stringify(config.transforms.format_axiom), /payments/);
  assert.doesNotMatch(
    JSON.stringify(config.transforms.format_axiom),
    /critical/,
  );
  assert.match(JSON.stringify(config.transforms.format_otlp), /critical/);
  assert.match(JSON.stringify(config.transforms.format_otlp), /tier/);
});
void test(
  "Vector forwards only selected container logs using every provider contract",
  { skip: process.env.TOWBAR_LOG_DRAIN_DOCKER_TEST !== "1", timeout: 120_000 },
  async () => {
    const id = randomUUID().slice(0, 8),
      network = `towbar-drains-${id}`,
      app = `towbar-drain-app-${id}`,
      agent = `towbar-drain-agent-${id}`,
      receiver = `towbar-drain-receiver-${id}`;
    const directory = await mkdtemp(path.join(tmpdir(), "towbar-drains-"));
    const key = "test$TOKEN${VECTOR_LOG}" + randomBytes(16).toString("hex");
    const credentials: LogDrainCredential[] = [
      { provider: "newrelic", apiKey: key, region: "us" },
      {
        provider: "axiom",
        apiKey: key,
        dataset: "test",
        ingestHost: "us-east-1.aws.edge.axiom.co",
      },
      {
        provider: "betterstack",
        apiKey: key,
        ingestHost: "in.logs.betterstack.com",
      },
      { provider: "datadog", apiKey: key, site: "datadoghq.com" },
      {
        provider: "otlp",
        endpoint: "https://collector.example.com/v1/logs",
        auth: "headers",
        username: "",
        apiKey: "",
        headers: [{ name: "X-Collector-Key", value: key }],
        caCertificate: "",
      },
      {
        provider: "loki",
        endpoint: "https://logs.example.com/loki/api/v1/push",
        auth: "basic",
        username: "123456",
        apiKey: key,
        headers: [],
        tenantId: "towbar-test",
        caCertificate: "",
      },
    ];
    const config = buildLogDrainConfiguration(
      id,
      [
        {
          kind: "container",
          appId: id,
          deploymentId: id,
          repositoryId: id,
          teamId: id,
          containerName: app,
          name: "Website",
          environment: "production",
          providers: credentials.map((c) => c.provider),
          attributes: {
            axiom: { team: "payments" },
            otlp: { tier: "critical" },
          },
        },
      ],
      credentials,
    )!;
    for (const [provider, rawSink] of Object.entries(config.sinks)) {
      const sink = rawSink as Record<string, unknown>;
      const url = `http://${receiver}:18080`;
      if (sink.type === "opentelemetry")
        (sink.protocol as Record<string, unknown>).uri = `${url}/${provider}`;
      else if (provider === "loki") {
        sink.endpoint = url;
        sink.path = "/loki";
      } else sink.uri = `${url}/${provider}`;
    }
    await writeFile(
      path.join(directory, "vector.json"),
      JSON.stringify(config).replaceAll("$", "\\u0024"),
      { mode: 0o600 },
    );
    await writeFile(
      path.join(directory, "receiver.cjs"),
      `const http=require('http'), zlib=require('zlib');let events=[];http.createServer(async(req,res)=>{if(req.method==='GET'){res.setHeader('content-type','application/json');return res.end(JSON.stringify(events))}let data=[];for await(const chunk of req)data.push(chunk);let body=Buffer.concat(data);if(req.headers['content-encoding']==='gzip')body=zlib.gunzipSync(body);try{
        const otlp=req.url==='/otlp';
        const parsed=otlp ? body.toString('base64') : req.url.includes('/services/collector/event') ? JSON.parse('['+body.toString().replaceAll('}{','},{')+']') : JSON.parse(body);
        if(otlp) { const response=await fetch('http://${agent}-collector:4318/v1/logs',{method:'POST',headers:{'content-type':'application/x-protobuf'},body}); if(!response.ok)throw Error(await response.text()); }
        events.push({path:req.url.split('?')[0].replace(/^\\/\\//,'/'),headers:req.headers,body:parsed});
        if(otlp) {res.setHeader('content-type','application/x-protobuf');res.end();}else{res.setHeader('content-type','application/json');res.end(JSON.stringify({text:'Success',code:0}));}
      }catch(error){console.error(error);res.statusCode=400;res.end('bad')}}).listen(18080,'0.0.0.0');`,
    );
    await writeFile(
      path.join(directory, "collector.yaml"),
      `receivers:\n  otlp:\n    protocols:\n      http:\n        endpoint: 0.0.0.0:4318\nexporters:\n  file:\n    path: /logs.json\nservice:\n  pipelines:\n    logs:\n      receivers: [otlp]\n      exporters: [file]\n`,
    );
    const owned: string[] = [];
    try {
      docker("network", "create", network);
      docker(
        "create",
        "--name",
        `${agent}-collector`,
        "--network",
        network,
        "--user",
        "0",
        "otel/opentelemetry-collector-contrib:0.136.0",
        "--config=/etc/collector.yaml",
      );
      owned.push(`${agent}-collector`);
      docker(
        "cp",
        path.join(directory, "collector.yaml"),
        `${agent}-collector:/etc/collector.yaml`,
      );
      docker("start", `${agent}-collector`);
      await delay(500);
      assert.equal(
        docker("inspect", "-f", "{{.State.Running}}", `${agent}-collector`),
        "true",
        dockerLogs(`${agent}-collector`),
      );
      docker(
        "create",
        "--name",
        receiver,
        "--network",
        network,
        "-p",
        "127.0.0.1::18080",
        "node:24-alpine",
        "node",
        "/receiver.cjs",
      );
      owned.push(receiver);
      docker(
        "cp",
        path.join(directory, "receiver.cjs"),
        `${receiver}:/receiver.cjs`,
      );
      docker("start", receiver);
      const port = docker("port", receiver, "18080/tcp").split(":").at(-1)!;
      const validation = `${agent}-validate`;
      docker(
        "create",
        "--name",
        validation,
        "--network",
        "none",
        logDrainImage,
        "validate",
        "--no-environment",
        "--skip-healthchecks",
        "/vector.json",
      );
      owned.push(validation);
      docker(
        "cp",
        path.join(directory, "vector.json"),
        `${validation}:/vector.json`,
      );
      docker("start", "-a", validation);
      assert.equal(
        docker("inspect", "-f", "{{.State.ExitCode}}", validation),
        "0",
        dockerLogs(validation),
      );
      docker(
        "create",
        "--name",
        agent,
        "--network",
        network,
        "--mount",
        "type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock,readonly",
        logDrainImage,
        "--config",
        "/vector.json",
      );
      owned.push(agent);
      docker(
        "cp",
        path.join(directory, "vector.json"),
        `${agent}:/vector.json`,
      );
      docker("start", agent);
      for (const name of [app, `${app}-other`]) {
        docker(
          "run",
          "-d",
          "--name",
          name,
          "--label",
          "towbar.managed=true",
          "alpine:3.22",
          "sh",
          "-c",
          `while true; do echo '${name === app ? "selected-output" : "excluded-output"}'; sleep 1; done`,
        );
        owned.push(name);
      }
      type Delivery = {
        path: string;
        headers: Record<string, string>;
        body: unknown;
      };
      let deliveries: Delivery[] = [];
      for (let i = 0; i < 40; i++) {
        await delay(500);
        deliveries = (await (
          await fetch(`http://127.0.0.1:${port}`)
        ).json()) as Delivery[];
        if (new Set(deliveries.map((d) => d.path)).size === credentials.length)
          break;
      }
      assert.equal(
        new Set(deliveries.map((d) => d.path)).size,
        credentials.length,
        `all providers must receive actual Docker output: ${JSON.stringify(deliveries.map((d) => d.path))}\n${dockerLogs(agent)}\n${dockerLogs(receiver)}`,
      );
      for (const credential of credentials) {
        const expectedPath = `/${credential.provider}`;
        const delivery = deliveries.find((d) => d.path === expectedPath)!;
        assert(
          delivery,
          `Missing ${credential.provider}: ${JSON.stringify(deliveries.map((d) => d.path))}`,
        );
        for (const [header, value] of Object.entries(
          logDrainEndpoint(credential).headers,
        ))
          assert.equal(delivery.headers[header.toLowerCase()], value);
        if (credential.provider === "otlp") {
          assert.equal(
            delivery.headers["content-type"],
            "application/x-protobuf",
          );
          continue;
        }
        if (credential.provider === "loki") {
          assert.equal(
            delivery.headers.authorization,
            `Basic ${Buffer.from(`123456:${key}`).toString("base64")}`,
          );
          assert.equal(delivery.headers["x-scope-orgid"], "towbar-test");
          const body = delivery.body as {
            streams: { stream: Record<string, string>; values: string[][] }[];
          };
          assert.equal(body.streams[0]!.stream.service_name, "Website");
          assert.match(body.streams[0]!.values[0]![1]!, /selected-output/);
          continue;
        }
        assert(Array.isArray(delivery.body));
        const record =
          credential.provider === "newrelic"
            ? (delivery.body[0]!.logs as Record<string, unknown>[])[0]!
            : delivery.body[0]!;
        assert.match(String(record.message), /selected-output/);
        assert.equal(record.app_id, id);
        assert.equal(record.service, "Website");
        assert.equal(record.environment, "production");
        assert.equal(record.container_name, app);
        assert.equal(record.label, undefined);
        if (credential.provider === "axiom")
          assert.equal(record.team, "payments");
      }
      docker("stop", `${agent}-collector`);
      docker(
        "cp",
        `${agent}-collector:/logs.json`,
        path.join(directory, "collected.json"),
      );
      const { readFile } = await import("node:fs/promises");
      const records = (
        await readFile(path.join(directory, "collected.json"), "utf8")
      )
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert(
        records.length >= 1,
        "the OTLP destination must be decoded by an OpenTelemetry Collector",
      );
      const received = JSON.stringify(records);
      for (const value of [
        "selected-output",
        "service.name",
        "Website",
        "deployment.environment.name",
        "production",
        "towbar.server.id",
        "towbar.app.id",
        "container.name",
        app,
        "log.iostream",
        "timeUnixNano",
        "tier",
        "critical",
      ])
        assert(received.includes(value), `Missing OTLP field ${value}`);
      assert(!received.includes("excluded-output"));
      assert(
        !JSON.stringify(deliveries.map((d) => d.body)).includes(
          "excluded-output",
        ),
      );
      assert.equal(buildLogDrainConfiguration(id, [], credentials), null);
      assert.equal(
        buildLogDrainConfiguration(
          id,
          [
            {
              kind: "container",
              appId: id,
              deploymentId: id,
              repositoryId: id,
              teamId: id,
              containerName: app,
              name: "Website",
              environment: "production",
              providers: ["axiom"],
            },
          ],
          [],
        ),
        null,
      );
    } finally {
      for (const name of owned.reverse()) {
        try {
          docker("rm", "-f", name);
        } catch {
          // Cleanup also runs when setup failed before this resource was created.
        }
      }
      try {
        docker("network", "rm", network);
      } catch {
        // Cleanup also runs when setup failed before this resource was created.
      }
      await rm(directory, { recursive: true, force: true });
    }
  },
);
