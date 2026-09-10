"use client";
import {
  Add01Icon,
  Search01Icon,
  GitBranchIcon,
  GithubIcon,
} from "@hugeicons/core-free-icons";

import { HugeiconsIcon } from "@hugeicons/react";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type {
  GitHubConnection,
  GitHubRepository,
  Source,
} from "@workspace/towbar-web-client";
import {
  Button,
  ButtonLink,
} from "@workspace/web-design-system/buttons/button";
import { ListBox } from "@workspace/web-design-system/collections/list-box";
import { EmptyState } from "@workspace/web-design-system/data-display/empty-state";
import { Description } from "@workspace/web-design-system/forms/description";
import { Input } from "@workspace/web-design-system/forms/input";
import { Label } from "@workspace/web-design-system/forms/label";
import { Stepper } from "@workspace/web-design-system/navigation/stepper";
import { toast } from "@workspace/web-design-system/overlays/toast";
import { ComboBox } from "@workspace/web-design-system/pickers/combo-box";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";

import {
  DashboardPage,
  FormCard,
  sourcesBreadcrumb,
} from "@/components/page-parts";
import { useApiQuery } from "@/hooks/use-api-query";
import { api } from "@/lib/api";

export function SourceCreate() {
  const router = useRouter();
  const connection = useApiQuery<{ connection: GitHubConnection | null }>(
    "/v1/core/github",
  );
  const repositories = useApiQuery<{ repositories: GitHubRepository[] }>(
    connection.data?.connection ? "/v1/core/github/repositories" : null,
  );
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [discoveryBranch, setDiscoveryBranch] = useState("");
  const [discovered, setDiscovered] = useState<
    { name: string; previewsEnabled: boolean }[] | null
  >(null);
  const [mappings, setMappings] = useState<Record<string, string>>({});
  if (connection.error && !connection.data)
    return (
      <DashboardPage
        icon={GitBranchIcon}
        breadcrumbAncestors={sourcesBreadcrumb}
        title="Add source"
      >
        <QueryError message={connection.error} />
      </DashboardPage>
    );
  if (!connection.data)
    return (
      <DashboardPage
        icon={GitBranchIcon}
        breadcrumbAncestors={sourcesBreadcrumb}
        title="Add source"
      >
        <QueryLoading />
      </DashboardPage>
    );
  if (!connection.data.connection)
    return (
      <DashboardPage
        icon={GitBranchIcon}
        breadcrumbAncestors={sourcesBreadcrumb}
        title="Add source"
      >
        <EmptyState>
          <EmptyState.Header>
            <EmptyState.Title>GitHub not connected</EmptyState.Title>
            <EmptyState.Description>
              Install the GitHub App before adding a Source.
            </EmptyState.Description>
          </EmptyState.Header>
          <EmptyState.Content>
            <ButtonLink href="/manage/integrations?integration=github">
              <HugeiconsIcon
                aria-hidden="true"
                icon={GithubIcon}
                className="size-4 shrink-0"
              />
              Open GitHub integration
            </ButtonLink>
          </EmptyState.Content>
        </EmptyState>
      </DashboardPage>
    );
  if (repositories.error)
    return (
      <DashboardPage
        icon={GitBranchIcon}
        breadcrumbAncestors={sourcesBreadcrumb}
        title="Add source"
      >
        <QueryError message={repositories.error} />
      </DashboardPage>
    );
  if (!repositories.data)
    return (
      <DashboardPage
        icon={GitBranchIcon}
        breadcrumbAncestors={sourcesBreadcrumb}
        title="Add source"
      >
        <QueryLoading />
      </DashboardPage>
    );
  if (repositories.data.repositories.length === 0)
    return (
      <DashboardPage
        icon={GitBranchIcon}
        breadcrumbAncestors={sourcesBreadcrumb}
        title="Add source"
      >
        <EmptyState>
          <EmptyState.Header>
            <EmptyState.Title>No repositories available</EmptyState.Title>
            <EmptyState.Description>
              Grant the Towbar GitHub App access to at least one repository,
              then return here.
            </EmptyState.Description>
          </EmptyState.Header>
        </EmptyState>
      </DashboardPage>
    );
  const githubInstallationId = connection.data.connection.id;
  const selected = repositories.data.repositories.find(
    (repo) => repo.fullName === fullName,
  );
  return (
    <DashboardPage
      icon={GitBranchIcon}
      breadcrumbAncestors={sourcesBreadcrumb}
      title="Add source"
    >
      <div className="content-grid">
        <div className="max-w-full overflow-x-auto pb-1">
          <div className="min-w-[44rem]">
            <Stepper currentStep={discovered ? 2 : 1}>
              {[
                ["Connect GitHub", "Repository access is ready."],
                [
                  "Choose repository",
                  "Select the repository Towbar should sync.",
                ],
                [
                  "Connect environments",
                  "Map branches and sync configuration without deploying.",
                ],
              ].map(([title, description]) => (
                <Stepper.Step key={title}>
                  <Stepper.Indicator />
                  <Stepper.Content>
                    <Stepper.Title>{title}</Stepper.Title>
                    <Stepper.Description>{description}</Stepper.Description>
                  </Stepper.Content>
                  <Stepper.Separator />
                </Stepper.Step>
              ))}
            </Stepper>
          </div>
        </div>
        <FormCard
          icon={<HugeiconsIcon icon={GitBranchIcon} />}
          title="Source details"
        >
          <form
            className="content-grid max-w-xl pt-2"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!selected) return;
              setBusy(true);
              try {
                const repository = {
                  discoveryBranch: discoveryBranch || selected.defaultBranch,
                  githubInstallationId,
                  repositoryName: selected.name,
                  repositoryOwner: selected.owner,
                };
                if (!discovered) {
                  const result = await api.post<{
                    environments: { name: string; previewsEnabled: boolean }[];
                  }>("/v1/core/sources/discover", repository);
                  setDiscovered(result.environments);
                  setMappings(
                    Object.fromEntries(
                      result.environments.map((environment) => [
                        environment.name,
                        environment.name === "production"
                          ? selected.defaultBranch
                          : "",
                      ]),
                    ),
                  );
                  return;
                }
                const result = await api.post<{
                  source: Source;
                  syncs: { error: string | null }[];
                }>("/v1/core/sources/connect", {
                  ...repository,
                  environments: discovered.map((environment) => ({
                    environment: environment.name,
                    branch: mappings[environment.name]?.trim(),
                  })),
                });
                if (result.syncs.some((sync) => sync.error)) {
                  toast.danger("Source connected; some syncs need retry", {
                    description:
                      "Open the environment to retry its initial sync.",
                  });
                } else toast.success("Source connected");
                router.push(`/sources/${result.source.id}`);
              } catch (caught) {
                toast.danger(
                  discovered
                    ? "Couldn't connect source"
                    : "Couldn't read configuration",
                  {
                    description:
                      caught instanceof Error
                        ? caught.message
                        : "The request failed",
                  },
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <ComboBox
              className="gap-3"
              fullWidth
              selectedKey={fullName || null}
              variant="secondary"
              onSelectionChange={(value) => {
                setFullName(String(value ?? ""));
                setDiscoveryBranch("");
                setDiscovered(null);
              }}
            >
              <Label>Repository</Label>
              <ComboBox.InputGroup>
                <Input placeholder="Search repositories…" />
                <ComboBox.Trigger />
              </ComboBox.InputGroup>
              <ComboBox.Popover>
                <ListBox>
                  {repositories.data.repositories.map((repo) => (
                    <ListBox.Item
                      key={repo.id}
                      id={repo.fullName}
                      textValue={`${repo.fullName}${repo.private ? " private" : ""}`}
                    >
                      {repo.fullName}
                      {repo.private ? " · private" : ""}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </ComboBox.Popover>
              <Description>
                Towbar reads towbar.yml to discover environments. Deployment
                branches are managed here, not in YAML.
              </Description>
            </ComboBox>
            <div className="grid gap-2">
              <Label htmlFor="source-discovery-branch">Discovery branch</Label>
              <Input
                id="source-discovery-branch"
                value={discoveryBranch || selected?.defaultBranch || ""}
                variant="secondary"
                disabled={!selected || busy}
                onChange={(event) => {
                  setDiscoveryBranch(event.target.value);
                  setDiscovered(null);
                }}
              />
              <p className="text-xs text-muted">
                Used to discover environments during connection. Each
                environment follows its own branch after connecting.
              </p>
            </div>
            {discovered ? (
              <div className="grid gap-4">
                <p>Choose the branch for each environment.</p>
                {discovered.map((environment) => (
                  <div key={environment.name} className="grid gap-2">
                    <Label htmlFor={`branch-${environment.name}`}>
                      {environment.name}
                    </Label>
                    <Input
                      id={`branch-${environment.name}`}
                      required
                      variant="secondary"
                      value={mappings[environment.name] ?? ""}
                      disabled={busy}
                      placeholder="Choose a deployment branch"
                      onChange={(event) =>
                        setMappings((current) => ({
                          ...current,
                          [environment.name]: event.target.value,
                        }))
                      }
                    />
                    <p className="text-xs text-muted">
                      {environment.previewsEnabled
                        ? "PR previews enabled for this target branch"
                        : "PR previews disabled"}
                    </p>
                  </div>
                ))}
                <p className="text-xs text-muted">
                  Connecting imports configuration and creates required secret
                  fields. It does not deploy workloads.
                </p>
              </div>
            ) : null}
            <Button
              className="w-fit"
              isDisabled={
                !selected ||
                busy ||
                Boolean(
                  discovered?.some(
                    (environment) => !mappings[environment.name]?.trim(),
                  ),
                )
              }
              type="submit"
            >
              <HugeiconsIcon
                aria-hidden="true"
                icon={discovered ? Add01Icon : Search01Icon}
                className="size-4 shrink-0"
              />
              {busy
                ? "Loading…"
                : discovered
                  ? "Connect source"
                  : "Review configuration"}
            </Button>
          </form>
        </FormCard>
      </div>
    </DashboardPage>
  );
}
