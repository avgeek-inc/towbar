export type ServerWorkItem =
  | {
      appId: string;
      buildConcurrency: number;
      id: string;
      kind: "deployment";
    }
  | {
      buildConcurrency: number;
      id: string;
      kind: "server-check";
    }
  | {
      appId: string | null;
      buildConcurrency: number;
      exclusive: boolean;
      id: string;
      kind: "resource-operation";
    };

export function nextServerWorkIndex(input: {
  activeAppIds: Set<string>;
  activeCount: number;
  buildConcurrency: number;
  queue: ServerWorkItem[];
}) {
  if (input.activeCount >= input.buildConcurrency) return -1;
  for (let index = 0; index < input.queue.length; index += 1) {
    const item = input.queue[index];
    if (!item) continue;
    if (
      item.kind === "server-check" ||
      (item.kind === "resource-operation" && item.exclusive)
    ) {
      // Checks are exclusive and retain their FIFO position as a barrier.
      return input.activeCount === 0 && index === 0 ? index : -1;
    }
    if (!item.appId || !input.activeAppIds.has(item.appId)) return index;
  }
  return -1;
}
