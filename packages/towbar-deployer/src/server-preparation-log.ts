import { stripVTControlCharacters } from "node:util";
import { serverPreparationStepLogMaxLength } from "@workspace/towbar-core";
import { redactSensitiveValues } from "./secrets.js";

export function redactPreparationOutput(
  content: string,
  sensitiveValues: string[] = [],
) {
  return redactSensitiveValues(
    stripVTControlCharacters(content),
    sensitiveValues,
  )
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g,
      "[redacted private key]",
    )
    .replace(/API token '[^']*'/gi, "API token '[redacted]'")
    .replace(
      /(authorization["']?\s*[:=]\s*["']?)(?:Bearer|Basic)\s+[^\s"']+/gi,
      "$1[redacted]",
    )
    .replace(
      /((?:password|passwd|api[_-]?token|api[_-]?key|secret|access[_-]?token)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      "$1[redacted]",
    )
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[redacted]@")
    .replace(/[\p{Cc}\p{Cf}]/gu, (character) =>
      character === "\n" || character === "\t" ? character : "",
    );
}

// Buffer complete lines so SSH chunk boundaries do not defeat credential
// redaction. Keep only a bounded tail of sanitized output.
export function createPreparationLog(input: {
  publish: (log: string, truncated: boolean) => Promise<void>;
  sensitiveValues: string[];
}) {
  let log = "";
  let truncated = false;
  let lastPublishedAt = 0;
  const streams = {
    stdout: { pending: "", privateKey: false, oversized: false },
    stderr: { pending: "", privateKey: false, oversized: false },
  };
  const secrets = input.sensitiveValues
    .flatMap((value) => [value, ...value.split(/\r?\n/)])
    .filter(Boolean);
  function line(stream: keyof typeof streams, content: string) {
    const state = streams[stream];
    if (/-----BEGIN [^-]*PRIVATE KEY-----/.test(content))
      state.privateKey = true;
    const safe = state.privateKey
      ? "[redacted private key]"
      : redactPreparationOutput(content, secrets);
    if (/-----END [^-]*PRIVATE KEY-----/.test(content))
      state.privateKey = false;
    log += `[${stream}] ${safe}\n`;
    if (log.length > serverPreparationStepLogMaxLength) {
      log = log.slice(-serverPreparationStepLogMaxLength);
      truncated = true;
    }
  }
  return {
    async append(stream: keyof typeof streams, content: string) {
      const state = streams[stream];
      for (const part of content.split(/(?<=\n)/)) {
        if (!state.oversized) state.pending += part;
        if (state.pending.length > serverPreparationStepLogMaxLength) {
          if (/-----BEGIN [^-]*PRIVATE KEY-----/.test(state.pending))
            state.privateKey = true;
          state.pending = "";
          state.oversized = true;
          truncated = true;
        }
        if (part.endsWith("\n")) {
          line(
            stream,
            state.oversized
              ? "[Oversized output line omitted]"
              : state.pending.trimEnd(),
          );
          state.pending = "";
          state.oversized = false;
        }
      }
      if (Date.now() - lastPublishedAt >= 1_000 && log) {
        await input.publish(log, truncated);
        lastPublishedAt = Date.now();
      }
    },
    async finish() {
      for (const stream of ["stdout", "stderr"] as const) {
        const state = streams[stream];
        if (state.pending || state.oversized)
          line(
            stream,
            state.oversized ? "[Oversized output line omitted]" : state.pending,
          );
        state.pending = "";
        state.oversized = false;
      }
      await input.publish(log, truncated);
    },
  };
}
