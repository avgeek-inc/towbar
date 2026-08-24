import { createHash } from "node:crypto";

const algorithmPattern = /^[A-Za-z0-9][A-Za-z0-9@._+-]{0,79}$/u;
const base64Pattern = /^[A-Za-z0-9+/]+={0,2}$/u;

export function parseTrustedHostKey(input: {
  algorithm: string;
  fingerprint: string;
  publicKey: string;
}) {
  const algorithm = input.algorithm.trim();
  const parts = input.publicKey.trim().split(/\s+/u);
  if (!algorithmPattern.test(algorithm) || parts.length !== 2) {
    throw new Error("Host public key is not a valid OpenSSH key");
  }
  const [publicKeyAlgorithm, encodedKey] = parts;
  if (publicKeyAlgorithm !== algorithm || !encodedKey) {
    throw new Error("Host public key does not match its declared algorithm");
  }
  if (!base64Pattern.test(encodedKey) || encodedKey.length % 4 === 1) {
    throw new Error("Host public key is not valid Base64");
  }

  const key = Buffer.from(encodedKey, "base64");
  if (
    key.length < 9 ||
    key.toString("base64").replace(/=+$/u, "") !==
      encodedKey.replace(/=+$/u, "")
  ) {
    throw new Error("Host public key is not valid Base64");
  }
  const embeddedAlgorithmLength = key.readUInt32BE(0);
  const algorithmEnd = 4 + embeddedAlgorithmLength;
  if (
    algorithmEnd >= key.length ||
    key.subarray(4, algorithmEnd).toString("utf8") !== algorithm
  ) {
    throw new Error("Host public key payload does not match its algorithm");
  }

  const fingerprint = `SHA256:${createHash("sha256")
    .update(key)
    .digest("base64")
    .replace(/=+$/u, "")}`;
  if (fingerprint !== input.fingerprint.trim()) {
    throw new Error("Host key fingerprint does not match its public key");
  }

  return { algorithm, fingerprint, publicKey: `${algorithm} ${encodedKey}` };
}
