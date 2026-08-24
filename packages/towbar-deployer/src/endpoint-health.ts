import { CommandError, runCommand } from "./process.js";

const originHealthAttempts = 90;

export async function checkPublicEndpoint(
  domain: string,
  healthPath: string,
  signal?: AbortSignal,
) {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const requestSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
      : AbortSignal.timeout(10_000);
    const response = await fetch(`https://${domain}${healthPath}`, {
      redirect: "manual",
      signal: requestSignal,
    }).catch(() => null);
    if (response?.ok) return;
    lastStatus = response?.status ?? 0;
    await abortableDelay(2_000, signal);
  }
  throw new Error(
    `Public endpoint health check failed with status ${lastStatus}`,
  );
}

export async function checkOriginEndpoint(
  serverIp: string,
  domain: string,
  healthPath: string,
  signal?: AbortSignal,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < originHealthAttempts; attempt += 1) {
    try {
      await runCommand(
        "curl",
        originHealthCurlArguments(serverIp, domain, healthPath),
        { signal, timeoutMs: 15_000 },
      );
      return;
    } catch (error) {
      lastError = error;
      await abortableDelay(2_000, signal);
    }
  }
  throw new Error(originHealthFailureMessage(lastError), { cause: lastError });
}

export function originHealthFailureMessage(error: unknown) {
  if (!(error instanceof CommandError)) {
    return "Direct origin HTTPS health check failed";
  }
  const detail = error.stderr.trim().split("\n").at(-1)?.trim();
  return detail
    ? `Direct origin HTTPS health check failed: ${detail.slice(0, 300)}`
    : "Direct origin HTTPS health check failed";
}

export function originHealthCurlArguments(
  serverIp: string,
  domain: string,
  healthPath: string,
) {
  const address = serverIp.includes(":") ? `[${serverIp}]` : serverIp;
  return [
    "--fail",
    "--silent",
    "--show-error",
    "--connect-timeout",
    "5",
    "--max-time",
    "10",
    "--resolve",
    `${domain}:443:${address}`,
    `https://${domain}${healthPath}`,
  ];
}

function abortableDelay(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abortError = () =>
      signal?.reason instanceof Error
        ? signal.reason
        : new Error("Endpoint health check was cancelled");
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timeout);
      reject(abortError());
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
