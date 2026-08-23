import {
  argon2,
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const deriveArgon2 = promisify(argon2);
const passwordParameters = {
  memory: 65_536,
  parallelism: 4,
  passes: 3,
  tagLength: 32,
} as const;

export type EncryptedCredential = {
  algorithm: "aes-256-gcm";
  authenticationTag: string;
  ciphertext: string;
  keyVersion: 1;
  nonce: string;
};

export async function hashPassword(password: string) {
  assertPasswordLength(password);
  const nonce = randomBytes(16);
  const derivedKey = await deriveArgon2("argon2id", {
    message: password,
    nonce,
    ...passwordParameters,
  });
  return [
    "$towbar$argon2id$v=1",
    `m=${passwordParameters.memory},t=${passwordParameters.passes},p=${passwordParameters.parallelism}`,
    nonce.toString("base64url"),
    derivedKey.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(password: string, encoded: string) {
  assertPasswordLength(password);
  const parts = encoded.split("$");
  if (
    parts.length !== 7 ||
    parts[1] !== "towbar" ||
    parts[2] !== "argon2id" ||
    parts[3] !== "v=1"
  ) {
    return false;
  }
  const parameters = parsePasswordParameters(parts[4] ?? "");
  const nonce = Buffer.from(parts[5] ?? "", "base64url");
  const expected = Buffer.from(parts[6] ?? "", "base64url");
  if (nonce.length !== 16 || expected.length !== parameters.tagLength) {
    return false;
  }
  const actual = await deriveArgon2("argon2id", {
    message: password,
    nonce,
    ...parameters,
  });
  return timingSafeEqual(actual, expected);
}

export function encryptCredential(input: {
  associatedData: string;
  masterKey: Buffer;
  value: unknown;
}): EncryptedCredential {
  assertMasterKey(input.masterKey);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", input.masterKey, nonce);
  cipher.setAAD(Buffer.from(input.associatedData, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(input.value), "utf8"),
    cipher.final(),
  ]);
  return {
    algorithm: "aes-256-gcm",
    authenticationTag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    keyVersion: 1,
    nonce: nonce.toString("base64url"),
  };
}

export function decryptCredential<T>(input: {
  associatedData: string;
  envelope: EncryptedCredential;
  masterKey: Buffer;
}): T {
  assertMasterKey(input.masterKey);
  if (
    input.envelope.algorithm !== "aes-256-gcm" ||
    input.envelope.keyVersion !== 1
  ) {
    throw new Error("Unsupported credential encryption envelope");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    input.masterKey,
    Buffer.from(input.envelope.nonce, "base64url"),
  );
  decipher.setAAD(Buffer.from(input.associatedData, "utf8"));
  decipher.setAuthTag(
    Buffer.from(input.envelope.authenticationTag, "base64url"),
  );
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(input.envelope.ciphertext, "base64url")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}

export function parseCredentialsMasterKey(value: string) {
  const key = Buffer.from(value, "base64");
  assertMasterKey(key);
  return key;
}

export function createOpaqueToken(byteLength = 32) {
  return randomBytes(byteLength).toString("base64url");
}

export function hashOpaqueToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function assertMasterKey(key: Buffer) {
  if (key.length !== 32) {
    throw new Error("TOWBAR_CREDENTIALS_KEY must decode to exactly 32 bytes");
  }
}

function assertPasswordLength(password: string) {
  if (password.length < 12 || password.length > 1_024) {
    throw new Error("Password must contain between 12 and 1024 characters");
  }
}

function parsePasswordParameters(value: string) {
  const entries = Object.fromEntries(
    value.split(",").map((part) => part.split("=", 2)),
  );
  const memory = Number(entries.m);
  const passes = Number(entries.t);
  const parallelism = Number(entries.p);
  if (
    memory !== passwordParameters.memory ||
    passes !== passwordParameters.passes ||
    parallelism !== passwordParameters.parallelism
  ) {
    throw new Error("Unsupported password hash parameters");
  }
  return { ...passwordParameters };
}
