import { z } from "zod";

export function recoveryArguments(args: string[], mode: "admin" | "mfa") {
  const allowed = new Set(
    mode === "admin"
      ? ["email", "new-email", "reset-mfa", "remove-passkeys"]
      : ["email", "remove-passkeys"],
  );
  const values = new Map<string, string | true>();
  for (const arg of args) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    const key = match?.[1];
    if (!key || !allowed.has(key) || values.has(key))
      throw new Error("Unknown or repeated recovery option");
    const value = match[2];
    if (key === "email" || key === "new-email" ? !value : value !== undefined)
      throw new Error(`Invalid value for --${key}`);
    values.set(key, value ?? true);
  }
  const email = z.string().trim().toLowerCase().email().max(320);
  return {
    email: email.parse(values.get("email")),
    newEmail: values.has("new-email")
      ? email.parse(values.get("new-email"))
      : undefined,
    resetMfa: values.has("reset-mfa"),
    removePasskeys: values.has("remove-passkeys"),
  };
}
