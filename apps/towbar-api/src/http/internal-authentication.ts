import { and, eq, lt } from "drizzle-orm";

import {
  RequestSignatureError,
  requestSignatureMaxClockSkewMs,
  verifyRequestSignature,
} from "@workspace/towbar-core/request-signing";
import { requestNonces } from "@workspace/towbar-database/schema";

import { getEnv } from "../env.js";
import { getTowbarDatabase } from "../infrastructure/database.js";
import { HttpError, serviceUnavailable, unauthorized } from "./errors.js";

import type { MiddlewareHandler } from "hono";

const bodyLimitBytes = 2 * 1_024 * 1_024;

export const requireSignedInternalRequest: MiddlewareHandler = async (
  context,
  next,
) => {
  const request = context.req.raw;
  const body = await readBody(request.clone());
  let verified: { nonce: string; timestamp: string };
  try {
    verified = verifyRequestSignature({
      body,
      headers: request.headers,
      method: request.method,
      secret: getEnv().TOWBAR_INTERNAL_HMAC_SECRET,
      target: new URL(request.url),
    });
  } catch (error) {
    if (error instanceof RequestSignatureError) {
      console.warn("Rejected signed internal request", {
        reason: error.message,
      });
      throw unauthorized("Towbar worker request is unauthorized");
    }
    throw error;
  }

  // Read endpoints return installation tokens and deployment context, so replay
  // protection applies to every signed request rather than mutations alone.
  await claimNonce(verified.nonce);
  await next();
};

async function readBody(request: Request) {
  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > bodyLimitBytes) {
    throw new HttpError(
      413,
      "PAYLOAD_TOO_LARGE",
      `Internal request cannot exceed ${bodyLimitBytes} bytes`,
    );
  }
  return body;
}

async function claimNonce(nonce: string) {
  const database = getTowbarDatabase();
  try {
    const created = await database
      .insert(requestNonces)
      .values({
        expiresAt: new Date(Date.now() + requestSignatureMaxClockSkewMs * 3),
        nonce,
        scope: "worker",
      })
      .onConflictDoNothing()
      .returning({ nonce: requestNonces.nonce });
    if (created.length === 0) {
      throw unauthorized("Towbar worker request is unauthorized");
    }
    await database
      .delete(requestNonces)
      .where(
        and(
          eq(requestNonces.scope, "worker"),
          lt(requestNonces.expiresAt, new Date()),
        ),
      );
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw serviceUnavailable("Request replay protection is unavailable", {
      cause: error,
    });
  }
}
