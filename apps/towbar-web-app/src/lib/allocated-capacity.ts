function usagePercent(
  used: number | null | undefined,
  allocated: number | undefined,
) {
  if (
    used == null ||
    !Number.isFinite(used) ||
    used < 0 ||
    allocated == null ||
    !Number.isFinite(allocated) ||
    allocated <= 0
  )
    return null;
  return (used / allocated) * 100;
}

/** Docker CPU percent uses 100% per logical CPU, rather than per allocation. */
export function allocatedCpuPercent(
  cpuPercent: number | null | undefined,
  cpus: number | undefined,
) {
  return usagePercent(cpuPercent == null ? null : cpuPercent / 100, cpus);
}

export function allocatedMemoryPercent(
  usedBytes: number | null | undefined,
  memory: string | undefined,
) {
  const match = memory?.match(/^(\d+(?:\.\d+)?)([bkmg])$/i);
  if (!match) return null;
  const exponent = "bkmg".indexOf(match[2]!.toLowerCase());
  return usagePercent(usedBytes, Number(match[1]) * 1024 ** exponent);
}
