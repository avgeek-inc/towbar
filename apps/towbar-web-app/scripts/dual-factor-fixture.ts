// Public test material for the local fixture API and virtual authenticators only.
export const dualFactorFixtureUserId = "71111111-1111-4111-8111-000000000005";
export const dualFactorFixtureCredential = {
  id: Buffer.from("towbar-dual-factor-fixture-passkey").toString("base64url"),
  publicKey: new Uint8Array(
    Buffer.from(
      "pQECAyYgASFYIIXOmGIZsBoUAJcSdI9rbnzIw7NeadyJj6vgHv70Q/stIlgg4LqMO4fQpzfmyMdC97rp+aNOmLsHWrP3qcWp7hKwaCM=",
      "base64",
    ),
  ),
  counter: 0,
};
export const dualFactorFixturePrivateKey =
  "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgMVXx3wx3aLrJBaagBrnG62H3FEar5pHWQunVz1jrpzihRANCAASFzphiGbAaFACXEnSPa258yMOzXmnciY+r4B7+9EP7LeC6jDuH0Kc35sjHQve66fmjTpi7B1qz96nFqe4SsGgj";
