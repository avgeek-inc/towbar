import { createHash, randomUUID } from "node:crypto";

import { Client, Connection } from "@temporalio/client";

import {
  deploymentWorkflowId,
  maintenanceWorkflowId,
  resourceOperationWorkflowId,
  serverCoordinatorWorkflowId,
  sourceCoordinatorWorkflowId,
  towbarTaskQueue,
} from "@workspace/towbar-core/temporal";

import type {
  PreviewBranchEvent,
  ServerWorkItem,
} from "@workspace/towbar-core/temporal";

import { getEnv } from "../env.js";

let clientPromise: Promise<Client> | undefined;

export function previewLifecycleWorkflowId(sourceId: string, branch: string) {
  const refHash = createHash("sha256")
    .update(`refs/heads/${branch}`)
    .digest("hex")
    .slice(0, 24);
  return `towbar-preview/v1/${sourceId}/${refHash}`;
}

export async function enqueueSourceSync(input: {
  sourceId: string;
  syncId: string;
}) {
  const client = await getTemporalClient();
  const workflowId = sourceCoordinatorWorkflowId(input.sourceId);
  await client.workflow.signalWithStart("runSourceCoordinatorWorkflow", {
    args: [],
    signal: "enqueueSourceSync",
    signalArgs: [input.syncId],
    taskQueue: towbarTaskQueue,
    workflowId,
    workflowIdReusePolicy: "ALLOW_DUPLICATE",
  });
  return { workflowId };
}

export async function enqueueDeployment(input: {
  appId: string;
  buildConcurrency: number;
  deploymentId: string;
  previewBuildConcurrency?: number;
  priority?: "preview" | "production";
  serverIp: string;
}) {
  const client = await getTemporalClient();
  const serverHash = createHash("sha256")
    .update(input.serverIp)
    .digest("hex")
    .slice(0, 32);
  const workflowId = serverCoordinatorWorkflowId(serverHash);
  await client.workflow.signalWithStart(
    "runConcurrentServerCoordinatorWorkflow",
    {
      args: [],
      signal: "enqueueServerWork",
      signalArgs: [
        {
          appId: input.appId,
          buildConcurrency: input.buildConcurrency,
          id: input.deploymentId,
          kind: "deployment",
          previewBuildConcurrency: input.previewBuildConcurrency ?? 1,
          priority: input.priority ?? "production",
        },
      ],
      taskQueue: towbarTaskQueue,
      workflowId,
      workflowIdReusePolicy: "ALLOW_DUPLICATE",
    },
  );
  return { workflowId };
}

export async function enqueuePreviewBranchEvent(event: PreviewBranchEvent) {
  const client = await getTemporalClient();
  const workflowId = previewLifecycleWorkflowId(event.sourceId, event.branch);
  await client.workflow.signalWithStart("runPreviewLifecycleWorkflow", {
    args: [],
    signal: "previewBranchEvent",
    signalArgs: [event],
    taskQueue: towbarTaskQueue,
    workflowId,
    workflowIdReusePolicy: "ALLOW_DUPLICATE",
  });
  return { workflowId };
}

export async function enqueuePreviewCleanup(input: {
  appId: string;
  buildConcurrency: number;
  previewBuildConcurrency: number;
  previewEnvironmentId: string;
  serverIp: string;
}) {
  const client = await getTemporalClient();
  const serverHash = createHash("sha256")
    .update(input.serverIp)
    .digest("hex")
    .slice(0, 32);
  const workflowId = serverCoordinatorWorkflowId(serverHash);
  await client.workflow.signalWithStart(
    "runConcurrentServerCoordinatorWorkflow",
    {
      args: [],
      signal: "enqueueServerWork",
      signalArgs: [
        createPreviewCleanupWorkItem({
          appId: input.appId,
          buildConcurrency: input.buildConcurrency,
          previewBuildConcurrency: input.previewBuildConcurrency,
          previewEnvironmentId: input.previewEnvironmentId,
        }),
      ],
      taskQueue: towbarTaskQueue,
      workflowId,
      workflowIdReusePolicy: "ALLOW_DUPLICATE",
    },
  );
  return { workflowId };
}

