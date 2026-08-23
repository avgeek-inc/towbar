export type HttpErrorStatus =
  400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500 | 502 | 503;

export class HttpError extends Error {
  readonly responseHeaders?: Record<string, string>;

  constructor(
    readonly status: HttpErrorStatus,
    readonly code: string,
    readonly publicMessage: string,
    options?: ErrorOptions & { responseHeaders?: Record<string, string> },
  ) {
    super(publicMessage, options);
    this.name = "HttpError";
    this.responseHeaders = options?.responseHeaders;
  }
}

export const badRequest = (message: string, code = "BAD_REQUEST") =>
  new HttpError(400, code, message);
export const unauthorized = (message = "Sign in to continue") =>
  new HttpError(401, "UNAUTHORIZED", message);
export const forbidden = (
  message = "You do not have access to this resource",
) => new HttpError(403, "FORBIDDEN", message);
export const notFound = (resource: string) =>
  new HttpError(404, "NOT_FOUND", `${resource} was not found`);
export const conflict = (message: string, code = "CONFLICT") =>
  new HttpError(409, code, message);
export const unprocessable = (message: string, code = "UNPROCESSABLE") =>
  new HttpError(422, code, message);
export const serviceUnavailable = (message: string, options?: ErrorOptions) =>
  new HttpError(503, "SERVICE_UNAVAILABLE", message, options);
