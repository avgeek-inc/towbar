"use client";

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
  if (connection.error && !connection.data)
    return (
      <DashboardPage breadcrumbAncestors={sourcesBreadcrumb} title="Add source">
        <QueryError message={connection.error} />
      </DashboardPage>
    );
  if (!connection.data)
    return (
      <DashboardPage breadcrumbAncestors={sourcesBreadcrumb} title="Add source">
        <QueryLoading />
      </DashboardPage>
    );
  if (!connection.data.connection)
    return (
      <DashboardPage breadcrumbAncestors={sourcesBreadcrumb} title="Add source">
        <EmptyState>
          <EmptyState.Header>
            <EmptyState.Title>GitHub not connected</EmptyState.Title>
            <EmptyState.Description>
              Install the GitHub App before adding a Source.
            </EmptyState.Description>
          </EmptyState.Header>
          <EmptyState.Content>
            <ButtonLink href="/settings?section=github">
              Open GitHub settings
            </ButtonLink>
          </EmptyState.Content>
        </EmptyState>
      </DashboardPage>
    );
  if (repositories.error)
    return (
      <DashboardPage breadcrumbAncestors={sourcesBreadcrumb} title="Add source">
        <QueryError message={repositories.error} />
      </DashboardPage>
    );
  if (!repositories.data)
    return (
      <DashboardPage breadcrumbAncestors={sourcesBreadcrumb} title="Add source">
        <QueryLoading />
      </DashboardPage>
    );
  if (repositories.data.repositories.length === 0)
    return (
      <DashboardPage breadcrumbAncestors={sourcesBreadcrumb} title="Add source">
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
    <DashboardPage breadcrumbAncestors={sourcesBreadcrumb} title="Add source">
      <div className="grid gap-10">
        <div className="max-w-full overflow-x-auto pb-1">
          <div className="min-w-[44rem]">
            <Stepper currentStep={busy ? 2 : 1}>
              {[
                ["Connect GitHub", "Repository access is ready."],
                [
                  "Choose repository",
                  "Select the repository Towbar should sync.",
                ],
                [
                  "Sync manifest",
                  "Towbar validates and imports .towbar/deployment.yml.",
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
          description="Choose one repository from the connected GitHub installation."
          title="Source details"
        >
          <form
            className="grid max-w-xl gap-8 pt-2"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!selected) return;
              setBusy(true);
              let createdSource: Source;
              try {
                const response = await api.post<{ source: Source }>(
                  "/v1/core/sources",
                  {
                    branch: selected.defaultBranch,
                    githubInstallationId,
                    repositoryName: selected.name,
                    repositoryOwner: selected.owner,
                  },
                );
                if (!response.source?.id) {
                  throw new Error("Towbar did not return the created Source.");
                }
                createdSource = response.source;
              } catch (caught) {
                toast.danger("Couldn't add source", {
                  description:
                    caught instanceof Error
                      ? caught.message
                      : "Could not add source",
                });
                setBusy(false);
                return;
              }

              try {
                await api.post(
                  `/v1/core/sources/${createdSource.id}/actions/sync`,
                );
              } catch (caught) {
                toast.danger("Source added, but sync couldn't start", {
                  description:
                    caught instanceof Error
                      ? caught.message
                      : "Could not start the initial source sync",
                });
              }
              router.push(`/sources/${createdSource.id}`);
            }}
          >
            <ComboBox
              className="gap-3"
              fullWidth
              selectedKey={fullName || null}
              variant="secondary"
              onSelectionChange={(value) => setFullName(String(value ?? ""))}
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
                The default branch is used only for the first sync. Future syncs
                use the branch declared in .towbar/deployment.yml.
              </Description>
            </ComboBox>
            <Button
              className="w-fit"
              isDisabled={!selected || busy}
              type="submit"
            >
              {busy ? "Adding…" : "Add and sync source"}
            </Button>
          </form>
        </FormCard>
      </div>
    </DashboardPage>
  );
}
