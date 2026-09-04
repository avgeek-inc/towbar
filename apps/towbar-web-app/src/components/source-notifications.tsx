"use client";

import { useState } from "react";
import type { FormEvent } from "react";

import type {
  NotificationCategory,
  NotificationDestination,
} from "@workspace/towbar-web-client";
import { Button } from "@workspace/web-design-system/buttons/button";
import { Alert } from "@workspace/web-design-system/feedback/alert";
import { Checkbox } from "@workspace/web-design-system/forms/checkbox";
import {
  Field,
  FieldDescription,
  FieldLabel,
  FieldSet,
  FieldLegend,
} from "@workspace/web-design-system/forms/field";
import { Input } from "@workspace/web-design-system/forms/input";
import { Label } from "@workspace/web-design-system/forms/label";
import { ListBox, Select } from "@workspace/web-design-system/forms/select";
import { Switch } from "@workspace/web-design-system/forms/switch";
import { Modal } from "@workspace/web-design-system/overlays/modal";
import { toast } from "@workspace/web-design-system/overlays/toast";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import {
  ResourceName,
  ResourceTable,
  type ResourceTableColumn,
} from "@workspace/towbar-web-ui/resource-table";
import { StatusBadge } from "@workspace/towbar-web-ui/status-badge";

import { ActionButton } from "@/components/page-parts";
import { api } from "@/lib/api";

export type NotificationDestinationsResponse = {
  canManageNotifications: boolean;
  destinations: NotificationDestination[];
  providers: ProviderAvailability;
};

type ProviderAvailability = { slack: boolean; smtp: boolean };

type Query<T> = {
  data?: T;
  error?: string;
  refresh: () => void;
};

type DestinationDraft = {
  categories: NotificationCategory[];
  channelId: string;
  enabled: boolean;
  provider: "slack" | "smtp";
  recipients: string;
};

const categoryOptions = [
  { label: "Deployments", value: "deployments" },
  { label: "Previews", value: "previews" },
  { label: "Health", value: "health" },
  { label: "Backups", value: "backups" },
  { label: "Restores", value: "restores" },
] satisfies Array<{ label: string; value: NotificationCategory }>;

const providerOptions = [
  { label: "Slack", value: "slack" },
  { label: "Email", value: "smtp" },
] as const;

