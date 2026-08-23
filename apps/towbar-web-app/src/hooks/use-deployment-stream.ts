"use client";

import { useEffect, useState } from "react";

import type {
  Deployment,
  DeploymentEvent,
  DeploymentLog,
  DeploymentStep,
} from "@workspace/towbar-web-client";

import { api } from "@/lib/api";
import { config } from "@/lib/config";

type ConnectionState = "complete" | "connecting" | "live" | "reconnecting";

const terminalStates = new Set([
  "cancelled",
  "failed",
  "succeeded",
  "succeeded_with_warnings",
  "skipped",
]);

/**
 * Hydrates a deployment once through the ordinary API, then follows the
 * reconnectable SSE projection. EventSource carries the host-only API session
 * cookie and automatically sends Last-Event-ID after transient disconnects.
 */
export function useDeploymentStream(deploymentId: string) {
  const [deployment, setDeployment] = useState<Deployment>();
  const [steps, setSteps] = useState<DeploymentStep[]>();
  const [logs, setLogs] = useState<DeploymentLog[]>();
  const [error, setError] = useState<string>();
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener("towbar:refresh", refresh);
    return () => window.removeEventListener("towbar:refresh", refresh);
  }, []);

  useEffect(() => {
    let active = true;
    let completed = false;
    let events: EventSource | undefined;
    setDeployment(undefined);
    setSteps(undefined);
    setLogs(undefined);
    setError(undefined);
    setConnection("connecting");

    const connect = () => {
      const target = new URL(
        `/v1/core/deployments/${deploymentId}/events`,
        config.apiBaseUrl,
      );
      events = new EventSource(target, { withCredentials: true });
      events.addEventListener("open", () => {
        if (!active || completed) return;
        setConnection("live");
        setError(undefined);
      });
      events.addEventListener("deployment", (event) => {
        if (!active) return;
        try {
          const snapshot = JSON.parse(event.data) as DeploymentEvent;
          setDeployment(snapshot.deployment);
          setSteps(snapshot.steps);
          setLogs((current) => mergeLogs(current ?? [], snapshot.logs));
          setError(undefined);
          completed = terminalStates.has(snapshot.deployment.state);
          setConnection(completed ? "complete" : "live");
          if (completed) events?.close();
        } catch {
          setError("Towbar received an invalid deployment event");
        }
      });
      events.addEventListener("error", () => {
        if (!active || completed) return;
        setConnection("reconnecting");
      });
    };

    const hydrate = async () => {
      try {
        const [deploymentResponse, stepsResponse, logsResponse] =
          await Promise.all([
            api.get<{ deployment: Deployment }>(
              `/v1/core/deployments/${deploymentId}`,
            ),
            api.get<{ steps: DeploymentStep[] }>(
              `/v1/core/deployments/${deploymentId}/steps`,
            ),
            api.get<{ logs: DeploymentLog[] }>(
              `/v1/core/deployments/${deploymentId}/logs`,
            ),
          ]);
        if (!active) return;
        setDeployment(deploymentResponse.deployment);
        setSteps(stepsResponse.steps);
        setLogs(logsResponse.logs);
        completed = terminalStates.has(deploymentResponse.deployment.state);
        if (completed) {
          setConnection("complete");
        } else {
          connect();
        }
      } catch (cause) {
        if (active) {
          setError(cause instanceof Error ? cause.message : "Request failed");
        }
      }
    };
    void hydrate();
    return () => {
      active = false;
      events?.close();
    };
  }, [deploymentId, revision]);

  return { connection, deployment, error, logs, steps };
}

function mergeLogs(current: DeploymentLog[], incoming: DeploymentLog[]) {
  const bySequence = new Map(
    [...current, ...incoming].map((log) => [log.sequence, log]),
  );
  return [...bySequence.values()].sort(
    (left, right) => left.sequence - right.sequence,
  );
}
