import { randomUUID } from "node:crypto";
import { signedApiRequest } from "./towbar-api.js";

export async function withUpgradeLease<T>(
  kind: string,
  run: () => Promise<T>,
  request = signedApiRequest,
): Promise<T> {
  const id = randomUUID();
  // No work starts without an acknowledged lease. An uncertain begin/end stays
  // visible to the host runner and requires inspection, never a timed unlock.
  await request("POST", "/v1/internal/upgrade-leases/begin", { id, kind });
  try {
    return await run();
  } finally {
    try {
      await request("POST", "/v1/internal/upgrade-leases/end", { id });
    } catch {
      // Retrying a completed activity could repeat its remote effects. Keep the
      // original outcome; an uncertain lease remains a durable upgrade blocker.
      console.warn(
        "Upgrade lease release was not confirmed; inspect before upgrading",
        {
          id,
          kind,
        },
      );
    }
  }
}

export function guardActivities<
  T extends Record<string, (...args: never[]) => unknown>,
>(activities: T): T {
  return Object.fromEntries(
    Object.entries(activities).map(([name, activity]) => [
      name,
      (...args: never[]) =>
        withUpgradeLease(name, () => Promise.resolve(activity(...args))),
    ]),
  ) as T;
}
