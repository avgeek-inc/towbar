import { createRequestSignatureHeaders } from "@workspace/towbar-core/request-signing";

import { getEnv } from "../env.js";

const transientStatuses = new Set([
  408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527,
]);
const defaultMaximumAttempts = 6;
const defaultBaseDelayMs = 500;
const defaultMaximumDelayMs = 4_000;

type SignedApiRequestOptions = {
  baseDelayMs?: number;
  fetcher?: typeof fetch;
  maximumAttempts?: number;
  maximumDelayMs?: number;
  random?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
  timeoutMs?: number;
};

export class TowbarApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "TowbarApiError";
  }
}

export async function signedApiRequest<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  options: SignedApiRequestOptions = {},
) {
  const env = getEnv();
  const target = new URL(path, env.TOWBAR_API_BASE_URL);
  const serialized = body === undefined ? "" : JSON.stringify(body);
  const maximumAttempts = options.maximumAttempts ?? defaultMaximumAttempts;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      const signatureHeaders = createRequestSignatureHeaders({
        body: serialized,
        method,
        secret: env.TOWBAR_INTERNAL_HMAC_SECRET,
        target,
      });
      const response = await (options.fetcher ?? fetch)(target, {
        body: body === undefined ? undefined : serialized,
        headers: {
          ...signatureHeaders,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        method,
        signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
      });
      const payload = (await response.json().catch(() => null)) as
        { error?: { code?: string; message?: string } } | T | null;
      if (!response.ok) {
        const error =
          payload && typeof payload === "object" && "error" in payload
            ? payload.error
            : undefined;
        throw new TowbarApiError(
          error?.message
            ? `Towbar API ${error.code ?? "error"}: ${error.message}`
            : `Towbar API returned ${response.status}`,
          response.status,
        );
      }
      return payload as T;
    } catch (error) {
      if (attempt >= maximumAttempts || !isTransientError(error)) throw error;
      await (options.sleep ?? sleep)(
        retryDelayMs(attempt, {
          baseDelayMs: options.baseDelayMs ?? defaultBaseDelayMs,
          maximumDelayMs: options.maximumDelayMs ?? defaultMaximumDelayMs,
          random: options.random ?? Math.random,
        }),
      );
    }
  }
  throw new Error("Towbar API retry loop ended unexpectedly");
}

function isTransientError(error: unknown) {
  if (error instanceof TowbarApiError) {
    return transientStatuses.has(error.status);
  }
  return error instanceof TypeError || isAbortTimeout(error);
}

function isAbortTimeout(error: unknown) {
  return (
    error instanceof Error &&
    ["AbortError", "TimeoutError"].includes(error.name)
  );
}

function retryDelayMs(
  failedAttempt: number,
  input: {
    baseDelayMs: number;
    maximumDelayMs: number;
    random: () => number;
  },
) {
  const exponential = Math.min(
    input.maximumDelayMs,
    input.baseDelayMs * 2 ** (failedAttempt - 1),
  );
  return exponential + Math.floor(input.random() * input.baseDelayMs);
}

async function sleep(delayMs: number) {
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}
