import { Hono } from "hono";
import { z } from "zod";

import {
  normalizeServerConfiguration,
  serverConfigurationSchema,
} from "@workspace/towbar-core";

import {
  archiveServer,
  createServer,
  updateServer,
} from "../../../areas/servers/lifecycle.js";
import {
  getServer,
  listServerApps,
  listServerDeployments,
  listServerResources,
  listServers,
  requestServerCheck,
} from "../../../areas/servers/service.js";
import {
  listTrustedHostKeys,
  revokeServerHostKey,
  trustServerHostKey,
} from "../../../areas/servers/trusted-host-keys.js";
import { listServerChecks } from "../../../areas/servers/checks.js";
import {
  listServerPreparations,
  requestServerPreparation,
} from "../../../areas/servers/preparations.js";
import {
  getServerOrphans,
  requestOrphanCleanup,
} from "../../../areas/resource-operations/service.js";
import { getServerCapacity } from "../../../areas/servers/capacity.js";
import { badRequest, forbidden, notFound } from "../../../http/errors.js";
import { readJson } from "../../../http/requests.js";

import type { TowbarHonoEnvironment } from "../../../http/types.js";

const hostKeySchema = z
  .object({
    algorithm: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9@._+-]{0,79}$/u),
    fingerprint: z.string().trim().startsWith("SHA256:").max(255),
    publicKey: z.string().trim().min(32).max(16_384),
  })
  .strict();
const serverChecksQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(10),
    page: z.coerce.number().int().min(1).default(1),
  })
  .strict();
const cleanupSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            kind: z.enum(["container", "image", "volume"]),
            name: z.string().trim().min(1).max(512),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();

export const serverRoutes = new Hono<TowbarHonoEnvironment>();

serverRoutes.get("/", async (context) =>
  context.json({ servers: await listServers(context.get("user").workspaceId) }),
);
serverRoutes.post("/", async (context) => {
  const user = context.get("user");
  if (user.workspaceRole !== "owner") {
    throw forbidden("Only the owner can add servers");
  }
  const config = normalizeServerConfiguration(
    await readJson(context, serverConfigurationSchema),
  );
  return context.json(
    { server: await createServer({ config, workspaceId: user.workspaceId }) },
    201,
  );
});
serverRoutes.get("/:serverId", async (context) => {
  const user = context.get("user");
  return context.json({
    canCleanupOrphans: user.workspaceRole === "owner",
    canManageServer: user.workspaceRole === "owner",
    server: await getServer(context.req.param("serverId"), user.workspaceId),
  });
});
serverRoutes.patch("/:serverId", async (context) => {
  const user = context.get("user");
  if (user.workspaceRole !== "owner") {
    throw forbidden("Only the owner can update servers");
  }
  const config = normalizeServerConfiguration(
    await readJson(context, serverConfigurationSchema),
  );
  return context.json({
    server: await updateServer({
      config,
      serverId: context.req.param("serverId"),
      workspaceId: user.workspaceId,
    }),
  });
});
serverRoutes.delete("/:serverId", async (context) => {
  const user = context.get("user");
  if (user.workspaceRole !== "owner") {
    throw forbidden("Only the owner can remove servers");
  }
  await archiveServer(context.req.param("serverId"), user.workspaceId);
  return context.body(null, 204);
});
serverRoutes.get("/:serverId/apps", async (context) =>
  context.json({
    apps: await listServerApps(
      context.req.param("serverId"),
      context.get("user").workspaceId,
    ),
  }),
);
serverRoutes.get("/:serverId/resources", async (context) =>
  context.json({
    resources: await listServerResources(
      context.req.param("serverId"),
      context.get("user").workspaceId,
    ),
  }),
);
serverRoutes.get("/:serverId/deployments", async (context) =>
  context.json({
    deployments: await listServerDeployments(
      context.req.param("serverId"),
      context.get("user").workspaceId,
    ),
  }),
);
serverRoutes.get("/:serverId/capacity", async (context) => {
  const serverId = context.req.param("serverId");
  const workspaceId = context.get("user").workspaceId;
  await getServer(serverId, workspaceId);
  const capacity = await getServerCapacity(workspaceId, serverId);
  if (!capacity) throw notFound("Server capacity");
  return context.json({ capacity });
});
serverRoutes.get("/:serverId/checks", async (context) => {
  const pagination = serverChecksQuerySchema.parse(context.req.query());
  return context.json(
    await listServerChecks({
      ...pagination,
      serverId: context.req.param("serverId"),
      workspaceId: context.get("user").workspaceId,
    }),
  );
});
serverRoutes.get("/:serverId/preparations", async (context) =>
  context.json({
    preparations: await listServerPreparations(
      context.req.param("serverId"),
      context.get("user").workspaceId,
    ),
  }),
);
serverRoutes.get("/:serverId/orphans", async (context) =>
  context.json({
    orphans: await getServerOrphans(
      context.req.param("serverId"),
      context.get("user").workspaceId,
    ),
  }),
);
serverRoutes.get("/:serverId/host-keys", async (context) =>
  context.json({
    hostKeys: await listTrustedHostKeys(
      context.req.param("serverId"),
      context.get("user").workspaceId,
    ),
  }),
);
serverRoutes.post("/:serverId/actions/check", async (context) => {
  const user = context.get("user");
  return context.json(
    {
      check: await requestServerCheck({
        requestedBy: user.id,
        serverId: context.req.param("serverId"),
        workspaceId: user.workspaceId,
      }),
    },
    202,
  );
});
serverRoutes.post("/:serverId/actions/prepare", async (context) => {
  const user = context.get("user");
  return context.json(
    {
      preparation: await requestServerPreparation({
        requestedBy: user.id,
        serverId: context.req.param("serverId"),
        workspaceId: user.workspaceId,
      }),
    },
    202,
  );
});
serverRoutes.post("/:serverId/actions/cleanup-orphans", async (context) => {
  const user = context.get("user");
  if (user.workspaceRole !== "owner") {
    throw forbidden("Only administrators can remove orphaned Docker objects");
  }
  const result = await requestOrphanCleanup({
    idempotencyKey: requireIdempotencyKey(
      context.req.header("idempotency-key"),
    ),
    items: (await readJson(context, cleanupSchema)).items,
    requestedBy: user.id,
    serverId: context.req.param("serverId"),
    workspaceId: user.workspaceId,
  });
  return context.json(result, result.replayed ? 200 : 202);
});
serverRoutes.post("/:serverId/host-keys/actions/trust", async (context) => {
  const body = await readJson(context, hostKeySchema);
  const user = context.get("user");
  return context.json(
    {
      hostKey: await trustServerHostKey({
        ...body,
        serverId: context.req.param("serverId"),
        trustedBy: user.id,
        workspaceId: user.workspaceId,
      }),
    },
    201,
  );
});
serverRoutes.delete("/:serverId/host-keys/:hostKeyId", async (context) => {
  const user = context.get("user");
  await revokeServerHostKey({
    hostKeyId: context.req.param("hostKeyId"),
    serverId: context.req.param("serverId"),
    workspaceId: user.workspaceId,
  });
  return context.body(null, 204);
});

function requireIdempotencyKey(value: string | undefined) {
  const key = value?.trim();
  if (!key || key.length > 255) {
    throw badRequest(
      "A valid Idempotency-Key header is required",
      "IDEMPOTENCY_KEY_REQUIRED",
    );
  }
  return key;
}
