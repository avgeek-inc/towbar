import { Context } from "@temporalio/activity";
import { createHash } from "node:crypto";
import {
  type LogDrainExecutionContext,
  reconcileLogDrains,
  reconcileOtlpCollector,
} from "@workspace/towbar-deployer";
import { signedApiRequest } from "../infrastructure/towbar-api.js";
export async function listLogDrainServersActivity() {
  return (
    await signedApiRequest<{ servers: { serverId: string }[] }>(
      "GET",
      "/v1/internal/log-drains/servers",
    )
  ).servers;
}
export async function reconcileLogDrainServerActivity(serverId: string) {
  const activity = Context.current();
  const pulse = setInterval(() => activity.heartbeat({ serverId }), 10_000);
  try {
    // Resolve secrets inside the activity so Temporal history never stores them.
    const { context } = await signedApiRequest<{
      context:
        | (LogDrainExecutionContext & {
            missing: string[];
            customOtlp:
              import("@workspace/towbar-core").ProviderConnection | null;
            customOtlpSlug: string | null;
            otlpNetworks: string[];
            otlpSignals: Array<"logs" | "metrics" | "traces">;
            otlpSampling: number;
            otlpRedactAttributes: string[];
            otlpCardinalityLimit: number;
          })
        | null;
    }>("GET", `/v1/internal/log-drains/${serverId}/context`);
    if (!context) return;
    const [result, otlp] = await Promise.all([
      reconcileLogDrains(context, activity.cancellationSignal),
      reconcileOtlpCollector(
        {
          serverId: context.serverId,
          config: context.config,
          login: context.login,
          trustedHostKeys: context.trustedHostKeys,
          connection:
            context.customOtlp?.provider === "otlp" ? context.customOtlp : null,
          connectionSlug: context.customOtlpSlug,
          networks: context.otlpNetworks,
          signals: context.otlpSignals,
          sampling: context.otlpSampling,
          redactAttributes: context.otlpRedactAttributes,
          cardinalityLimit: context.otlpCardinalityLimit,
        },
        activity.cancellationSignal,
      ),
    ]);
    await signedApiRequest(
      "POST",
      `/v1/internal/log-drains/${serverId}/complete`,
      {
        succeeded: true,
        ...result,
        active: result.active || otlp.active,
        digest: createHash("sha256")
          .update(`${result.digest}:${otlp.digest}`)
          .digest("hex"),
        diagnostics: {
          otlp,
        },
        missing: context.missing,
      },
    );
  } catch {
    await signedApiRequest(
      "POST",
      `/v1/internal/log-drains/${serverId}/complete`,
      { succeeded: false },
    ).catch(() => undefined);
    // SSH errors may include configuration output. Keep it out of workflow history.
    throw new Error("Log forwarding reconciliation failed");
  } finally {
    clearInterval(pulse);
  }
}
