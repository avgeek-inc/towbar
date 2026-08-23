export class TowbarApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "TowbarApiError";
  }
}

export type TowbarClientOptions = {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
};

export function createTowbarClient(options: TowbarClientOptions) {
  const fetcher = options.fetch ?? globalThis.fetch;
  const request = async <T>(
    path: string,
    init: RequestInit & { json?: unknown } = {},
  ) => {
    const { json, ...requestInit } = init;
    const response = await fetcher(new URL(path, options.baseUrl), {
      ...requestInit,
      body: json === undefined ? requestInit.body : JSON.stringify(json),
      credentials: "include",
      headers: {
        ...(json === undefined ? {} : { "content-type": "application/json" }),
        ...requestInit.headers,
      },
    });
    if (response.status === 204) return undefined as T;
    const payload = (await response.json().catch(() => null)) as
      | { error?: { code?: string; message?: string; requestId?: string } }
      | T
      | null;
    if (!response.ok) {
      const error =
        payload && typeof payload === "object" && "error" in payload
          ? payload.error
          : undefined;
      throw new TowbarApiError(
        response.status,
        error?.code ?? "REQUEST_FAILED",
        error?.message ?? `Towbar API returned ${response.status}`,
        error?.requestId,
      );
    }
    return payload as T;
  };

  return {
    delete: async <T>(path: string) =>
      await request<T>(path, { method: "DELETE" }),
    get: async <T>(path: string) => await request<T>(path),
    patch: async <T>(path: string, json?: unknown) =>
      await request<T>(path, { json, method: "PATCH" }),
    post: async <T>(path: string, json?: unknown, headers?: HeadersInit) =>
      await request<T>(path, { headers, json, method: "POST" }),
    put: async <T>(path: string, json?: unknown) =>
      await request<T>(path, { json, method: "PUT" }),
  };
}
