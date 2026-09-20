import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";

export function testAuthenticator() {
  const key = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = key.publicKey.export({ format: "jwk" });
  const id = randomBytes(32);
  const publicKey = isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(jwk.x!, "base64url")],
      [-3, Buffer.from(jwk.y!, "base64url")],
    ]),
  );
  const hash = (value: string | Buffer) =>
    createHash("sha256").update(value).digest();
  function authData(origin: string, flags: number, counter: number) {
    const count = Buffer.alloc(4);
    count.writeUInt32BE(counter);
    return Buffer.concat([
      hash(new URL(origin).hostname),
      Buffer.from([flags]),
      count,
    ]);
  }
  return {
    registration(
      challenge: string,
      origin: string,
      verified = true,
    ): RegistrationResponseJSON {
      const length = Buffer.alloc(2);
      length.writeUInt16BE(id.length);
      const data = Buffer.concat([
        authData(origin, verified ? 0x45 : 0x41, 0),
        Buffer.alloc(16),
        length,
        id,
        publicKey,
      ]);
      const attestationObject = isoCBOR.encode(
        new Map<string, string | Uint8Array | Map<string, string>>([
          ["fmt", "none"],
          ["attStmt", new Map()],
          ["authData", data],
        ]),
      );
      return {
        id: id.toString("base64url"),
        rawId: id.toString("base64url"),
        type: "public-key",
        clientExtensionResults: {},
        response: {
          clientDataJSON: Buffer.from(
            JSON.stringify({ type: "webauthn.create", challenge, origin }),
          ).toString("base64url"),
          attestationObject:
            Buffer.from(attestationObject).toString("base64url"),
          transports: ["internal"],
        },
      };
    },
    authentication(
      challenge: string,
      origin: string,
      counter = 1,
      verified = true,
    ): AuthenticationResponseJSON {
      const clientData = Buffer.from(
        JSON.stringify({ type: "webauthn.get", challenge, origin }),
      );
      const data = authData(origin, verified ? 0x05 : 0x01, counter);
      return {
        id: id.toString("base64url"),
        rawId: id.toString("base64url"),
        type: "public-key",
        clientExtensionResults: {},
        response: {
          clientDataJSON: clientData.toString("base64url"),
          authenticatorData: data.toString("base64url"),
          signature: sign(
            "sha256",
            Buffer.concat([data, hash(clientData)]),
            key.privateKey,
          ).toString("base64url"),
        },
      };
    },
  };
}
