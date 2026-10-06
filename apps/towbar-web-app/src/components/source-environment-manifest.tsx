"use client";
import dynamic from "next/dynamic";
import {
  GitBranchIcon,
  CloudIcon,
  SourceCodeIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Source } from "@workspace/towbar-web-client";
import { Widget } from "@avgeek-oss/design-system/data-display/widget";
import { ListBox } from "@avgeek-oss/design-system/collections/list-box";
import { Label } from "@avgeek-oss/design-system/forms/label";
import { Select } from "@avgeek-oss/design-system/forms/select";
import { InlineExternalLink } from "@avgeek-oss/design-system/navigation/inline-external-link";
import { CodeBlock } from "@avgeek-oss/design-system/typography/code-block";
import { TypographyCode } from "@avgeek-oss/design-system/typography/typography";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { useApiQuery } from "@/hooks/use-api-query";
import { usePageQuery } from "@/hooks/use-page-query";
import { repositoryFileLink } from "@/lib/repository-file-link";
import {
  findDeployableManifest,
  type ManifestDeployable,
} from "@/lib/deployable-manifest";
import { ResponsiveChoice } from "./responsive-choice";
import type { SourceEnvironment } from "./source-environments";
const CodeEditor = dynamic(() => import("./code-editor"), { ssr: false });
type Manifest = {
  commitSha: string;
  files: { path: string; content: string }[];
};
export function SourceEnvironmentManifest({
  sourceId,
  deployable,
}: {
  sourceId: string;
  deployable?: ManifestDeployable;
}) {
  const { search, update } = usePageQuery();
  const source = useApiQuery<{ source: Source }>(
    `/v1/core/sources/${sourceId}`,
  );
  const environments = useApiQuery<{ environments: SourceEnvironment[] }>(
    `/v1/core/sources/${sourceId}/environments`,
  );
  const requested = search.get("environment");
  const environment = deployable
    ? environments.data?.environments.find(
        (item) => item.id === deployable.environment?.id,
      )
    : (environments.data?.environments.find(
        (item) => item.name === requested,
      ) ?? environments.data?.environments[0]);
  const snapshot = useApiQuery<{ manifest: Manifest | null }>(
    environment
      ? `/v1/core/sources/${sourceId}/environments/${environment.id}/manifest`
      : null,
  );
  const files = snapshot.data?.manifest?.files ?? [];
  const file = deployable
    ? findDeployableManifest(files, deployable)
    : (files.find((item) => item.path === search.get("file")) ?? files[0]);
  if (environments.error || source.error)
    return <QueryError message={environments.error ?? source.error!} />;
  if (!environments.data || !source.data) return <QueryLoading />;
  if (!environment)
    return (
      <p className="text-sm text-muted">
        Connect an environment to inspect its synced configuration.
      </p>
    );
  const repositoryLink = file
    ? repositoryFileLink(
        source.data.source,
        snapshot.data?.manifest?.commitSha || environment.branch,
        file.path,
      )
    : undefined;
  return (
    <div className="content-grid">
      {!deployable ? (
        <ResponsiveChoice
          label="Manifest environment"
          value={environment.name}
          options={environments.data.environments.map((item) => ({
            value: item.name,
            label: item.name,
            icon: CloudIcon,
            iconClassName:
              item.name === "production" ? "text-danger" : "text-foreground",
          }))}
          onChange={(value) => update({ environment: value, file: null })}
        />
      ) : null}
      {snapshot.error ? (
        <QueryError message={snapshot.error} />
      ) : !snapshot.data ? (
        <QueryLoading />
      ) : !file ? (
        <p className="text-sm text-muted">
          {snapshot.data.manifest && deployable
            ? "This workload is not present in the last successfully synced manifest."
            : "This environment has no successful sync yet."}
        </p>
      ) : (
        <>
          {!deployable ? (
            <Select
              className="w-full max-w-xl"
              isRequired
              selectedKey={file.path}
              variant="secondary"
              onSelectionChange={(key) => {
                if (key !== null) update({ file: String(key) });
              }}
            >
              <Label isRequired>Manifest file</Label>
              <Select.Trigger>
                <Select.Value className="flex min-w-0 flex-1 items-center overflow-hidden">
                  <span className="flex min-w-0 items-center gap-2">
                    <HugeiconsIcon
                      icon={SourceCodeIcon}
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted"
                    />
                    <span className="truncate">{file.path}</span>
                  </span>
                </Select.Value>
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {files.map((item) => (
                    <ListBox.Item
                      id={item.path}
                      key={item.path}
                      textValue={item.path}
                    >
                      <HugeiconsIcon
                        icon={SourceCodeIcon}
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {item.path}
                      </span>
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
          ) : null}
          <CodeBlock
            aria-label="Synced manifest file"
            className="w-full min-w-0"
          >
            <CodeBlock.Header>
              <CodeBlock.Filename>{file.path}</CodeBlock.Filename>
              <CodeBlock.CopyButton code={file.content} />
            </CodeBlock.Header>
            <Widget.Content>
              <CodeEditor
                ariaLabel={`${file.path} code`}
                language="yaml"
                value={file.content}
                disabled
                embedded
              />
            </Widget.Content>
            <Widget.Footer className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex min-w-0 items-center gap-1.5 text-sm text-muted">
                <HugeiconsIcon
                  aria-hidden="true"
                  className="size-[1em] shrink-0"
                  icon={GitBranchIcon}
                />
                <TypographyCode className="rounded-none bg-transparent p-0">
                  {environment.branch}
                </TypographyCode>
                <span aria-hidden="true">@</span>
                <TypographyCode
                  className="rounded-none bg-transparent p-0"
                  title={snapshot.data.manifest?.commitSha}
                >
                  {snapshot.data.manifest?.commitSha.slice(0, 12)}
                </TypographyCode>
              </span>
              {repositoryLink ? (
                <InlineExternalLink
                  className="text-sm"
                  href={repositoryLink.href}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {repositoryLink.label}
                </InlineExternalLink>
              ) : null}
            </Widget.Footer>
          </CodeBlock>
        </>
      )}
    </div>
  );
}
