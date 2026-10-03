import { writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  deploymentCloudflareDnsDomains,
  deploymentPublicHostnames,
} from "@workspace/towbar-core";
import { rollbackCloudflareDns } from "./cloudflare.js";
import type { CloudflareDnsChange } from "./cloudflare.js";
import type { SshSession } from "./ssh.js";
import type { DeploymentExecutionContext, DeploymentSecrets } from "./types.js";

const recordSchema = z.object({
  comment: z.string().optional(),
  content: z.string(),
  id: z.string(),
  name: z.string(),
  proxied: z.boolean().optional(),
  type: z.enum(["A", "AAAA", "CNAME"]),
  ttl: z.number().optional(),
});
const receiptSchema = z
  .array(
    z.object({
      zoneId: z.string().regex(/^[a-zA-Z0-9-]+$/),
      before: recordSchema.optional(),
      after: recordSchema,
    }),
  )
  .max(1000);

export function domainDnsRecorder(input: {
  context: DeploymentExecutionContext;
  session: SshSession;
  localDirectory: string;
  remoteDirectory: string;
}) {
  const changes: CloudflareDnsChange[] = [];
  return async (change: CloudflareDnsChange) => {
    if (!input.context.domainHandoffs?.length) return;
    if (!changes.includes(change)) changes.push(change);
    const file = path.join(input.localDirectory, "domain-dns.json");
    await writeFile(file, JSON.stringify(changes), { mode: 0o600 });
    await input.session.upload(
      file,
      `${input.remoteDirectory}/domain-dns.json`,
    );
  };
}

export async function readDomainDnsReceipt(
  session: SshSession,
  directory: string,
) {
  const { stdout } = await session.run(
    'if test -f "$1/domain-dns.json"; then cat "$1/domain-dns.json"; else printf "[]"; fi',
    [directory],
    { timeoutMs: 30_000 },
  );
  return receiptSchema.parse(JSON.parse(stdout));
}

export async function restoreDomainDnsReceipt(
  context: DeploymentExecutionContext,
  secrets: DeploymentSecrets | undefined,
  changes: CloudflareDnsChange[],
) {
  if (!changes.length) return;
  if (!secrets)
    throw new Error(
      "DNS credentials are required to recover this domain handoff",
    );
  const hostnames = new Set(deploymentPublicHostnames(context.app));
  const dns = new Set(deploymentCloudflareDnsDomains(context.app));
  for (const change of [...changes].reverse()) {
    if (
      !hostnames.has(change.after.name) ||
      (change.after.comment !==
        `Managed by Towbar: ${context.runtimeId ?? context.deployableId}` &&
        !(
          change.after.comment === "" &&
          context.domainHandoffs?.some(
            (handoff) =>
              handoff.hostname === change.after.name &&
              handoff.previousManagedDns,
          )
        ))
    )
      throw new Error(
        "DNS recovery receipt does not belong to this deployment",
      );
    const credentials =
      dns.has(change.after.name) ||
      (change.after.type !== "CNAME" &&
        context.domainHandoffs?.some(
          (handoff) => handoff.hostname === change.after.name,
        ))
        ? (secrets.domainHandoffDns?.[change.after.name] ?? secrets.cloudflare)
        : secrets.cloudflareTunnel;
    if (!credentials)
      throw new Error("DNS credentials are unavailable for domain recovery");
    await rollbackCloudflareDns(credentials, [change]);
  }
}
