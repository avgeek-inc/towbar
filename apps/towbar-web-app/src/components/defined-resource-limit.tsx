import type { App } from "@workspace/towbar-web-client";

export type DefinedLimits = App["config"]["container"]["resources"];

export function DefinedResourceLimit({
  limits,
  metric,
  unavailable = false,
}: {
  limits: DefinedLimits;
  metric: "cpu" | "memory";
  unavailable?: boolean;
}) {
  const memoryUnits: Record<string, string> = {
    b: "B",
    k: "KiB",
    m: "MiB",
    g: "GiB",
  };
  const value = limits
    ? metric === "cpu"
      ? `${limits.cpus} vCPU`
      : limits.memory.replace(
          /([bkmg])$/i,
          (unit) => ` ${memoryUnits[unit.toLowerCase()]}`,
        )
    : unavailable
      ? "Unavailable"
      : "Not defined";
  return <span className="whitespace-nowrap tabular-nums">{value}</span>;
}
