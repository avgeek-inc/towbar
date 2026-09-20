import { createHash } from "node:crypto";
import { APIError } from "better-auth/api";

export function pwnedPasswordRangeDigest(candidate: string) {
  // HIBP's k-anonymity range protocol requires SHA-1. This digest is never used
  // to store or verify Towbar credentials.
  // codeql[js/insufficient-password-hash]
  return createHash("sha1").update(candidate).digest("hex").toUpperCase();
}

export async function isPasswordCompromised(password: string, request = fetch) {
  const digest = pwnedPasswordRangeDigest(password);
  try {
    const response = await request(
      `https://api.pwnedpasswords.com/range/${digest.slice(0, 5)}`,
      {
        headers: {
          "Add-Padding": "true",
          "User-Agent": "Towbar Password Checker",
        },
        signal: AbortSignal.timeout(5_000),
        redirect: "error",
      },
    );
    if (!response.ok || !response.body)
      throw new Error("Password corpus unavailable");
    let text = "";
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += Buffer.from(value).toString("ascii");
        if (text.length > 2_000_000)
          throw new Error("Password corpus response too large");
      }
    } finally {
      await reader.cancel();
    }
    if (
      !text.trim() ||
      !text
        .trim()
        .split(/\r?\n/u)
        .every((line) => /^[A-F0-9]{35}:\d+$/u.test(line))
    )
      throw new Error("Invalid password corpus response");
    return text
      .split(/\r?\n/u)
      .some(
        (line) =>
          line.startsWith(`${digest.slice(5)}:`) && Number(line.slice(36)) > 0,
      );
  } catch {
    throw new APIError("SERVICE_UNAVAILABLE", {
      message:
        "Password safety check is temporarily unavailable. Try again shortly.",
    });
  }
}
