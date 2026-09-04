import { InlineLink } from "./page-parts";

export function ConfigurationLinks({
  sourceId,
  serverId,
  deployable,
}: {
  sourceId: string;
  serverId: string;
  deployable?: { id: string; kind: "app" | "resource" };
}) {
  return (
    <span className="mt-2 flex flex-wrap gap-3">
      <InlineLink
        href={`/sources/${sourceId}/servers/${serverId}?section=settings`}
      >
        Server credentials
      </InlineLink>
      {deployable ? (
        <InlineLink
          href={`/sources/${sourceId}/${deployable.kind}s/${deployable.id}?section=settings&settings=secrets`}
        >
          {deployable.kind === "app" ? "App secrets" : "Resource secrets"}
        </InlineLink>
      ) : null}
    </span>
  );
}
