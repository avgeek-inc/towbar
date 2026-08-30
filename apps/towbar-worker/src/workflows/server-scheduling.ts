import type { ServerWorkItem } from "@workspace/towbar-core/temporal";

export type { ServerWorkItem } from "@workspace/towbar-core/temporal";

export function nextServerWorkIndex(input: {
  activeAppIds: Set<string>;
  activeCount: number;
  activePreviewCount?: number;
  activeVulnerabilityScanCount?: number;
  buildConcurrency: number;
  previewBuildConcurrency?: number;
  queue: ServerWorkItem[];
}) {
  if (input.activeCount >= input.buildConcurrency) return -1;
  let previewIndex = -1;
  let vulnerabilityScanIndex = -1;
  for (let index = 0; index < input.queue.length; index += 1) {
    const item = input.queue[index];
    if (!item) continue;
    if (
      item.kind === "server-check" ||
      item.kind === "server-preparation" ||
      (item.kind === "resource-operation" && item.exclusive)
    ) {
      // Checks, preparation, and exclusive operations retain FIFO position as
      // barriers so they cannot race a deployment on the same server.
      return input.activeCount === 0 && index === 0 ? index : -1;
    }
    if (!item.appId || input.activeAppIds.has(item.appId)) continue;
    if (item.kind === "preview-cleanup") return index;
    if (item.kind === "resource-operation") return index;
    if (item.kind === "vulnerability-scan") {
      if (
        (input.activeVulnerabilityScanCount ?? 0) < 1 &&
        vulnerabilityScanIndex < 0
      ) {
        vulnerabilityScanIndex = index;
      }
      continue;
    }
    if ((item.priority ?? "production") === "production") return index;
    if (
      previewIndex < 0 &&
      (input.activePreviewCount ?? 0) < (input.previewBuildConcurrency ?? 1)
    ) {
      previewIndex = index;
    }
  }
  return previewIndex >= 0 ? previewIndex : vulnerabilityScanIndex;
}
