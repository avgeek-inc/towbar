import { publicationCredentials } from "./credentials.mjs";
import { readFile } from "node:fs/promises";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  identity,
  promoteRelease,
  uploadRelease,
  validateRelease,
  verifyPublicRelease,
} from "./release.mjs";

const [command, directory] = process.argv.slice(2);
if (!["upload", "verify", "promote"].includes(command) || !directory)
  throw new Error(
    "Usage: node tools/distribution/publish.mjs upload|verify|promote DIRECTORY",
  );
const release = validateRelease(
  JSON.parse(await readFile(`${directory}/release.json`, "utf8")),
);
if (command === "verify") {
  await verifyPublicRelease(release);
} else {
  const credentials = await publicationCredentials(identity, release.commit);
  const client = new S3Client({
    endpoint: credentials.endpoint,
    region: "auto",
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const store = {
    async get(key) {
      try {
        const object = await client.send(
          new GetObjectCommand({ Bucket: identity.releaseBucket, Key: key }),
        );
        return {
          body: Buffer.from(await object.Body.transformToByteArray()),
          etag: object.ETag,
        };
      } catch (error) {
        if (error.$metadata?.httpStatusCode === 404) return null;
        throw error;
      }
    },
    async put(key, body, options) {
      await client.send(
        new PutObjectCommand({
          Bucket: identity.releaseBucket,
          Key: key,
          Body: body,
          ContentType: options.contentType,
          CacheControl: options.cacheControl,
          IfNoneMatch: options.ifNoneMatch,
          IfMatch: options.ifMatch,
        }),
      );
    },
  };
  if (command === "upload") await uploadRelease(store, directory);
  else await promoteRelease(store, release);
}
console.log(`${command}: ${release.version} at ${release.commit}`);
