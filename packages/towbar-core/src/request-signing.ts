import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

export const requestSignatureMaxClockSkewMs = 5 * 60 * 1_000;
export const requestSignatureHeaders = {
  nonce: "x-towbar-nonce",
  signature: "x-towbar-signature",
  timestamp: "x-towbar-timestamp",
} as const;

const signatureContext = "towbar-internal-request:v1";
const signaturePrefix = "v1=";
const noncePattern = /^[A-Za-z0-9_-]{22,128}$/;

export class RequestSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestSignatureError";
  }
}

export function canonicalizeRequestTarget(target: string | URL) {
  const url =
    target instanceof URL
      ? new URL(target)
      : new URL(target, "https://towbar.invalid");
  const entries = [...url.searchParams.entries()].sort(
    ([leftKey, leftValue], [rightKey, rightValue]) =>
      compareText(leftKey, rightKey) || compareText(leftValue, rightValue),
  );
  const query = new URLSearchParams(entries).toString();
  return query ? `${url.pathname}?${query}` : url.pathname;
}

export function createRequestSignatureHeaders(input: {
  body: string;
  method: string;
  nonce?: string;
  secret: string;
  target: string | URL;
  timestamp?: string;
}) {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const nonce = input.nonce ?? randomUUID();
  validateNonce(nonce);
  validateTimestamp(timestamp);
  const signature = createSignature({ ...input, nonce, timestamp });
  return {
    [requestSignatureHeaders.nonce]: nonce,
    [requestSignatureHeaders.signature]: `${signaturePrefix}${signature}`,
    [requestSignatureHeaders.timestamp]: timestamp,
  };
}

export function verifyRequestSignature(input: {
  body: string;
  headers: Headers | Record<string, string | undefined>;
  method: string;
  now?: number;
  secret: string;
  target: string | URL;
}) {
  const timestamp = readHeader(
    input.headers,
    requestSignatureHeaders.timestamp,
  );
  const nonce = readHeader(input.headers, requestSignatureHeaders.nonce);
  const signature = readHeader(
    input.headers,
    requestSignatureHeaders.signature,
  );
  if (!timestamp || !nonce || !signature?.startsWith(signaturePrefix)) {
    throw new RequestSignatureError("Missing request signature headers");
  }
  validateNonce(nonce);
  const timestampMs = validateTimestamp(timestamp);
  if (
    Math.abs((input.now ?? Date.now()) - timestampMs) >
    requestSignatureMaxClockSkewMs
  ) {
    throw new RequestSignatureError(
      "Request signature timestamp is outside the allowed window",
    );
  }

  const expected = createSignature({ ...input, nonce, timestamp });
  const received = signature.slice(signaturePrefix.length);
  const expectedBuffer = Buffer.from(expected, "hex");
  const receivedBuffer = Buffer.from(received, "hex");
  if (
    expectedBuffer.length !== receivedBuffer.length ||
    !timingSafeEqual(expectedBuffer, receivedBuffer)
  ) {
    throw new RequestSignatureError("Invalid request signature");
  }
  return { nonce, timestamp };
}

function createSignature(input: {
  body: string;
  method: string;
  nonce: string;
  secret: string;
  target: string | URL;
  timestamp: string;
}) {
  const bodyHash = createHash("sha256").update(input.body).digest("hex");
  const payload = [
    signatureContext,
    input.method.toUpperCase(),
    canonicalizeRequestTarget(input.target),
    input.timestamp,
    input.nonce,
    bodyHash,
  ].join("\n");
  return createHmac("sha256", input.secret).update(payload).digest("hex");
}

function compareText(left: string, right: string) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function readHeader(
  headers: Headers | Record<string, string | undefined>,
  name: string,
) {
  if (headers instanceof Headers) return headers.get(name);
  return (
    Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1] ??
    null
  );
}

function validateNonce(nonce: string) {
  if (!noncePattern.test(nonce)) {
    throw new RequestSignatureError("Request signature nonce is invalid");
  }
}

function validateTimestamp(timestamp: string) {
  const timestampMs = Date.parse(timestamp);
  if (!Number.isFinite(timestampMs)) {
    throw new RequestSignatureError("Request signature timestamp is invalid");
  }
  return timestampMs;
}
