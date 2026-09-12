"use client";
import {
  Add01Icon,
  Delete02Icon,
  Shield01Icon,
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
import { Checkbox } from "@workspace/web-design-system/forms/checkbox";
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
  const [customNames, setCustomNames] = useState<string[]>([]);
  const [customEnvironment, setCustomEnvironment] = useState("");
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [discovered, setDiscovered] = useState<
    { name: string; previewsEnabled: boolean }[] | null
  >(null);
  const [selectedEnvironments, setSelectedEnvironments] = useState<string[]>(
    [],
  );
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
  const environmentsToConnect = (discovered ?? []).filter((environment) =>
    selectedEnvironments.includes(environment.name),
  );
  const invalidSelection = Boolean(
    discovered &&
    (!environmentsToConnect.length ||
      environmentsToConnect.some(
        (environment) => !mappings[environment.name]?.trim(),
      )),
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
            className="grid gap-6 pt-2"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!selected || busy || invalidSelection) return;
              setBusy(true);
              try {
                const repository = {
                  githubInstallationId,
                  repositoryName: selected.name,
                  repositoryOwner: selected.owner,
                };
                const result = await api.post<{
                  source: Source;
                  syncs: { error: string | null }[];
                }>("/v1/core/sources/connect", {
                  ...repository,
                  environments: environmentsToConnect.map((environment) => ({
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
            <div className="grid items-start gap-8 lg:grid-cols-2">
              <div className="grid min-w-0 gap-6">
                <ComboBox
                  className="gap-3"
                  fullWidth
                  isDisabled={busy}
                  selectedKey={fullName || null}
                  variant="secondary"
                  onSelectionChange={async (value) => {
                    const name = String(value ?? "");
                    setFullName(name);
                    setDiscovered(null);
                    setSelectedEnvironments([]);
                    setMappings({});
                    setCustomEnvironment("");
                    setCustomNames([]);
                    setDiscoveryError(null);
                    const repository = repositories.data?.repositories.find(
                      (repo) => repo.fullName === name,
                    );
                    if (!repository) return;
                    setBusy(true);
                    try {
                      const result = await api.post<{
                        environments: {
                          name: string;
                          previewsEnabled: boolean;
                        }[];
                      }>("/v1/core/sources/discover", {
                        githubInstallationId,
                        repositoryOwner: repository.owner,
                        repositoryName: repository.name,
                        discoveryBranch: repository.defaultBranch,
                      });
                      setDiscovered(result.environments);
                      setSelectedEnvironments(
                        result.environments.map(
                          (environment) => environment.name,
                        ),
                      );
                      setMappings(
                        Object.fromEntries(
                          result.environments.map((environment) => [
                            environment.name,
                            environment.name === "production"
                              ? repository.defaultBranch
                              : "",
                          ]),
                        ),
                      );
                    } catch (error) {
                      setDiscovered([]);
                      setDiscoveryError(
                        error instanceof Error
                          ? error.message
                          : "Could not read the default branch.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <Label>Repository</Label>
                  <ComboBox.InputGroup className="relative">
                    <Input
                      className={
                        selected?.private ? "min-w-0 pr-16 sm:pr-28" : "min-w-0"
                      }
                      placeholder="Search repositories…"
                    />
                    {selected?.private ? (
                      <span
                        className="pointer-events-none absolute inset-y-0 right-10 flex items-center gap-1.5 text-xs text-muted"
                        title="Private repository"
                      >
                        <HugeiconsIcon
                          icon={Shield01Icon}
                          className="size-4"
                          aria-hidden="true"
                        />
                        <span className="hidden sm:inline">Private</span>
                      </span>
                    ) : null}
                    <ComboBox.Trigger />
                  </ComboBox.InputGroup>
                  <ComboBox.Popover>
                    <ListBox>
                      {repositories.data.repositories.map((repo) => (
                        <ListBox.Item
                          key={repo.id}
                          id={repo.fullName}
                          textValue={repo.fullName}
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {repo.fullName}
                          </span>
                          {repo.private ? (
                            <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-muted">
                              <HugeiconsIcon
                                icon={Shield01Icon}
                                className="size-4"
                                aria-hidden="true"
                              />
                              Private
                            </span>
                          ) : null}
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
                {discovered ? (
                  <div className="grid gap-2">
                    <Label htmlFor="new-environment">Environment name</Label>
                    <div className="flex flex-wrap gap-2">
                      <Input
                        id="new-environment"
                        className="min-w-0 flex-1"
                        variant="secondary"
                        value={customEnvironment}
                        disabled={busy}
                        placeholder="e.g. qa"
                        onChange={(event) =>
                          setCustomEnvironment(event.target.value)
                        }
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        isDisabled={
                          busy ||
                          !customEnvironment.trim() ||
                          discovered.some(
                            (item) => item.name === customEnvironment.trim(),
                          )
                        }
                        onPress={() => {
                          const name = customEnvironment.trim();
                          setDiscovered([
                            ...discovered,
                            { name, previewsEnabled: false },
                          ]);
                          setSelectedEnvironments([
                            ...selectedEnvironments,
                            name,
                          ]);
                          setCustomNames([...customNames, name]);
                          setCustomEnvironment("");
                        }}
                      >
                        <HugeiconsIcon
                          icon={Add01Icon}
                          className="size-4"
                          aria-hidden="true"
                        />
                        Add environment
                      </Button>
                    </div>
                    <p className="text-xs text-muted">
                      Each environment must be declared in towbar.yml on its
                      selected branch. You can add more environments after
                      connecting.
                    </p>
                  </div>
                ) : null}
              </div>
              {discovered ? (
                <div className="grid min-w-0 gap-4">
                  <div className="grid gap-2">
                    <p className="text-sm">Environment mappings</p>
                    <p className="text-xs text-muted">
                      Select the environments to connect and assign their
                      deployment branches.
                    </p>
                  </div>
                  {discoveryError ? (
                    <p className="text-xs text-muted">
                      Could not suggest environments from the default branch:{" "}
                      {discoveryError} Add a mapping below; Towbar will validate
                      its selected branch.
                    </p>
                  ) : null}
                  {discovered.map((environment) => (
                    <div key={environment.name} className="grid gap-2">
                      <div className="flex min-h-9 items-center justify-between gap-3">
                        <Checkbox
                          variant="secondary"
                          isDisabled={busy}
                          isSelected={selectedEnvironments.includes(
                            environment.name,
                          )}
                          onChange={(checked) =>
                            setSelectedEnvironments((current) =>
                              checked
                                ? [...current, environment.name]
                                : current.filter(
                                    (name) => name !== environment.name,
                                  ),
                            )
                          }
                        >
                          <Checkbox.Content>
                            <Checkbox.Control className="border border-muted">
                              <Checkbox.Indicator />
                            </Checkbox.Control>
                            <Label>{environment.name}</Label>
                          </Checkbox.Content>
                        </Checkbox>
                        {customNames.includes(environment.name) ? (
                          <Button
                            type="button"
                            isIconOnly
                            variant="ghost"
                            isDisabled={busy}
                            aria-label={`Remove ${environment.name} environment`}
                            onPress={() => {
                              const name = environment.name;
                              setDiscovered(
                                discovered.filter((item) => item.name !== name),
                              );
                              setSelectedEnvironments(
                                selectedEnvironments.filter(
                                  (item) => item !== name,
                                ),
                              );
                              setCustomNames(
                                customNames.filter((item) => item !== name),
                              );
                              setMappings((current) => {
                                const next = { ...current };
                                delete next[name];
                                return next;
                              });
                            }}
                          >
                            <HugeiconsIcon
                              icon={Delete02Icon}
                              className="size-4 text-danger"
                              aria-hidden="true"
                            />
                          </Button>
                        ) : null}
                      </div>
                      <Label
                        className="sr-only"
                        htmlFor={`branch-${environment.name}`}
                      >
                        {environment.name} deployment branch
                      </Label>
                      <Input
                        id={`branch-${environment.name}`}
                        required={selectedEnvironments.includes(
                          environment.name,
                        )}
                        variant="secondary"
                        value={mappings[environment.name] ?? ""}
                        disabled={
                          busy ||
                          !selectedEnvironments.includes(environment.name)
                        }
                        placeholder="Choose a deployment branch"
                        onChange={(event) =>
                          setMappings((current) => ({
                            ...current,
                            [environment.name]: event.target.value,
                          }))
                        }
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted lg:pt-8">
                  Choose a repository to configure its environments.
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-separator pt-5">
              <p className="text-xs text-muted">
                Validates each branch, imports configuration and creates
                required secret fields. Workloads are not deployed.
              </p>
              <Button
                className="w-fit shrink-0"
                isDisabled={
                  !selected || !discovered || busy || invalidSelection
                }
                type="submit"
              >
                <HugeiconsIcon
                  aria-hidden="true"
                  icon={Add01Icon}
                  className="size-4 shrink-0"
                />
                {busy ? "Loading…" : "Connect and validate"}
              </Button>
            </div>
          </form>
        </FormCard>
      </div>
    </DashboardPage>
  );
}
