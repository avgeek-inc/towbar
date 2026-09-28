export type SecondFactorMethod = "totp" | "passkey";

export function preferredSecondFactor(
  methods: SecondFactorMethod[],
  passkeySupported: boolean,
): SecondFactorMethod | null {
  if (passkeySupported && methods.includes("passkey")) return "passkey";
  if (methods.includes("totp")) return "totp";
  return null;
}
