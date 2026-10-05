"use client";

import { useState } from "react";
import type {
  GitHubConnectionMetadata,
  GitHubRepository,
  Source,
} from "@workspace/towbar-web-client";
import { Button } from "@workspace/web-design-system/buttons/button";
import { ListBox } from "@workspace/web-design-system/collections/list-box";
import { Label } from "@workspace/web-design-system/forms/label";
import { Select } from "@workspace/web-design-system/forms/select";
import { Modal } from "@workspace/web-design-system/overlays/modal";
import { toast } from "@workspace/web-design-system/overlays/toast";
import {
  Autocomplete,
  SearchField,
} from "@workspace/web-design-system/pickers/autocomplete";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { refreshApiQueries, useApiQuery } from "@/hooks/use-api-query";
import { api } from "@/lib/api";
import { FormCard } from "./page-parts";

export function SourceGitHubConnection({ source }: { source: Source }) {
  const [open, setOpen] = useState(false);
  return (
    <FormCard help={false} title="GitHub connection">
      <div className="grid gap-4">
        <p className="text-sm text-muted">
          Update this repository&apos;s connection after a GitHub transfer or
          rename. Environments, deployment history, domains, and settings are
          preserved.
        </p>
        <div>
          <Button variant="secondary" onPress={() => setOpen(true)}>
            Change repository connection
          </Button>
        </div>
        {open ? (
          <ChangeConnectionModal
            source={source}
            onClose={() => setOpen(false)}
          />
        ) : null}
      </div>
    </FormCard>
  );
}

function ChangeConnectionModal({
  source,
  onClose,
}: {
  source: Source;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [account, setAccount] = useState("");
  const [repositoryName, setRepositoryName] = useState("");
  const [error, setError] = useState<string>();
  const accounts = useApiQuery<{ connections: GitHubConnectionMetadata[] }>(
    "/v1/core/github/installation",
  );
  const repositories = useApiQuery<{
    repositories: GitHubRepository[];
    unavailableConnections: { message: string }[];
  }>(
    account
      ? `/v1/core/github/repositories?${new URLSearchParams({ connectionId: account })}`
      : null,
    undefined,
    { keepPreviousData: false },
  );
  const selected = repositories.data?.repositories.find(
    (item) => item.fullName === repositoryName,
  );
  return (
    <Modal.Backdrop
      isOpen
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Modal.Container size="lg" scroll="inside">
        <Modal.Dialog>
          <Modal.Header>
            <Modal.Heading>Change repository connection</Modal.Heading>
            <Modal.CloseTrigger isDisabled={busy} />
          </Modal.Header>
          <Modal.Body>
            <form
              id="change-github-connection"
              className="grid gap-4"
              onSubmit={async (event) => {
                event.preventDefault();
                if (busy || !selected?.connectionId) return;
                setBusy(true);
                setError(undefined);
                try {
                  await api.post(
                    `/v1/core/sources/${source.id}/actions/change-github-connection`,
                    {
                      githubInstallationId: selected.connectionId,
                      repositoryOwner: selected.owner,
                      repositoryName: selected.name,
                    },
                  );
                  refreshApiQueries();
                  toast.success("Repository connection updated");
                  onClose();
                } catch (caught) {
                  setError(
                    caught instanceof Error
                      ? caught.message
                      : "Could not update the repository connection",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              <p className="text-sm text-muted">
                Choose {source.repositoryOwner}/{source.repositoryName} in its
                new location. Towbar verifies that it is the same GitHub
                repository and that its configured branches are accessible. Sync
                the repository before its next deployment. This does not start a
                deployment.
              </p>
              {accounts.error ? (
                <QueryError message={accounts.error} />
              ) : !accounts.data ? (
                <QueryLoading />
              ) : (
                <Select
                  fullWidth
                  variant="secondary"
                  selectedKey={account || null}
                  isDisabled={busy}
                  onSelectionChange={(key) => {
                    setAccount(String(key));
                    setRepositoryName("");
                    setError(undefined);
                  }}
                >
                  <Label>GitHub account</Label>
                  <Select.Trigger>
                    <Select.Value>
                      {({ isPlaceholder, defaultChildren }) =>
                        isPlaceholder ? "Choose an account" : defaultChildren
                      }
                    </Select.Value>
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {accounts.data.connections
                        .filter((item) => !item.suspendedAt)
                        .map((item) => (
                          <ListBox.Item
                            key={item.id}
                            id={item.id}
                            textValue={item.accountLogin}
                          >
                            {item.accountLogin}
                            <ListBox.ItemIndicator />
                          </ListBox.Item>
                        ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
              )}
              {account && !repositories.data && !repositories.error ? (
                <QueryLoading />
              ) : null}
              {repositories.error ? (
                <QueryError message={repositories.error} />
              ) : null}
              {repositories.data?.unavailableConnections.map((item, index) => (
                <QueryError key={index} message={item.message} />
              ))}
              {repositories.data ? (
                <Select
                  fullWidth
                  variant="secondary"
                  selectedKey={repositoryName || null}
                  isDisabled={busy || !repositories.data.repositories.length}
                  onSelectionChange={(key) => {
                    setRepositoryName(String(key));
                    setError(undefined);
                  }}
                >
                  <Label>Repository</Label>
                  <Select.Trigger>
                    <Select.Value>
                      {({ isPlaceholder, defaultChildren }) =>
                        isPlaceholder ? "Choose a repository" : defaultChildren
                      }
                    </Select.Value>
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <Autocomplete.Filter
                      filter={(text, search) =>
                        text.toLowerCase().includes(search.trim().toLowerCase())
                      }
                    >
                      <SearchField
                        className="px-2 pt-2"
                        variant="secondary"
                        name="repository-search"
                        aria-label="Search repositories"
                      >
                        <SearchField.Group className="rounded-md">
                          <SearchField.SearchIcon />
                          <SearchField.Input
                            placeholder="Search repositories…"
                            maxLength={200}
                            autoComplete="off"
                            spellCheck={false}
                            autoFocus={
                              typeof window !== "undefined" &&
                              window.matchMedia("(pointer: fine)").matches
                            }
                          />
                          <SearchField.ClearButton aria-label="Clear repository search" />
                        </SearchField.Group>
                      </SearchField>
                      <ListBox>
                        {repositories.data.repositories.map((item) => (
                          <ListBox.Item
                            key={item.fullName}
                            id={item.fullName}
                            textValue={item.fullName}
                          >
                            {item.fullName}
                            <ListBox.ItemIndicator />
                          </ListBox.Item>
                        ))}
                      </ListBox>
                    </Autocomplete.Filter>
                  </Select.Popover>
                </Select>
              ) : null}
              {repositories.data &&
              !repositories.data.repositories.length &&
              !repositories.data.unavailableConnections.length ? (
                <p className="text-sm text-muted">
                  No repositories available. Grant this account&apos;s
                  installation access to the transferred repository in GitHub.
                </p>
              ) : null}
              {error ? (
                <p role="alert" className="text-sm text-danger">
                  {error}
                </p>
              ) : null}
            </form>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" isDisabled={busy} onPress={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="change-github-connection"
              isDisabled={!selected?.connectionId || busy}
              isPending={busy}
            >
              Save connection
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
