import { createPrivateKey, randomBytes } from "node:crypto";

const uint32 = (value: number) => {
  const data = Buffer.alloc(4);
  data.writeUInt32BE(value);
  return data;
};
const field = (value: string | Buffer) => {
  const data = typeof value === "string" ? Buffer.from(value) : value;
  return Buffer.concat([uint32(data.length), data]);
};

// ssh2 accepts OpenSSH keys and traditional PEM, while the key store generates PKCS8.
export function terminalPrivateKey(pem: string) {
  if (!pem.includes("-----BEGIN PRIVATE KEY-----")) return pem;
  const key = createPrivateKey(pem);
  if (key.asymmetricKeyType === "rsa")
    return key.export({ format: "pem", type: "pkcs1" });
  if (key.asymmetricKeyType === "ec")
    return key.export({ format: "pem", type: "sec1" });
  if (key.asymmetricKeyType !== "ed25519")
    throw new Error("Unsupported SSH key type");
  const jwk = key.export({ format: "jwk" });
  if (!jwk.x || !jwk.d) throw new Error("Incomplete SSH key");
  const publicKey = Buffer.from(jwk.x, "base64url");
  const publicBlob = Buffer.concat([field("ssh-ed25519"), field(publicKey)]);
  const check = randomBytes(4);
  let privateBlob = Buffer.concat([
    check,
    check,
    field("ssh-ed25519"),
    field(publicKey),
    field(Buffer.concat([Buffer.from(jwk.d, "base64url"), publicKey])),
    field(""),
  ]);
  const padding = 8 - (privateBlob.length % 8);
  privateBlob = Buffer.concat([
    privateBlob,
    Buffer.from(Array.from({ length: padding }, (_, index) => index + 1)),
  ]);
  const encoded = Buffer.concat([
    Buffer.from("openssh-key-v1\0"),
    field("none"),
    field("none"),
    field(""),
    uint32(1),
    field(publicBlob),
    field(privateBlob),
  ]).toString("base64");
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${encoded.match(/.{1,70}/g)!.join("\n")}\n-----END OPENSSH PRIVATE KEY-----\n`;
}
