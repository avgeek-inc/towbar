import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { publicationCredentials } from "./credentials.mjs";
import { identity } from "./release.mjs";

async function expectStatus(client, command, expected) {
  try {
    await client.send(command);
  } catch (error) {
    if (error.$metadata?.httpStatusCode === expected) return;
    throw new Error(
      `${command.constructor.name}: expected HTTP ${expected}, received ${error.$metadata?.httpStatusCode ?? "a transport error"}`,
    );
  }
  throw new Error(`${command.constructor.name}: unexpectedly permitted`);
}

export async function verifyCredentialScope(client, credentials) {
  const probe = randomUUID();
  const Bucket = credentials.bucket;
  const outside = `__publisher_scope_probes__/${credentials.prefix}/${probe}`;
  await expectStatus(
    client,
    new HeadObjectCommand({
      Bucket,
      Key: `${credentials.prefix}/__publisher_scope_probes__/${probe}`,
    }),
    404,
  );
  await expectStatus(
    client,
    new GetObjectCommand({ Bucket, Key: outside }),
    403,
  );
  await expectStatus(
    client,
    new PutObjectCommand({
      Bucket,
      Key: outside,
      Body: "",
      IfNoneMatch: "*",
    }),
    403,
  );
  await expectStatus(client, new ListObjectsV2Command({ Bucket }), 403);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const commit = process.argv[2];
  if (!/^[a-f0-9]{40}$/.test(commit ?? ""))
    throw new Error("Usage: node tools/distribution/check-scope.mjs COMMIT");
  const credentials = await publicationCredentials(identity, commit);
  const client = new S3Client({
    endpoint: credentials.endpoint,
    region: "auto",
    credentials,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  await verifyCredentialScope(client, credentials);
  console.log(
    "Publication session permits Towbar reads and rejects outside reads, writes and bucket listing",
  );
}
