import { Hono } from "hono";
import {
  deploymentComparisonQuerySchema,
  scoutAlertRuleSchema,
  scoutIncidentQuerySchema,
  scoutMuteSchema,
} from "@workspace/towbar-core";
import {
  deleteScoutAlertRule,
  listScoutAlertRules,
  listScoutIncidents,
  muteScoutAlerts,
  saveScoutAlertRule,
} from "../../../areas/monitoring/alert-rules.js";
import {
  getDeploymentComparison,
  listComparisonDeployments,
} from "../../../areas/monitoring/deployment-comparison.js";
import { operation } from "../../../http/operation.js";
import { readJson } from "../../../http/requests.js";
import { forbidden } from "../../../http/errors.js";
import type { TowbarHonoEnvironment } from "../../../http/types.js";

export const scoutAlertRoutes = new Hono<TowbarHonoEnvironment>();
scoutAlertRoutes.get(
  "/",
  operation({
    responseSchema: 'scout-alerts.ts:get:"/"',
    summary: "Inspect Scout alert rules",
    response:
      "Rules, evaluation status, maintenance mute, and available destinations.",
    status: 200,
  }),
  async (context) => {
    return context.json(
      await listScoutAlertRules({
        serverId: context.req.param("serverId")!,
        workspaceId: context.get("user").workspaceId,
      }),
    );
  },
);
scoutAlertRoutes.post(
  "/rules",
  operation({
    responseSchema: 'scout-alerts.ts:post:"/rules"',
    summary: "Create Scout alert rule",
    body: scoutAlertRuleSchema,
    ownerOnly: true,
    response:
      "The saved rule; notifications start only after the condition is satisfied.",
    status: 201,
  }),
  async (context) => {
    const user = context.get("user");
    requireOwner(user.workspaceRole);
    return context.json(
      {
        rule: await saveScoutAlertRule({
          serverId: context.req.param("serverId")!,
          workspaceId: user.workspaceId,
          requestedBy: user.id,
          rule: await readJson(context, scoutAlertRuleSchema),
        }),
      },
      201,
    );
  },
);
scoutAlertRoutes.put(
  "/rules/:ruleId",
  operation({
    responseSchema: 'scout-alerts.ts:put:"/rules/:ruleId"',
    summary: "Update Scout alert rule",
    body: scoutAlertRuleSchema,
    ownerOnly: true,
    response:
      "Updated rule. Changing its condition closes the prior incident without claiming recovery.",
    status: 200,
  }),
  async (context) => {
    const user = context.get("user");
    requireOwner(user.workspaceRole);
    return context.json({
      rule: await saveScoutAlertRule({
        serverId: context.req.param("serverId")!,
        ruleId: context.req.param("ruleId"),
        workspaceId: user.workspaceId,
        requestedBy: user.id,
        rule: await readJson(context, scoutAlertRuleSchema),
      }),
    });
  },
);
scoutAlertRoutes.delete(
  "/rules/:ruleId",
  operation({
    responseSchema: 'scout-alerts.ts:delete:"/rules/:ruleId"',
    summary: "Delete Scout alert rule",
    ownerOnly: true,
    response: "Stops evaluation and preserves incident history.",
    status: 204,
  }),
  async (context) => {
    const user = context.get("user");
    requireOwner(user.workspaceRole);
    await deleteScoutAlertRule({
      serverId: context.req.param("serverId")!,
      ruleId: context.req.param("ruleId"),
      workspaceId: user.workspaceId,
      requestedBy: user.id,
    });
    return context.body(null, 204);
  },
);
scoutAlertRoutes.post(
  "/mute",
  operation({
    responseSchema: 'scout-alerts.ts:post:"/mute"',
    summary: "Mute server Scout alerts",
    body: scoutMuteSchema,
    ownerOnly: true,
    response:
      "Mutes notifications temporarily while continuing incident evaluation. Zero removes the mute.",
    status: 200,
  }),
  async (context) => {
    const user = context.get("user");
    requireOwner(user.workspaceRole);
    return context.json(
      await muteScoutAlerts({
        serverId: context.req.param("serverId")!,
        workspaceId: user.workspaceId,
        requestedBy: user.id,
        ...(await readJson(context, scoutMuteSchema)),
      }),
    );
  },
);
scoutAlertRoutes.post(
  "/rules/:ruleId/mute",
  operation({
    responseSchema: 'scout-alerts.ts:post:"/rules/:ruleId/mute"',
    summary: "Mute a Scout alert rule",
    body: scoutMuteSchema,
    ownerOnly: true,
    response: "Temporarily mutes one rule. Zero removes the mute.",
    status: 200,
  }),
  async (context) => {
    const user = context.get("user");
    requireOwner(user.workspaceRole);
    return context.json(
      await muteScoutAlerts({
        serverId: context.req.param("serverId")!,
        ruleId: context.req.param("ruleId"),
        workspaceId: user.workspaceId,
        requestedBy: user.id,
        ...(await readJson(context, scoutMuteSchema)),
      }),
    );
  },
);
scoutAlertRoutes.get(
  "/incidents",
  operation({
    responseSchema: 'scout-alerts.ts:get:"/incidents"',
    summary: "List Scout incidents",
    query: scoutIncidentQuerySchema,
    response:
      "Paginated active and resolved incidents with observed values and resolution reasons.",
    status: 200,
  }),
  async (context) => {
    return context.json(
      await listScoutIncidents({
        serverId: context.req.param("serverId")!,
        workspaceId: context.get("user").workspaceId,
        ...scoutIncidentQuerySchema.parse(context.req.query()),
      }),
    );
  },
);

export const scoutComparisonRoutes = new Hono<TowbarHonoEnvironment>();
scoutComparisonRoutes.get(
  "/workloads/:deployableId/comparison-deployments",
  operation({
    responseSchema:
      'scout-alerts.ts:get:"/workloads/:deployableId/comparison-deployments"',
    summary: "List deployments available for comparison",
    response:
      "The latest 100 successful deployments for this workload, including environment and commit.",
    status: 200,
  }),
  async (context) => {
    return context.json({
      deployments: await listComparisonDeployments({
        deployableId: context.req.param("deployableId"),
        workspaceId: context.get("user").workspaceId,
      }),
    });
  },
);
scoutComparisonRoutes.get(
  "/workloads/:deployableId/deployment-comparison",
  operation({
    responseSchema:
      'scout-alerts.ts:get:"/workloads/:deployableId/deployment-comparison"',
    summary: "Compare deployment performance",
    query: deploymentComparisonQuerySchema,
    response:
      "Equal relative observation windows, aligned metrics, sample coverage, changes and comparison limitations.",
    status: 200,
  }),
  async (context) => {
    return context.json(
      await getDeploymentComparison({
        deployableId: context.req.param("deployableId"),
        workspaceId: context.get("user").workspaceId,
        ...deploymentComparisonQuerySchema.parse(context.req.query()),
      }),
    );
  },
);
function requireOwner(role: string) {
  if (role !== "owner")
    throw forbidden("Only the owner can configure Scout alerts");
}
