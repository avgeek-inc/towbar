import { createHash } from "node:crypto";
import path from "node:path";

import { z } from "zod";

const environmentKeyPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
const forbiddenBranchCharacters = new Set("~^:?*[\\");

export function canonicalIp(value: string) {
  return value.trim().toLowerCase();
}

export function isValidBranchName(value: string) {
  const branch = value.trim();
  return !(
    branch === "@" ||
    branch.startsWith("-") ||
    branch.startsWith("refs/") ||
    branch.startsWith("/") ||
    branch.endsWith("/") ||
    branch.endsWith(".") ||
    branch.includes("..") ||
    branch.includes("@{") ||
    branch.includes("//") ||
    [...branch].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return (
        code <= 32 || code === 127 || forbiddenBranchCharacters.has(character)
      );
    }) ||
    branch
      .split("/")
      .some((part) => part.startsWith(".") || part.endsWith(".lock"))
  );
}

export function normalizeRepositoryPath(value: string) {
  if (value.includes("\\") || value.includes("\0")) {
    throw new Error(
      "Repository paths must use forward slashes and cannot contain null bytes",
    );
  }
  if (path.posix.isAbsolute(value)) {
    throw new Error("Repository paths must be relative");
  }
  const normalized = path.posix.normalize(value);
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error("Repository paths cannot escape the checkout");
  }
  return normalized.replace(/^\.\//u, "") || ".";
}

export function normalizeDomain(value: string) {
  const candidate = value.trim().toLowerCase().replace(/\.$/u, "");
  if (
    candidate.includes("*") ||
    candidate.includes(":") ||
    candidate.includes("/")
  ) {
    throw new Error(
      "Domains must be exact hostnames without wildcards, ports, or paths",
    );
  }
  let hostname: string;
  try {
    hostname = new URL(`https://${candidate}`).hostname;
  } catch {
    throw new Error("Invalid domain name");
  }
  if (hostname !== candidate || hostname.length > 253) {
    throw new Error("Domain must already be in canonical ASCII form");
  }
  const labels = hostname.split(".");
  if (
    labels.length < 2 ||
    labels.some(
      (label) =>
        label.length === 0 ||
        label.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label),
    )
  ) {
    throw new Error("Invalid domain labels");
  }
  return hostname;
}

export function validateSecretObject(
  value: unknown,
  purpose: "build" | "deployment",
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${purpose} secret must be a JSON object`);
  }
  const entries = Object.entries(value);
  if (entries.length > 200) {
    throw new Error(`${purpose} secret contains too many keys`);
  }
  for (const [key, entryValue] of entries) {
    if (!environmentKeyPattern.test(key)) {
      throw new Error(
        `${purpose} secret key '${key}' is not a valid environment key`,
      );
    }
    if (typeof entryValue !== "string") {
      throw new Error(`${purpose} secret value for '${key}' must be a string`);
    }
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

export function validateServerLoginSecret(value: unknown) {
  return z
    .object({
      privateKey: z.string().min(1).max(100_000),
    })
    .strict()
    .parse(value);
}

export function digestValue(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => left.localeCompare(right),
    );
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function findDuplicates(values: string[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  values.forEach((value) => {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  });
  return [...duplicates].sort();
}
