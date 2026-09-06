import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

export async function assertScoutApiAccess({
  request,
  connect,
  read,
  write,
  ownedServerId,
  foreignServerId,
  setRole,
}: {
  request: (
    path: string,
    token?: string,
    method?: string,
    body?: unknown,
  ) => Promise<Response>;
  connect: (token: string) => Promise<Client>;
  read: { token: string };
  write: { token: string };
  ownedServerId: string;
  foreignServerId: string;
  setRole: (role: "owner" | "member") => Promise<unknown>;
}) {
  const path = `/servers/${ownedServerId}/scout-alerts`;
  const rule = {
    name: "CPU pressure",
    condition: {
      metric: "cpuPercent",
      threshold: 80,
    },
  };
  assert.equal((await request(path, read.token)).status, 200);
  assert.equal(
    (await request(`${path}/rules`, read.token, "POST", rule)).status,
    403,
  );
  assert.equal(
    (await request(`/servers/${foreignServerId}/scout-alerts`, write.token))
      .status,
    404,
  );
  const created = await request(`${path}/rules`, write.token, "POST", rule);
  assert.equal(created.status, 201, await created.clone().text());
  await setRole("member");
  try {
    assert.equal((await request(path, write.token)).status, 200);
    assert.equal(
      (
        await request(`${path}/mute`, write.token, "POST", {
          durationSeconds: 3600,
        })
      ).status,
      403,
    );
    const client = await connect(write.token);
    try {
      const inspect = await client.callTool({
        name: "towbar_alerts_inspect",
        arguments: { serverId: ownedServerId },
      });
      assert.equal(inspect.isError, false);
      const mutate = await client.callTool({
        name: "towbar_alerts_mute",
        arguments: { serverId: ownedServerId, durationSeconds: 3600 },
      });
      assert.equal(mutate.isError, true);
      const foreign = await client.callTool({
        name: "towbar_alerts_inspect",
        arguments: { serverId: foreignServerId },
      });
      assert.equal(foreign.isError, true);
    } finally {
      await client.close();
    }
  } finally {
    await setRole("owner");
  }
}

export async function connectTestMcpClient(
  token: string,
  fetch: (request: Request) => Promise<Response> | Response,
) {
  const client = new Client({ name: "towbar-integration-test", version: "1" });
  const transport = new StreamableHTTPClientTransport(
    new URL("http://localhost/v1/mcp"),
    {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
      fetch: async (input, init) => fetch(new Request(input, init)),
    },
  );
  await client.connect(transport);
  return client;
}