export function SourceNotifications({
  canManage,
  destinations,
  sourceId,
}: {
  canManage: boolean;
  destinations: Query<NotificationDestinationsResponse>;
  sourceId: string;
}) {
  const [draft, setDraft] = useState<DestinationDraft>(() =>
    emptyDraft("slack"),
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const endpoint = `/v1/core/sources/${sourceId}/notifications`;

  if (destinations.error) return <QueryError message={destinations.error} />;
  if (!destinations.data) return <QueryLoading />;

  const providers = destinations.data.providers;
  const hasProvider = providers.slack || providers.smtp;
  const availableProviderOptions = providerOptions.filter(
    (provider) => providers[provider.value],
  );
  const destinationColumns: ResourceTableColumn<NotificationDestination>[] = [
    {
      key: "destination",
      header: "Destination",
      cell: (destination) => (
        <ResourceName name={destinationTarget(destination)} />
      ),
      className: "min-w-64",
    },
    {
      key: "provider",
      header: "Provider",
      cell: (destination) => providerLabel(destination.provider),
    },
    {
      key: "categories",
      header: "Events",
      cell: (destination) => destination.categories.map(titleCase).join(", "),
      className: "min-w-64",
    },
    {
      key: "status",
      header: "Status",
      cell: (destination) => (
        <StatusBadge
          status={
            !providers[destination.provider]
              ? "unavailable"
              : destination.enabled
                ? "active"
                : "disabled"
          }
        />
      ),
    },
    {
      key: "actions",
      header: "Actions",
      cell: (destination) =>
        canManage ? (
          <div className="flex flex-wrap gap-2">
            <ActionButton
              action={() =>
                api.post(
                  `${endpoint}/destinations/${destination.id}/actions/test`,
                )
              }
              isDisabled={
                !destination.enabled || !providers[destination.provider]
              }
              pendingLabel="Sending…"
              success="Test notification queued"
            >
              Test
            </ActionButton>
            <Button
              isDisabled={!providers[destination.provider]}
              variant="secondary"
              onPress={() => openEditor(destination)}
            >
              Edit
            </Button>
            <ActionButton
              action={() =>
                api.delete(`${endpoint}/destinations/${destination.id}`)
              }
              confirm={{
                actionLabel: "Delete destination",
                description:
                  "Future operational events will no longer be sent to this destination.",
                title: `Delete ${providerLabel(destination.provider)} destination?`,
              }}
              onSuccess={destinations.refresh}
              pendingLabel="Deleting…"
              success="Notification destination deleted"
              variant="danger"
            >
              Delete
            </ActionButton>
          </div>
        ) : (
          <span className="text-muted">—</span>
        ),
      className: "min-w-72",
    },
  ];

  function openEditor(destination?: NotificationDestination) {
    const defaultProvider = providers.slack ? "slack" : "smtp";
    setEditingId(destination?.id ?? null);
    setDraft(
      destination
        ? draftFromDestination(destination)
        : emptyDraft(defaultProvider),
    );
    setSaveError(undefined);
    setEditorOpen(true);
  }

  async function saveDestination(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (draft.categories.length === 0) {
      setSaveError("Select at least one event category");
      return;
    }
    if (!providers[draft.provider]) {
      setSaveError(
        `${providerLabel(draft.provider)} is not configured for this Towbar instance`,
      );
      return;
    }
    setSaving(true);
    setSaveError(undefined);
    try {
      const payload = destinationPayload(draft);
      if (editingId) {
        await api.put(`${endpoint}/destinations/${editingId}`, payload);
      } else {
        await api.post(`${endpoint}/destinations`, payload);
      }
      toast.success(
        editingId
          ? "Notification destination updated"
          : "Notification destination added",
      );
      destinations.refresh();
      setEditorOpen(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-4 sm:gap-6">
      {!hasProvider ? (
        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>No notification providers configured</Alert.Title>
            <Alert.Description>
              Configure Slack or SMTP environment variables when deploying
              Towbar to make that destination type available.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}
      <ResourceTable
        ariaLabel="Notification destinations"
        columns={destinationColumns}
        emptyDescription={
          hasProvider
            ? "Add a configured notification destination for this Source."
            : "Notification destinations become available after a provider is configured for Towbar."
        }
        emptyTitle="No notification destinations"
        getRowKey={(destination) => destination.id}
        items={destinations.data.destinations}
      />
      {canManage && hasProvider ? (
        <div>
          <Button onPress={() => openEditor()}>Add destination</Button>
        </div>
      ) : null}

      <Modal isOpen={editorOpen} onOpenChange={setEditorOpen}>
        <Modal.Backdrop>
          <Modal.Container scroll="inside" size="lg">
            <Modal.Dialog>
              <Modal.CloseTrigger />
              <Modal.Header>
                <Modal.Heading>
                  {editingId ? "Edit destination" : "Add destination"}
                </Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                <form className="grid gap-5" onSubmit={saveDestination}>
                  {saveError ? (
                    <Alert status="danger">
                      <Alert.Indicator />
                      <Alert.Content>
                        <Alert.Title>
                          Couldn&apos;t save destination
                        </Alert.Title>
                        <Alert.Description>{saveError}</Alert.Description>
                      </Alert.Content>
                    </Alert>
                  ) : null}
                  <Select
                    isRequired
                    selectedKey={draft.provider}
                    variant="secondary"
                    onSelectionChange={(key) =>
                      setDraft({
                        ...draft,
                        provider: String(key) as "slack" | "smtp",
                      })
                    }
                  >
                    <Label>Provider</Label>
                    <Select.Trigger>
                      <Select.Value />
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        {availableProviderOptions.map((provider) => (
                          <ListBox.Item
                            id={provider.value}
                            key={provider.value}
                            textValue={provider.label}
                          >
                            {provider.label}
                            <ListBox.ItemIndicator />
                          </ListBox.Item>
                        ))}
                      </ListBox>
                    </Select.Popover>
                  </Select>

                  {draft.provider === "slack" ? (
                    <Field>
                      <FieldLabel htmlFor="notification-channel">
                        Slack channel ID
                      </FieldLabel>
                      <Input
                        id="notification-channel"
                        maxLength={80}
                        placeholder="C0123456789"
                        required
                        value={draft.channelId}
                        variant="secondary"
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            channelId: event.currentTarget.value,
                          })
                        }
                      />
                      <FieldDescription>
                        Invite the configured Towbar bot to this channel first.
                      </FieldDescription>
                    </Field>
                  ) : (
                    <Field>
                      <FieldLabel htmlFor="notification-recipients">
                        Recipients
                      </FieldLabel>
                      <Input
                        id="notification-recipients"
                        required
                        value={draft.recipients}
                        variant="secondary"
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            recipients: event.currentTarget.value,
                          })
                        }
                      />
                      <FieldDescription>
                        Separate multiple email addresses with commas.
                      </FieldDescription>
                    </Field>
                  )}

                  <FieldSet>
                    <FieldLegend>Event categories</FieldLegend>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {categoryOptions.map((category) => (
                        <Checkbox
                          isSelected={draft.categories.includes(category.value)}
                          key={category.value}
                          onChange={(selected) =>
                            setDraft({
                              ...draft,
                              categories: selected
                                ? [...draft.categories, category.value]
                                : draft.categories.filter(
                                    (value) => value !== category.value,
                                  ),
                            })
                          }
                        >
                          <Checkbox.Content className="min-h-8 w-fit">
                            <Checkbox.Control>
                              <Checkbox.Indicator />
                            </Checkbox.Control>
                            <Label>{category.label}</Label>
                          </Checkbox.Content>
                        </Checkbox>
                      ))}
                    </div>
                  </FieldSet>

                  <Switch
                    isSelected={draft.enabled}
                    onChange={(enabled) => setDraft({ ...draft, enabled })}
                  >
                    <Switch.Content className="min-h-8 w-fit">
                      <Switch.Control>
                        <Switch.Thumb />
                      </Switch.Control>
                      <Label>Enable this destination</Label>
                    </Switch.Content>
                  </Switch>

                  <div className="flex justify-end gap-3">
                    <Button
                      isDisabled={saving}
                      variant="secondary"
                      onPress={() => setEditorOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button isDisabled={saving} type="submit">
                      {saving ? "Saving…" : "Save destination"}
                    </Button>
                  </div>
                </form>
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  );
}

