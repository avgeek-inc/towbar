import { HttpError, serviceUnavailable } from "../../http/errors.js";

const githubApiBaseUrl = "https://api.github.com";
const githubAccept = "application/vnd.github+json";
const maximumAttempts = 3;
const maximumRetryDelayMs = 2_000;

type GitHubRequestOptions = {
  body?: unknown;
  method?: "DELETE" | "GET" | "PATCH" | "POST";
  retry?: boolean;
  token: string;
};

type GitHubRequestDependencies = {
  fetch: typeof globalThis.fetch;
  sleep: (delayMs: number) => Promise<void>;
};

const defaultDependencies: GitHubRequestDependencies = {
  fetch: globalThis.fetch,
  sleep: async (delayMs) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  },
};

export async function githubRequest(
  path: string,
  options: GitHubRequestOptions,
  dependencies: GitHubRequestDependencies = defaultDependencies,
) {
  let lastTransportError: unknown;
  const method = options.method ?? "GET";
  const retry =
    options.retry ??
    (method === "GET" || method === "PATCH" || method === "DELETE");
  const attemptLimit = retry ? maximumAttempts : 1;
  for (let attempt = 1; attempt <= attemptLimit; attempt += 1) {
    let response: Response;
    try {
      response = await dependencies.fetch(`${githubApiBaseUrl}${path}`, {
        headers: {
          accept: githubAccept,
          authorization: `Bearer ${options.token}`,
          "user-agent": "towbar.dev",
          "x-github-api-version": "2022-11-28",
          ...(options.body === undefined
            ? {}
            : { "content-type": "application/json" }),
        },
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
        method,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      lastTransportError = error;
      if (attempt < attemptLimit) {
        await dependencies.sleep(retryDelayMs(attempt));
        continue;
      }
      throw serviceUnavailable(transportFailureMessage(error, attemptLimit), {
        cause: error,
      });
    }

    if (response.ok) {
      return response.status === 204
        ? null
        : ((await response.json()) as unknown);
    }

    const failureBody =
      response.status === 403
        ? await response
            .clone()
            .text()
            .catch(() => "")
        : "";
    const failure = classifyGitHubResponseFailure(response, failureBody);
    await response.body?.cancel().catch(() => undefined);
    if (failure.retryable && attempt < attemptLimit) {
      await dependencies.sleep(
        retryDelayMs(attempt, failure.retryAfterMilliseconds),
      );
      continue;
    }
    throw new HttpError(failure.status, failure.code, failure.publicMessage, {
      responseHeaders: failure.responseHeaders,
    });
  }

  throw serviceUnavailable(
    transportFailureMessage(lastTransportError, attemptLimit),
    {
      cause: lastTransportError,
    },
  );
}

export function classifyGitHubResponseFailure(
  response: Response,
  failureBody = "",
) {
  const requestId = response.headers.get("x-github-request-id");
  const requestSuffix = requestId ? ` (${requestId})` : "";
  const rateLimited =
    response.status === 429 ||
    (response.status === 403 &&
      (response.headers.get("x-ratelimit-remaining") === "0" ||
        response.headers.has("retry-after") ||
        /secondary rate limit|rate limit exceeded|exceeded (?:a )?(?:secondary |api )?rate limit|abuse detection/iu.test(
          failureBody,
        )));
  if (rateLimited) {
    const retryAfter = retryAfterMilliseconds(response.headers);
    return {
      code: "GITHUB_RATE_LIMITED",
      publicMessage: `GitHub rate limit exceeded${requestSuffix}; Towbar will retry`,
      responseHeaders:
        retryAfter === undefined
          ? undefined
          : { "retry-after": String(Math.ceil(retryAfter / 1_000)) },
      retryable: true,
      retryAfterMilliseconds: retryAfter,
      status: 429 as const,
    };
  }
  if (response.status >= 500) {
    return {
      code: "GITHUB_UNAVAILABLE",
      publicMessage: `GitHub is temporarily unavailable${requestSuffix}; Towbar will retry`,
      responseHeaders: undefined,
      retryable: true,
      retryAfterMilliseconds: retryAfterMilliseconds(response.headers),
      status: 503 as const,
    };
  }
  const status = githubErrorStatus(response.status);
  return {
    code: "GITHUB_REQUEST_FAILED",
    publicMessage: githubFailureMessage(status, requestSuffix),
    responseHeaders: undefined,
    retryable: false,
    retryAfterMilliseconds: undefined,
    status,
  };
}

function transportFailureMessage(error: unknown, attemptCount: number) {
  const attempts = `${attemptCount} ${attemptCount === 1 ? "attempt" : "attempts"}`;
  return isTimeoutError(error)
    ? `GitHub request timed out after ${attempts}; Towbar will retry`
    : `GitHub could not be reached after ${attempts}; Towbar will retry`;
}

function isTimeoutError(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

function retryAfterMilliseconds(headers: Headers) {
  const retryAfter = headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  const reset = Number(headers.get("x-ratelimit-reset"));
  return Number.isFinite(reset) && reset > 0
    ? Math.max(0, reset * 1_000 - Date.now())
    : undefined;
}

function retryDelayMs(attempt: number, requestedDelay?: number) {
  if (requestedDelay !== undefined) {
    return Math.min(requestedDelay, maximumRetryDelayMs);
  }
  return Math.min(250 * 2 ** (attempt - 1), maximumRetryDelayMs);
}

function githubErrorStatus(status: number): 403 | 404 | 409 | 422 {
  if (status === 401 || status === 403) return 403;
  if (status === 404 || status === 409 || status === 422) {
    return status;
  }
  return 422;
}

function githubFailureMessage(
  status: 403 | 404 | 409 | 422,
  requestSuffix: string,
) {
  switch (status) {
    case 403:
      return `GitHub denied this request${requestSuffix}; verify the GitHub App permissions`;
    case 404:
      return `The requested GitHub resource was not found${requestSuffix}`;
    case 409:
      return `GitHub could not complete this request because the repository state changed${requestSuffix}`;
    case 422:
      return `GitHub could not process this request${requestSuffix}`;
  }
}
