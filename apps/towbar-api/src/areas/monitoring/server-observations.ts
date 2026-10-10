import { and, desc, eq, ne } from "drizzle-orm";
import {
  type MonitoringSample,
  type ServerHardware,
  serverHardwareFromCheck,
} from "@workspace/towbar-core";
import {
  serverChecks,
  serverEvents,
  serverObservations,
} from "@workspace/towbar-database/schema";
import type { getTowbarDatabase } from "../../infrastructure/database.js";

type Transaction = Parameters<
  Parameters<ReturnType<typeof getTowbarDatabase>["transaction"]>[0]
>[0];
type Observation = typeof serverObservations.$inferSelect;

type Input = {
  at: Date;
  hardware: ServerHardware;
  host?: MonitoringSample["host"];
  checkId?: string;
};

export function hardwareChange(before: ServerHardware, after: ServerHardware) {
  if (
    before.instance?.type &&
    after.instance?.type &&
    (before.instance.provider !== after.instance.provider ||
      before.instance.type !== after.instance.type)
  )
    return {
      type: "instance-change" as const,
      detail: `${before.instance.type} → ${after.instance.type}`,
    };
  const changes: string[] = [];
  if (before.cpuCount && after.cpuCount && before.cpuCount !== after.cpuCount)
    changes.push(`${before.cpuCount} → ${after.cpuCount} vCPUs`);
  // Kernel reservations can change slightly across reboots; that is not a resize.
  if (
    before.memoryBytes &&
    after.memoryBytes &&
    Math.abs(after.memoryBytes / before.memoryBytes - 1) > 0.01
  )
    changes.push(
      `${(before.memoryBytes / 1024 ** 3).toFixed(1)} → ${(after.memoryBytes / 1024 ** 3).toFixed(1)} GiB memory`,
    );
  return changes.length
    ? { type: "capacity-change" as const, detail: changes.join(", ") }
    : null;
}

export async function observeServer(
  transaction: Transaction,
  serverId: string,
  input: Input,
) {
  await transaction
    .insert(serverObservations)
    .values({ serverId })
    .onConflictDoNothing();
  const [previous] = await transaction
    .select()
    .from(serverObservations)
    .where(eq(serverObservations.serverId, serverId))
    .for("update");
  if (!previous) return;
  if (!previous.hardwareAt) {
    const [check] = await transaction
      .select()
      .from(serverChecks)
      .where(
        and(
          eq(serverChecks.serverId, serverId),
          eq(serverChecks.status, "succeeded"),
          input.checkId ? ne(serverChecks.id, input.checkId) : undefined,
        ),
      )
      .orderBy(desc(serverChecks.createdAt), desc(serverChecks.id))
      .limit(1);
    if (check) {
      previous.hardware = serverHardwareFromCheck(check.result);
      previous.hardwareAt = check.startedAt ?? check.createdAt;
      previous.instanceAt = previous.hardware?.instance
        ? previous.hardwareAt
        : null;
    }
  }
  const update: Partial<Observation> = nextHardwareObservation(previous, input);
  const events: Array<typeof serverEvents.$inferInsert> = [];
  const change =
    previous.hardware &&
    update.hardware &&
    hardwareChange(previous.hardware, update.hardware);
  if (change) events.push({ serverId, at: input.at, ...change });
  if (
    input.host &&
    (!previous.bootObservedAt || input.at > previous.bootObservedAt)
  ) {
    if (previous.bootId && previous.bootId !== input.host.bootId) {
      const bootAt = new Date(input.host.bootStartedAt);
      const reliableTime =
        bootAt <= input.at && bootAt > previous.bootObservedAt!;
      events.push({
        serverId,
        at: reliableTime ? bootAt : input.at,
        type: "host-restart",
        detail: reliableTime
          ? "Host boot time reported by the kernel"
          : "Host restart detected by Scout",
      });
    }
    update.bootId = input.host.bootId;
    update.bootObservedAt = input.at;
  }
  if (Object.keys(update).length)
    await transaction
      .update(serverObservations)
      .set(update)
      .where(eq(serverObservations.serverId, serverId));
  if (events.length) await transaction.insert(serverEvents).values(events);
}

function nextHardwareObservation(
  previous: Observation,
  input: Input,
): Partial<Observation> {
  const capacityNewer = !previous.hardwareAt || input.at > previous.hardwareAt;
  const instanceNewer =
    input.hardware.instance &&
    (!previous.instanceAt || input.at > previous.instanceAt);
  return {
    hardware: {
      instance: instanceNewer
        ? input.hardware.instance
        : (previous.hardware?.instance ?? null),
      cpuCount:
        (capacityNewer ? input.hardware.cpuCount : null) ??
        previous.hardware?.cpuCount ??
        null,
      memoryBytes:
        (capacityNewer ? input.hardware.memoryBytes : null) ??
        previous.hardware?.memoryBytes ??
        null,
    },
    hardwareAt: capacityNewer ? input.at : previous.hardwareAt,
    instanceAt: instanceNewer ? input.at : previous.instanceAt,
  };
}

export async function observeServerCheck(
  transaction: Transaction,
  check: typeof serverChecks.$inferSelect,
) {
  const hardware = serverHardwareFromCheck(check.result);
  if (hardware)
    await observeServer(transaction, check.serverId, {
      at: check.startedAt ?? check.createdAt,
      hardware,
      checkId: check.id,
    });
}
