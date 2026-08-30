import { defaultAutoDeployCircuit } from "@workspace/towbar-core";

import type {
  AutoDeployCircuit,
  AutoDeployRecoveryPolicy,
} from "@workspace/towbar-core";

export function nextCircuitAfterFailure(input: {
  circuit: AutoDeployCircuit;
  failureFingerprint: string;
  failureThreshold: number;
  now?: Date;
}) {
  const comparable =
    input.circuit.failureFingerprint === input.failureFingerprint;
  const consecutiveFailures = comparable
    ? input.circuit.consecutiveFailures + 1
    : 1;
  const opensNow =
    !input.circuit.openedAt &&
    input.failureThreshold > 0 &&
    consecutiveFailures >= input.failureThreshold;
  const openedAt =
    input.circuit.openedAt ??
    (opensNow ? (input.now ?? new Date()).toISOString() : null);
  return {
    circuit: {
      consecutiveFailures,
      failureFingerprint: input.failureFingerprint,
      openedAt,
      openedReason:
        input.circuit.openedReason ??
        (opensNow
          ? `${consecutiveFailures} comparable failures: ${input.failureFingerprint}`
          : null),
    } satisfies AutoDeployCircuit,
    opened: opensNow,
  };
}

export function nextCircuitAfterSuccess(input: {
  circuit: AutoDeployCircuit;
  manualDeployment: boolean;
  recoveryPolicy: AutoDeployRecoveryPolicy;
}) {
  const recovered = Boolean(
    input.circuit.openedAt &&
    input.manualDeployment &&
    input.recoveryPolicy === "on_manual_success",
  );
  if (recovered || !input.circuit.openedAt) {
    return { circuit: defaultAutoDeployCircuit, recovered };
  }
  return { circuit: input.circuit, recovered: false };
}
