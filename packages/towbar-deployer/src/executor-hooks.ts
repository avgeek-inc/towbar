import { deploymentLogChunkCharacterLimit } from "@workspace/towbar-core/temporal";

import { redactSensitiveValues } from "./secrets.js";
import { CommandError } from "./process.js";

import type { ExecutorHooks } from "./types.js";
import type { CommandOutputHandlers, CommandResult } from "./process.js";

export async function safeLog(
  hooks: ExecutorHooks,
  content: string,
  stream: "stderr" | "stdout",
  sensitiveValues: string[],
) {
  if (!content.trim() || !hooks.log) return;
  const redactedContent = redactSensitiveValues(content, sensitiveValues);
  for (
    let offset = 0;
    offset < redactedContent.length;
    offset += deploymentLogChunkCharacterLimit
  ) {
    await hooks.log(
      redactedContent.slice(offset, offset + deploymentLogChunkCharacterLimit),
      stream,
    );
  }
}

export async function runWithSafeLogs(input: {
  hooks: ExecutorHooks;
  run: (handlers: CommandOutputHandlers) => Promise<CommandResult>;
  sensitiveValues: string[];
}) {
  const streamedCharacters = { stderr: 0, stdout: 0 };
  const handlers: CommandOutputHandlers = {
    onStderr: async (content) => {
      streamedCharacters.stderr += content.length;
      await safeLog(input.hooks, content, "stderr", input.sensitiveValues);
    },
    onStdout: async (content) => {
      streamedCharacters.stdout += content.length;
      await safeLog(input.hooks, content, "stdout", input.sensitiveValues);
    },
  };
  try {
    const result = await input.run(handlers);
    await safeLog(
      input.hooks,
      result.stdout.slice(streamedCharacters.stdout),
      "stdout",
      input.sensitiveValues,
    );
    await safeLog(
      input.hooks,
      result.stderr.slice(streamedCharacters.stderr),
      "stderr",
      input.sensitiveValues,
    );
    return result;
  } catch (error) {
    if (error instanceof CommandError) {
      await safeLog(
        input.hooks,
        error.stdout.slice(streamedCharacters.stdout),
        "stdout",
        input.sensitiveValues,
      );
      await safeLog(
        input.hooks,
        error.stderr.slice(streamedCharacters.stderr),
        "stderr",
        input.sensitiveValues,
      );
    }
    throw error;
  }
}

export async function transition(
  hooks: ExecutorHooks,
  state: Parameters<NonNullable<ExecutorHooks["transition"]>>[0],
  message: string,
) {
  hooks.heartbeat?.({ state });
  await hooks.transition?.(state, message);
}
