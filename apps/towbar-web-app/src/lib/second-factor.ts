export type SecondFactorMethod = "totp" | "passkey";
const preferenceKey = "towbar:last-two-factor-method";
const isLocalhost = (hostname: string) =>
  ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname) ||
  hostname.endsWith(".localhost");

export function preferredSecondFactor(
  methods: SecondFactorMethod[],
  passkeySupported: boolean,
  remembered: string | null,
): SecondFactorMethod | null {
  if (
    (remembered === "totp" || remembered === "passkey") &&
    methods.includes(remembered) &&
    (remembered !== "passkey" || passkeySupported)
  )
    return remembered;
  if (methods.length === 1 && (methods[0] !== "passkey" || passkeySupported))
    return methods[0]!;
  return null;
}

export function rememberedSecondFactor(): string | null {
  try {
    return isLocalhost(window.location.hostname)
      ? window.localStorage.getItem(preferenceKey)
      : null;
  } catch {
    return null;
  }
}

export function rememberSecondFactor(method: SecondFactorMethod) {
  try {
    if (isLocalhost(window.location.hostname))
      window.localStorage.setItem(preferenceKey, method);
  } catch {
    // Browser storage is optional; it must never prevent sign-in.
  }
}
