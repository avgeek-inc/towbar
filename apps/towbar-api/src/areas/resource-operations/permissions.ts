import type { Action } from "@workspace/towbar-access";
import type { ResourceOperationRequest } from "@workspace/towbar-core";
export function operationPermissions(
  request: ResourceOperationRequest,
): readonly Action[] {
  switch (request.type) {
    case "backup":
      return ["resource.backup"];
    case "restore":
    case "restore_cleanup":
      return ["resource.restore"];
    case "cleanup_orphans":
      return ["server.remove"];
    default:
      return ["workload.operate"];
  }
}
