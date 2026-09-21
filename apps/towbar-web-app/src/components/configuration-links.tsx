"use client";
import { useAccess } from "./access-context";
import { InlineLink } from "./page-parts";

export function ConfigurationLinks({
  serverId,
  deployable,
}: {
  serverId: string;
  deployable?: { id: string; kind: "app" | "resource" };
}) {
  const { can } = useAccess();
  return (
    <span className="mt-2 flex flex-wrap gap-3">
      {can("server.credentials") ? (
        <InlineLink href={`/servers/${serverId}/settings/credentials`}>
          Server credentials
        </InlineLink>
      ) : null}
      {deployable && can("secret.list") ? (
        <InlineLink
          href={`/${deployable.kind}s/${deployable.id}/settings/secrets`}
        >
          {deployable.kind === "app" ? "App secrets" : "Resource secrets"}
        </InlineLink>
      ) : null}
    </span>
  );
}