export function createPreviewCleanupWorkItem(
  input: Omit<
    Extract<ServerWorkItem, { kind: "preview-cleanup" }>,
    "id" | "kind"
  >,
  attemptId = randomUUID(),
): Extract<ServerWorkItem, { kind: "preview-cleanup" }> {
  return {
    ...input,
    id: attemptId,
    kind: "preview-cleanup",
  };
}

export async function enqueueServerCheck(input: {
  buildConcurrency: number;
  checkId: string;
  serverIp: string;
}) {
  const client = await getTemporalClient();
  const serverHash = createHash("sha256")
    .update(input.serverIp)
    .digest("hex")
    .slice(0, 32);
  const workflowId = serverCoordinatorWorkflowId(serverHash);
  await client.workflow.signalWithStart(
    "runConcurrentServerCoordinatorWorkflow",
    {
      args: [],
      signal: "enqueueServerWork",
      signalArgs: [
        {
          buildConcurrency: input.buildConcurrency,
          id: input.checkId,
          kind: "server-check",
        },
      ],
      taskQueue: towbarTaskQueue,
      workflowId,
      workflowIdReusePolicy: "ALLOW_DUPLICATE",
    },
  );
  return { workflowId };
}

export async function enqueueServerPreparation(input: {
  buildConcurrency: number;
  preparationId: string;
  serverIp: string;
}) {
  const client = await getTemporalClient();
  const serverHash = createHash("sha256")
    .update(input.serverIp)
    .digest("hex")
    .slice(0, 32);
  const workflowId = serverCoordinatorWorkflowId(serverHash);
  await client.workflow.signalWithStart(
    "runConcurrentServerCoordinatorWorkflow",
    {
      args: [],
      signal: "enqueueServerWork",
      signalArgs: [
        {
          buildConcurrency: input.buildConcurrency,
          id: input.preparationId,
          kind: "server-preparation",
        },
      ],
      taskQueue: towbarTaskQueue,
      workflowId,
      workflowIdReusePolicy: "ALLOW_DUPLICATE",
    },
  );
  return { workflowId };
}

export async function enqueueResourceOperation(input: {
  appId: string | null;
  buildConcurrency: number;
  exclusive: boolean;
  operationId: string;
  serverIp: string;
}) {
  const client = await getTemporalClient();
  const serverHash = createHash("sha256")
    .update(input.serverIp)
    .digest("hex")
    .slice(0, 32);
  const workflowId = serverCoordinatorWorkflowId(serverHash);
  await client.workflow.signalWithStart(
    "runConcurrentServerCoordinatorWorkflow",
    {
      args: [],
      signal: "enqueueServerWork",
      signalArgs: [
        {
          appId: input.appId,
          buildConcurrency: input.buildConcurrency,
          exclusive: input.exclusive,
          id: input.operationId,
          kind: "resource-operation",
        },
      ],
      taskQueue: towbarTaskQueue,
      workflowId,
      workflowIdReusePolicy: "ALLOW_DUPLICATE",
    },
  );
  return { workflowId: resourceOperationWorkflowId(input.operationId) };
}

export async function wakeMaintenanceWorkflow() {
  const client = await getTemporalClient();
  const workflowId = maintenanceWorkflowId();
  await client.workflow.signalWithStart("runMaintenanceWorkflow", {
    args: [],
    signal: "wakeMaintenance",
    signalArgs: [],
    taskQueue: towbarTaskQueue,
    workflowId,
    workflowIdReusePolicy: "ALLOW_DUPLICATE",
  });
  return { workflowId };
}

export async function cancelDeploymentWorkflow(deploymentId: string) {
  const client = await getTemporalClient();
  await client.workflow.getHandle(deploymentWorkflowId(deploymentId)).cancel();
}

async function getTemporalClient() {
  clientPromise ??= createTemporalClient().catch((error: unknown) => {
    clientPromise = undefined;
    throw error;
  });
  return await clientPromise;
}

async function createTemporalClient() {
  const env = getEnv();
  const connection = await Connection.connect({
    address: env.TEMPORAL_ADDRESS,
    ...(env.TEMPORAL_API_KEY
      ? { apiKey: env.TEMPORAL_API_KEY, tls: true }
      : {}),
  });
  return new Client({ connection, namespace: env.TEMPORAL_NAMESPACE });
}
