import assert from "node:assert/strict";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { toPublicServer } from "../servers/public-server.js";

type ServerResponse = {
  server: { config: ReturnType<typeof toPublicServer>["config"] };
};
type Identity = { capabilities: string[] };

export function resultData<T>(
  result: Awaited<ReturnType<Client["callTool"]>>,
): T {
  assert.equal(result.isError, false, JSON.stringify(result.content));
  const content = result.content as Array<{ type: string; text?: string }>;
  const envelope = JSON.parse(
    content.find((item) => item.type === "text")!.text!,
  ) as { result: T };
  return envelope.result;
}

export async function assertServerConfigReadback({
  request,
  connect,
  read,
  write,
  ownedServerId,
  foreignServerId,
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
}) {
  const client = await connect(write.token);
  const reader = await connect(read.token);
  const path = `/servers/${ownedServerId}`;
  try {
    const initial = (await (
      await request(path, write.token)
    ).json()) as ServerResponse;
    assert.equal(initial.server.config.hostLogCollection, false);
    const identity = (await (
      await request("/identity", write.token)
    ).json()) as Identity;
    assert(identity.capabilities.includes("server.collectLogs"));
    const mcpIdentity = resultData<{ identity: Identity }>(
      await client.callTool({
        name: "towbar_workspace_inspect",
        arguments: {},
      }),
    );
    assert.deepEqual(mcpIdentity.identity.capabilities, identity.capabilities);
    const readerIdentity = resultData<{ identity: Identity }>(
      await reader.callTool({
        name: "towbar_workspace_inspect",
        arguments: {},
      }),
    );
    assert(
      !readerIdentity.identity.capabilities.includes("server.collectLogs"),
    );
    const tools = await client.listTools();
    assert.equal(
      (
        tools.tools.find(({ name }) => name === "towbar_server_configure")!
          .inputSchema.properties!.hostLogCollection as { type: string }
      ).type,
      "boolean",
    );
    for (const hostLogCollection of [true, false, true]) {
      const response = await request(path, write.token, "PATCH", {
        ...initial.server.config,
        hostLogCollection,
      });
      assert.equal(response.status, 200, await response.clone().text());
      const saved = (await response.json()) as ServerResponse;
      assert.equal(saved.server.config.hostLogCollection, hostLogCollection);
      const loaded = (await (
        await request(path, read.token)
      ).json()) as ServerResponse;
      assert.deepEqual(loaded.server.config, saved.server.config);
      const list = (await (await request("/servers", read.token)).json()) as {
        servers: Array<ServerResponse["server"] & { id: string }>;
      };
      assert.equal(
        list.servers.find(({ id }) => id === ownedServerId)!.config
          .hostLogCollection,
        hostLogCollection,
      );
      const inspected = resultData<{ server: ServerResponse }>(
        await client.callTool({
          name: "towbar_server_inspect",
          arguments: { serverId: ownedServerId },
        }),
      );
      assert.equal(
        inspected.server.server.config.hostLogCollection,
        hostLogCollection,
      );
    }
    // A connection/capacity save submits the settings it loaded from the API.
    const loaded = (await (
      await request(path, write.token)
    ).json()) as ServerResponse;
    const preserved = resultData<ServerResponse>(
      await client.callTool({
        name: "towbar_server_configure",
        arguments: {
          serverId: ownedServerId,
          ...loaded.server.config,
          buildConcurrency: 2,
        },
      }),
    );
    assert.equal(preserved.server.config.hostLogCollection, true);
    const disabled = resultData<ServerResponse>(
      await client.callTool({
        name: "towbar_server_configure",
        arguments: {
          serverId: ownedServerId,
          ...preserved.server.config,
          hostLogCollection: false,
        },
      }),
    );
    assert.equal(disabled.server.config.hostLogCollection, false);
    assert.equal(
      (
        await request(path, read.token, "PATCH", {
          ...initial.server.config,
          hostLogCollection: true,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await request(
          `/servers/${foreignServerId}`,
          write.token,
          "PATCH",
          initial.server.config,
        )
      ).status,
      404,
    );
    const forbidden = await reader.callTool({
      name: "towbar_server_configure",
      arguments: {
        serverId: ownedServerId,
        ...initial.server.config,
        hostLogCollection: true,
      },
    });
    assert.equal(forbidden.isError, true);
  } finally {
    await client.close();
    await reader.close();
  }
}
