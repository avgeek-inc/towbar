import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

export type EncryptedCredential = {
  algorithm: "aes-256-gcm";
  authenticationTag: string;
  ciphertext: string;
  keyVersion: 1;
  nonce: string;
};

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
