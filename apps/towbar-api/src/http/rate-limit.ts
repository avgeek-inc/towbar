import { createHmac } from "node:crypto";

import { getConnInfo } from "@hono/node-server/conninfo";
import { eq, lt, sql } from "drizzle-orm";

import { authRateLimitBuckets } from "@workspace/towbar-database/schema";

import { getEnv } from "../env.js";
import { getTowbarDatabase } from "../infrastructure/database.js";
import { HttpError } from "./errors.js";

import type { Context } from "hono";

const loginWindowMs = 15 * 60 * 1_000;
const loginAccountAttemptLimit = 12;
const loginAddressAttemptLimit = 30;
const setupAttemptLimit = 10;

type AttemptWindow = { attempts: number; expiresAt: Date };

export type AuthRateLimitCounter = (
  subject: string,
  now: Date,
  windowMs: number,
) => Promise<AttemptWindow>;

export function resolveClientAddress(input: {
  forwardedFor?: string;
  peerAddress?: string;
  trustedProxyHops: number;
}) {
  const peerAddress = input.peerAddress?.trim() || "unknown";
  if (input.trustedProxyHops === 0) return peerAddress;

  const forwarded = (input.forwardedFor ?? "")
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean)
    .slice(-16);
  const chain = [...forwarded, peerAddress];
  return chain.at(-(input.trustedProxyHops + 1)) ?? peerAddress;
}

export function getClientAddress(context: Context) {
  let peerAddress: string | undefined;
  try {
    peerAddress = getConnInfo(context).remote.address;
  } catch {
    // Hono's in-memory request helper has no Node socket. Production does.
  }
  return resolveClientAddress({
    forwardedFor: context.req.header("x-forwarded-for"),
    peerAddress,
    trustedProxyHops: getEnv().TOWBAR_TRUSTED_PROXY_HOPS,
  });
}

export async function checkPasswordLoginRateLimit(input: {
  clientAddress: string;
  counter: AuthRateLimitCounter;
  email: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const normalizedEmail = input.email.trim().toLowerCase();
  const [addressWindow, accountWindow] = await Promise.all([
    input.counter(`login-address:${input.clientAddress}`, now, loginWindowMs),
    input.counter(`login-account:${normalizedEmail}`, now, loginWindowMs),
  ]);
  const blocked = [
    { limit: loginAddressAttemptLimit, window: addressWindow },
    { limit: loginAccountAttemptLimit, window: accountWindow },
  ].filter(({ limit, window }) => window.attempts > limit);
  return blocked.length === 0
    ? null
    : Math.max(
        ...blocked.map(({ window }) =>
          Math.max(
            1,
            Math.ceil((window.expiresAt.getTime() - now.getTime()) / 1_000),
          ),
        ),
      );
}

export async function enforcePasswordLoginRateLimit(input: {
  clientAddress: string;
  email: string;
}) {
  const retryAfter = await checkPasswordLoginRateLimit({
    ...input,
    counter: incrementPersistentBucket,
  });
  if (retryAfter !== null) throw rateLimitError(retryAfter);
}

export async function clearPasswordLoginAccountRateLimit(email: string) {
  await getTowbarDatabase()
    .delete(authRateLimitBuckets)
    .where(
      eq(
        authRateLimitBuckets.keyHash,
        hashSubject(`login-account:${email.trim().toLowerCase()}`),
      ),
    );
}

export async function enforceInitialSetupRateLimit(clientAddress: string) {
  await enforceSingleSubjectLimit(
    `setup-address:${clientAddress}`,
    setupAttemptLimit,
  );
}

async function enforceSingleSubjectLimit(subject: string, limit: number) {
  const now = new Date();
  const window = await incrementPersistentBucket(subject, now, loginWindowMs);
  if (window.attempts > limit) {
    throw rateLimitError(
      Math.max(
        1,
        Math.ceil((window.expiresAt.getTime() - now.getTime()) / 1_000),
      ),
    );
  }
}

async function incrementPersistentBucket(
  subject: string,
  now: Date,
  windowMs: number,
): Promise<AttemptWindow> {
  const database = getTowbarDatabase();
  const expiresAt = new Date(now.getTime() + windowMs);
  const nowTimestamp = sql`${now.toISOString()}::timestamptz`;
  const expiresAtTimestamp = sql`${expiresAt.toISOString()}::timestamptz`;
  const [bucket] = await database
    .insert(authRateLimitBuckets)
    .values({
      attempts: 1,
      expiresAt,
      keyHash: hashSubject(subject),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: authRateLimitBuckets.keyHash,
      set: {
        attempts: sql<number>`case when ${authRateLimitBuckets.expiresAt} <= ${nowTimestamp} then 1 else ${authRateLimitBuckets.attempts} + 1 end`,
        expiresAt: sql<Date>`case when ${authRateLimitBuckets.expiresAt} <= ${nowTimestamp} then ${expiresAtTimestamp} else ${authRateLimitBuckets.expiresAt} end`,
        updatedAt: now,
      },
    })
    .returning({
      attempts: authRateLimitBuckets.attempts,
      expiresAt: authRateLimitBuckets.expiresAt,
    });
  if (!bucket) throw new Error("Unable to record authentication attempt");

  await database
    .delete(authRateLimitBuckets)
    .where(
      lt(
        authRateLimitBuckets.expiresAt,
        new Date(now.getTime() - 24 * 60 * 60 * 1_000),
      ),
    );
  return bucket;
}

function hashSubject(subject: string) {
  return createHmac("sha256", getEnv().TOWBAR_INTERNAL_HMAC_SECRET)
    .update(`auth-rate-limit:${subject}`, "utf8")
    .digest("hex");
}

function rateLimitError(retryAfter: number) {
  return new HttpError(
    429,
    "AUTH_RATE_LIMITED",
    "Too many authentication attempts. Try again later",
    { responseHeaders: { "retry-after": String(retryAfter) } },
  );
}
