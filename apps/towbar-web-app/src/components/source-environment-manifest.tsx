"use client";
import dynamic from "next/dynamic";
import { Layers01Icon, SourceCodeIcon } from "@hugeicons/core-free-icons";
import { Widget } from "@workspace/web-design-system/data-display/widget";
import { CodeBlock } from "@workspace/web-design-system/typography/code-block";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { useApiQuery } from "@/hooks/use-api-query";
import { usePageQuery } from "@/hooks/use-page-query";
import { ResponsiveChoice } from "./responsive-choice";
import type { SourceEnvironment } from "./source-environments";
const CodeEditor = dynamic(() => import("./code-editor"), { ssr: false });
type Manifest = {
  commitSha: string;
  files: { path: string; content: string }[];
};
export function SourceEnvironmentManifest({ sourceId }: { sourceId: string }) {
  const { search, update } = usePageQuery();
  const environments = useApiQuery<{ environments: SourceEnvironment[] }>(
    `/v1/core/sources/${sourceId}/environments`,
  );
  const requested = search.get("environment");
  const environment =
    environments.data?.environments.find((item) => item.name === requested) ??
    environments.data?.environments[0];
  const snapshot = useApiQuery<{ manifest: Manifest | null }>(
    environment
      ? `/v1/core/sources/${sourceId}/environments/${environment.id}/manifest`
      : null,
  );
  const files = snapshot.data?.manifest?.files ?? [];
  const file =
    files.find((item) => item.path === search.get("file")) ?? files[0];
  if (environments.error) return <QueryError message={environments.error} />;
  if (!environments.data) return <QueryLoading />;
  if (!environment)
    return (
      <p className="text-sm text-muted">
        Connect an environment to inspect its synced configuration.
      </p>
    );
  return (
    <div className="content-grid">
      <ResponsiveChoice
        label="Manifest environment"
        value={environment.name}
        options={environments.data.environments.map((item) => ({
          value: item.name,
          label: item.name,
          icon: Layers01Icon,
        }))}
        onChange={(value) => update({ environment: value, file: null })}
      />
      {snapshot.error ? (
        <QueryError message={snapshot.error} />
      ) : !snapshot.data ? (
        <QueryLoading />
      ) : !file ? (
        <p className="text-sm text-muted">
          This environment has no successful sync yet.
        </p>
      ) : (
        <>
          <ResponsiveChoice
            label="Manifest file"
            value={file.path}
            options={files.map((item) => ({
              value: item.path,
              label: item.path,
              icon: SourceCodeIcon,
            }))}
            onChange={(value) => update({ file: value })}
          />
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
          </CodeBlock>
        </>
      )}
    </div>
  );
}