function emptyDraft(provider: "slack" | "smtp"): DestinationDraft {
  return {
    categories: categoryOptions.map((category) => category.value),
    channelId: "",
    enabled: true,
    provider,
    recipients: "",
  };
}

function draftFromDestination(
  destination: NotificationDestination,
): DestinationDraft {
  return {
    categories: destination.categories,
    channelId:
      destination.provider === "slack" && "channelId" in destination.config
        ? destination.config.channelId
        : "",
    enabled: destination.enabled,
    provider: destination.provider,
    recipients:
      destination.provider === "smtp" && "recipients" in destination.config
        ? destination.config.recipients.join(", ")
        : "",
  };
}

function destinationPayload(draft: DestinationDraft) {
  const base = {
    categories: draft.categories,
    enabled: draft.enabled,
  };
  if (draft.provider === "slack") {
    return {
      ...base,
      config: { channelId: draft.channelId.trim() },
      provider: "slack" as const,
    };
  }
  return {
    ...base,
    config: {
      recipients: draft.recipients
        .split(",")
        .map((recipient) => recipient.trim())
        .filter(Boolean),
    },
    provider: "smtp" as const,
  };
}

function destinationTarget(destination: NotificationDestination): string {
  if (destination.provider === "slack" && "channelId" in destination.config) {
    return destination.config.channelId;
  }
  if (destination.provider === "smtp" && "recipients" in destination.config) {
    return destination.config.recipients.join(", ");
  }
  return providerLabel(destination.provider);
}

function providerLabel(provider: NotificationDestination["provider"]) {
  return provider === "slack" ? "Slack" : "Email";
}

function titleCase(value: string) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
