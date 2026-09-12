"use client";
import {
  Add01Icon,
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
import { Input } from "@workspace/web-design-system/forms/input";
import { Label } from "@workspace/web-design-system/forms/label";
import { Modal } from "@workspace/web-design-system/overlays/modal";
import { toast } from "@workspace/web-design-system/overlays/toast";
import { ComboBox } from "@workspace/web-design-system/pickers/combo-box";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";

import { useApiQuery } from "@/hooks/use-api-query";
import { api } from "@/lib/api";

export function SourceCreateModal({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Modal.Backdrop>
        <Modal.Container size="lg" scroll="inside">
          <Modal.Dialog>
            <Modal.CloseTrigger isDisabled={busy} />
            <Modal.Header>
              <Modal.Heading>
                <span className="flex items-center gap-2">
                  <HugeiconsIcon
                    icon={GitBranchIcon}
                    className="size-5"
                    aria-hidden="true"
                  />
                  Add source
                </span>
              </Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <SourceCreate busy={busy} setBusy={setBusy} onClose={onClose} />
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function SourceCreate({
  busy,
  setBusy,
  onClose,
}: {
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const connection = useApiQuery<{ connection: GitHubConnection | null }>(
    "/v1/core/github",
  );
  const repositories = useApiQuery<{ repositories: GitHubRepository[] }>(
    connection.data?.connection ? "/v1/core/github/repositories" : null,
  );
  const [fullName, setFullName] = useState("");
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
      <>
        <QueryError message={connection.error} />
      </>
    );
  if (!connection.data)
    return (
      <>
        <QueryLoading />
      </>
    );
  if (!connection.data.connection)
    return (
      <>
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
      </>
    );
  if (repositories.error)
    return (
      <>
        <QueryError message={repositories.error} />
      </>
    );
  if (!repositories.data)
    return (
      <>
        <QueryLoading />
      </>
    );
  if (repositories.data.repositories.length === 0)
    return (
      <>
        <EmptyState>
          <EmptyState.Header>
            <EmptyState.Title>No repositories available</EmptyState.Title>
            <EmptyState.Description>
              Grant the Towbar GitHub App access to at least one repository,
              then return here.
            </EmptyState.Description>
          </EmptyState.Header>
        </EmptyState>
      </>
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
              description: "Open the environment to retry its initial sync.",
            });
          } else toast.success("Source connected");
          onClose();
          router.push(`/sources/${result.source.id}`);
        } catch (caught) {
          toast.danger(
            discovered
              ? "Couldn't connect source"
              : "Couldn't read configuration",
            {
              description:
                caught instanceof Error ? caught.message : "The request failed",
            },
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid gap-6">
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
                  result.environments.map((environment) => environment.name),
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
                      <span className="ml-auto mr-6 flex shrink-0 items-center gap-1.5 text-xs text-muted">
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
          </ComboBox>
        </div>
        {discovered ? (
          <div className="grid min-w-0 gap-4">
            {discoveryError ? (
              <p className="text-xs text-muted">
                Could not suggest environments from the default branch:{" "}
                {discoveryError} Add a mapping below; Towbar will validate its
                selected branch.
              </p>
            ) : null}
            <div
              className="hidden gap-4 text-xs text-muted sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
              aria-hidden="true"
            >
              <span>Environment</span>
              <span>Deployment branch</span>
            </div>
            {discovered.map((environment) => (
              <div
                key={environment.name}
                className="grid grid-cols-1 items-center gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
              >
                <div className="col-start-1 row-start-1 flex min-h-9 min-w-0 items-center">
                  <Checkbox
                    variant="secondary"
                    isDisabled={busy}
                    isSelected={selectedEnvironments.includes(environment.name)}
                    onChange={(checked) => {
                      const name = environment.name;
                      setSelectedEnvironments((current) =>
                        checked
                          ? [...current, name]
                          : current.filter((item) => item !== name),
                      );
                      if (
                        !checked &&
                        name !== "production" &&
                        name !== "staging"
                      ) {
                        setDiscovered(
                          (current) =>
                            current?.filter((item) => item.name !== name) ?? [],
                        );
                        setMappings((current) => {
                          const next = { ...current };
                          delete next[name];
                          return next;
                        });
                      }
                    }}
                  >
                    <Checkbox.Content>
                      <Checkbox.Control className="border border-muted">
                        <Checkbox.Indicator />
                      </Checkbox.Control>
                      <Label>{environment.name}</Label>
                    </Checkbox.Content>
                  </Checkbox>
                </div>
                <div className="relative row-start-2 min-w-0 sm:col-span-1 sm:col-start-2 sm:row-start-1">
                  <Label
                    className="sr-only"
                    htmlFor={`branch-${environment.name}`}
                  >
                    {environment.name} deployment branch
                  </Label>
                  <HugeiconsIcon
                    icon={GitBranchIcon}
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
                  />
                  <Input
                    id={`branch-${environment.name}`}
                    className="w-full pl-10"
                    required={selectedEnvironments.includes(environment.name)}
                    variant="secondary"
                    value={mappings[environment.name] ?? ""}
                    disabled={
                      busy || !selectedEnvironments.includes(environment.name)
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
              </div>
            ))}
            {discovered ? (
              <div className="grid gap-2 border-t border-separator pt-4">
                <Label htmlFor="new-environment">Add another environment</Label>
                <div className="flex max-w-xl flex-wrap gap-2">
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
                      setSelectedEnvironments([...selectedEnvironments, name]);
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
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-separator pt-5">
        <p className="text-xs text-muted">
          Validates each branch, imports configuration and creates required
          secret fields. Workloads are not deployed.
        </p>
        <Button
          className="ml-auto w-fit shrink-0"
          isDisabled={!selected || !discovered || busy || invalidSelection}
          type="submit"
        >
          <HugeiconsIcon
            aria-hidden="true"
            icon={Add01Icon}
            className="size-4 shrink-0"
          />
          {busy ? "Loading…" : "Connect and Validate"}
        </Button>
      </div>
    </form>
  );
}
