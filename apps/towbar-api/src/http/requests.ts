import { z } from "zod";

import { HttpError } from "./errors.js";

import type { Context } from "hono";

const defaultLimit = 1 * 1_024 * 1_024;

export function readUuidPathParameter(value: string, name: string) {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) {
    throw new HttpError(
      400,
      "INVALID_PATH_PARAMETER",
      `${name} must be a valid UUID`,
    );
  }
  return parsed.data;
}

export async function readJson<T>(
  context: Context,
  schema: z.ZodType<T>,
  limitBytes = defaultLimit,
) {
  const body = await readText(context, limitBytes);
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new HttpError(
      400,
      "MALFORMED_JSON",
      "Request body must be valid JSON",
    );
  }
  return schema.parse(value);
}

export async function readOptionalJson<T>(
  context: Context,
  schema: z.ZodType<T>,
  limitBytes = defaultLimit,
) {
  const body = await readText(context, limitBytes);
  if (!body.trim()) return schema.parse({});
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new HttpError(
      400,
      "MALFORMED_JSON",
      "Request body must be valid JSON",
    );
  }
  return schema.parse(value);
}

export async function readText(context: Context, limitBytes = defaultLimit) {
  const contentLength = Number(context.req.header("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > limitBytes) {
    throw payloadTooLarge(limitBytes);
  }

  const reader = context.req.raw.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > limitBytes) {
      await reader.cancel();
      throw payloadTooLarge(limitBytes);
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

function payloadTooLarge(limitBytes: number) {
  return new HttpError(
    413,
    "PAYLOAD_TOO_LARGE",
    `Request body cannot exceed ${limitBytes} bytes`,
  );
}
