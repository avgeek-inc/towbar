import { z } from "zod";
import {
  deploymentComparisonQuerySchema,
  scoutAlertRuleSchema,
  scoutIncidentQuerySchema,
  scoutMuteSchema,
} from "@workspace/towbar-core";
import { type McpTool, id, records, serverId, tool } from "./mcp-toolkit.js";

export const scoutTools: McpTool[] = [
  tool(
    "alerts_inspect",
    "Inspect Scout alerts and incidents",
    "Inspect configured rules, latest evaluations and HTTP check results, maintenance mute, destination IDs, and a page of incidents. An active incident is not proof that its notification was delivered. Use returned rule IDs before configuration or muting; use the incident cursor to read older history.",
    z.object({ ...serverId, ...scoutIncidentQuerySchema.shape }).strict(),
    async (a, c) => {
      const { serverId: target, ...query } = a;
      const path = { serverId: target };
      const [settings, incidents] = await Promise.all([
        c.call({
          method: "GET",
          route: "/servers/:serverId/scout-alerts",
          path,
        }),
        c.call({
          method: "GET",
          route: "/servers/:serverId/scout-alerts/incidents",
          path,
          query,
        }),
      ]);
      return { ...settings, ...incidents };
    },
  ),
  tool(
    "alerts_configure",
    "Create or update a Scout alert",
    "Configure a sustained host/workload metric alert or a public HTTP uptime check. Omit ruleId to create; supply an inspected ruleId to replace its settings. Read current settings before updating and preserve settings the user did not request changing. HTTP checks send recurring public requests. Selecting destinations enables external notifications once the condition fires; it does not send an immediate test.",
    scoutAlertRuleSchema
      .safeExtend({ ...serverId, ruleId: id("Scout alert rule").optional() })
      .strict(),
    async (a, c) => {
      const { serverId: target, ruleId, ...body } = a;
      return c.call({
        method: ruleId ? "PUT" : "POST",
        route: `/servers/:serverId/scout-alerts/rules${ruleId ? "/:ruleId" : ""}`,
        path: { serverId: target, ...(ruleId ? { ruleId } : {}) },
        body,
      });
    },
    { readOnly: false, ownerOnly: true, destructive: false, idempotent: false },
  ),
  tool(
    "alerts_mute",
    "Mute Scout notifications for maintenance",
    "Temporarily mute notifications from one Scout rule or every rule on a server while continuing measurements and incident tracking. Omit ruleId for server scope. Set durationSeconds to zero to resume notifications. A rule mute cannot override a server mute.",
    scoutMuteSchema
      .safeExtend({ ...serverId, ruleId: id("Scout alert rule").optional() })
      .strict(),
    async (a, c) => {
      const { serverId: target, ruleId, ...body } = a;
      return c.call({
        method: "POST",
        route: `/servers/:serverId/scout-alerts${ruleId ? "/rules/:ruleId" : ""}/mute`,
        path: { serverId: target, ...(ruleId ? { ruleId } : {}) },
        body,
      });
    },
    { readOnly: false, ownerOnly: true, destructive: false, idempotent: false },
  ),
  tool(
    "alerts_remove",
    "Remove a Scout alert rule",
    "Delete an inspected Scout rule, stop its checks/evaluation and close active incidents without claiming recovery. Resolved incident history remains until retention expires. Confirm the user's intended rule before removal.",
    z.object({ ...serverId, ruleId: id("Scout alert rule") }).strict(),
    async (a, c) =>
      c.call({
        method: "DELETE",
        route: "/servers/:serverId/scout-alerts/rules/:ruleId",
        path: a,
      }),
    { readOnly: false, ownerOnly: true, destructive: true },
  ),
  tool(
    "deployment_compare",
    "Compare performance between deployments",
    "First call with workloadId only to discover successful deployment IDs. Then supply baselineId and candidateId from the same workload and production/preview environment to compare equal post-readiness windows. Reports coverage, usage deltas, restarts and caveats; insufficient data cannot establish a regression and traffic may differ. Defaults to summaries; includePoints returns at most 24 representative points per side.",
    z
      .object({
        workloadId: id("App or resource"),
        ...deploymentComparisonQuerySchema.shape,
        baselineId: id("Baseline deployment").optional(),
        candidateId: id("Compared deployment").optional(),
        includePoints: z.boolean().default(false),
      })
      .strict()
      .refine(
        (a) =>
          Boolean(a.baselineId) === Boolean(a.candidateId) &&
          (!a.baselineId || a.baselineId !== a.candidateId),
        "Choose two different deployment IDs, or omit both to discover candidates",
      ),
    async (a, c) => {
      const path = { deployableId: a.workloadId };
      if (!a.baselineId || !a.candidateId)
        return c.call({
          method: "GET",
          route: "/workloads/:deployableId/comparison-deployments",
          path,
        });
      const { workloadId: _id, includePoints, ...query } = a;
      const result = await c.call({
        method: "GET",
        route: "/workloads/:deployableId/deployment-comparison",
        path,
        query,
      });
      for (const key of ["baseline", "candidate"]) {
        const side = result[key] as Record<string, unknown> | undefined;
        if (!side) continue;
        const { points, ...summary } = side;
        const values = records(points),
          stride = Math.max(1, Math.ceil(values.length / 24));
        result[key] = {
          ...summary,
          ...(includePoints
            ? {
                points: values.filter((_, index) => index % stride === 0),
                pointsSampled: stride > 1,
              }
            : {}),
        };
      }
      return result;
    },
  ),
];
