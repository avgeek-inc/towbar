import { Hono } from "hono";
import { z } from "zod";
import {
  beginUpgradeLease,
  endUpgradeLease,
} from "../../../areas/upgrades/admission.js";
import { readJson } from "../../../http/requests.js";

export const internalUpgradeLeaseRoutes = new Hono();
internalUpgradeLeaseRoutes.post("/begin", async (context) => {
  const body = await readJson(
    context,
    z
      .object({
        id: z.uuid(),
        kind: z.string().min(1).max(120),
      })
      .strict(),
  );
  await beginUpgradeLease(body.id, body.kind);
  return context.json({ ok: true });
});
internalUpgradeLeaseRoutes.post("/end", async (context) => {
  const body = await readJson(context, z.object({ id: z.uuid() }).strict());
  await endUpgradeLease(body.id);
  return context.json({ ok: true });
});
