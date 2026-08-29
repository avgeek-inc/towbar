"use client";

import { useMemo, useState } from "react";
import type { FormEvent } from "react";

import type {
  NotificationCategory,
  NotificationDelivery,
  NotificationDestination,
} from "@workspace/towbar-web-client";
import { Button } from "@workspace/web-design-system/buttons/button";
import { Alert } from "@workspace/web-design-system/feedback/alert";
import {
  Field,
  FieldDescription,
  FieldLabel,
  FieldSet,
  FieldLegend,
} from "@workspace/web-design-system/forms/field";
import { Input } from "@workspace/web-design-system/forms/input";
import { Modal } from "@workspace/web-design-system/overlays/modal";
import { toast } from "@workspace/web-design-system/overlays/toast";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import {
  ResourceName,
  ResourceTable,
  type ResourceTableColumn,
} from "@workspace/towbar-web-ui/resource-table";
import { StatusBadge } from "@workspace/towbar-web-ui/status-badge";

import { ActionButton, SectionBlock } from "@/components/page-parts";
import { api } from "@/lib/api";
import { formatDate } from "./dashboard-overview";

export type NotificationDestinationsResponse = {
  canManageNotifications: boolean;
  destinations: NotificationDestination[];
};

export type NotificationDeliveriesResponse = {
  deliveries: NotificationDelivery[];
};

type Query<T> = {
  data?: T;
  error?: string;
  refresh: () => void;
};

type DestinationDraft = {
  categories: NotificationCategory[];
  enabled: boolean;
  from: string;
  host: string;
  name: string;
  port: string;
  provider: "slack" | "smtp";
  recipients: string;
  secretReference: string;
  secure: boolean;
  subjectPrefix: string;
};

const categoryOptions = [
  { label: "Deployments", value: "deployments" },
  { label: "Previews", value: "previews" },
  { label: "Health", value: "health" },
  { label: "Backups", value: "backups" },
  { label: "Restores", value: "restores" },
] satisfies Array<{ label: string; value: NotificationCategory }>;

const emptyDraft: DestinationDraft = {
  categories: categoryOptions.map((category) => category.value),
  enabled: true,
  from: "",
  host: "",
  name: "",
  port: "587",
  provider: "slack",
  recipients: "",
  secretReference: "",
  secure: false,
  subjectPrefix: "Towbar",
};

export function SourceNotifications({
  canManage,
  deliveries,
  destinations,
  sourceId,
}: {
  canManage: boolean;
  deliveries: Query<NotificationDeliveriesResponse>;
  destinations: Query<NotificationDestinationsResponse>;
  sourceId: string;
}) {
  const [draft, setDraft] = useState<DestinationDraft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const endpoint = `/v1/core/sources/${sourceId}/notifications`;

  const deliveryColumns = useMemo<ResourceTableColumn<NotificationDelivery>[]>(
    () => [
      {
        key: "event",
        header: "Event",
        cell: (delivery) => (
          <ResourceName
            description={delivery.payload.message}
            name={delivery.payload.title}
          />
        ),
        className: "min-w-72",
      },
      {
        key: "destination",
        header: "Destination",
        cell: (delivery) => delivery.destinationName,
        className: "min-w-40 whitespace-nowrap",
      },
      {
        key: "attempts",
        header: "Attempts",
        cell: (delivery) => delivery.attemptCount,
      },
      {
        key: "status",
        header: "Status",
        cell: (delivery) => (
          <ResourceName
            description={delivery.errorMessage ?? undefined}
            name={<StatusBadge status={delivery.state} />}
          />
        ),
        className: "min-w-56",
      },
      {
        key: "updated",
        header: "Updated",
        cell: (delivery) => formatDate(delivery.updatedAt),
        className: "whitespace-nowrap",
      },
      {
        key: "actions",
        header: "Actions",
        cell: (delivery) =>
          delivery.state === "failed" && canManage ? (
            <ActionButton
              action={() =>
                api.post(`${endpoint}/deliveries/${delivery.id}/actions/retry`)
              }
              onSuccess={() => deliveries.refresh()}
              pendingLabel="Retrying…"
              success="Notification delivery queued again"
            >
              Retry
            </ActionButton>
          ) : (
            <span className="text-muted">—</span>
          ),
      },
    ],
    [canManage, deliveries, endpoint],
  );

  if (destinations.error || deliveries.error) {
    return <QueryError message={destinations.error ?? deliveries.error!} />;
  }
  if (!destinations.data || !deliveries.data) return <QueryLoading />;

  const destinationColumns: ResourceTableColumn<NotificationDestination>[] = [
    {
      key: "destination",
      header: "Destination",
      cell: (destination) => (
        <ResourceName
          description={destination.secretReference}
          name={destination.name}
        />
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
        <StatusBadge status={destination.enabled ? "active" : "disabled"} />
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
              isDisabled={!destination.enabled}
              onSuccess={() => deliveries.refresh()}
              pendingLabel="Sending…"
              success="Test notification queued"
            >
              Test
            </ActionButton>
            <Button variant="secondary" onPress={() => openEditor(destination)}>
              Edit
            </Button>
            <ActionButton
              action={() =>
                api.delete(`${endpoint}/destinations/${destination.id}`)
              }
              confirm={{
                actionLabel: "Delete destination",
                description:
                  "Future events will no longer be delivered here. Existing delivery history is retained.",
                title: `Delete ${destination.name}?`,
              }}
              onSuccess={() => {
                destinations.refresh();
                deliveries.refresh();
              }}
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
    setEditingId(destination?.id ?? null);
    setDraft(destination ? draftFromDestination(destination) : emptyDraft);
    setSaveError(undefined);
    setEditorOpen(true);
  }

  async function saveDestination(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (draft.categories.length === 0) {
      setSaveError("Select at least one event category");
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
      <SectionBlock
        description="Send selected operational events to one or more independent destinations. Credentials stay in your Source-scoped AWS secret."
        title="Notification destinations"
      >
        <div className="grid gap-4">
          {canManage ? (
            <Button className="w-fit" onPress={() => openEditor()}>
              Add destination
            </Button>
          ) : null}
          <ResourceTable
            ariaLabel="Notification destinations"
            columns={destinationColumns}
            emptyDescription="Add Slack or SMTP delivery without changing deployment workflows."
            emptyTitle="No notification destinations"
            getRowKey={(destination) => destination.id}
            items={destinations.data.destinations}
          />
        </div>
      </SectionBlock>

      <SectionBlock
        description="Each event and destination has its own durable delivery record. Failed deliveries can be retried after correcting the destination."
        title="Delivery history"
      >
        <ResourceTable
          ariaLabel="Notification delivery history"
          columns={deliveryColumns}
          emptyDescription="Delivery attempts will appear after Towbar emits a matching event or you send a test."
          emptyTitle="No notification deliveries"
          getRowKey={(delivery) => delivery.id}
          items={deliveries.data.deliveries}
        />
      </SectionBlock>

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
                  <div className="grid gap-5 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="notification-name">Name</FieldLabel>
                      <Input
                        id="notification-name"
                        maxLength={120}
                        required
                        value={draft.name}
                        variant="secondary"
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            name: event.currentTarget.value,
                          })
                        }
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="notification-provider">
                        Provider
                      </FieldLabel>
                      <select
                        className="bg-secondary text-foreground focus-visible:ring-focus min-h-11 rounded-xl px-3 text-base outline-none focus-visible:ring-2"
                        id="notification-provider"
                        value={draft.provider}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            provider: event.currentTarget.value as
                              "slack" | "smtp",
                          })
                        }
                      >
                        <option value="slack">Slack</option>
                        <option value="smtp">Email (SMTP)</option>
                      </select>
                    </Field>
                  </div>

                  <Field>
                    <FieldLabel htmlFor="notification-secret">
                      AWS secret reference
                    </FieldLabel>
                    <Input
                      id="notification-secret"
                      maxLength={1_024}
                      placeholder={
                        draft.provider === "slack"
                          ? "aws:production/notifications/slack"
                          : "aws:production/notifications/smtp"
                      }
                      required
                      value={draft.secretReference}
                      variant="secondary"
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          secretReference: event.currentTarget.value,
                        })
                      }
                    />
                    <FieldDescription>
                      {draft.provider === "slack"
                        ? "The secret must contain webhookUrl."
                        : "The secret must contain username and password."}
                    </FieldDescription>
                  </Field>

                  {draft.provider === "smtp" ? (
                    <SmtpFields draft={draft} onChange={setDraft} />
                  ) : null}

                  <FieldSet>
                    <FieldLegend>Event categories</FieldLegend>
                    <div className="grid gap-1 sm:grid-cols-2">
                      {categoryOptions.map((category) => (
                        <label
                          className="inline-flex min-h-11 items-center gap-3"
                          key={category.value}
                        >
                          <input
                            checked={draft.categories.includes(category.value)}
                            className="size-4 accent-[var(--accent)]"
                            type="checkbox"
                            onChange={(event) =>
                              setDraft({
                                ...draft,
                                categories: event.currentTarget.checked
                                  ? [...draft.categories, category.value]
                                  : draft.categories.filter(
                                      (value) => value !== category.value,
                                    ),
                              })
                            }
                          />
                          <span>{category.label}</span>
                        </label>
                      ))}
                    </div>
                  </FieldSet>

                  <label className="inline-flex min-h-11 items-center gap-3">
                    <input
                      checked={draft.enabled}
                      className="size-4 accent-[var(--accent)]"
                      type="checkbox"
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          enabled: event.currentTarget.checked,
                        })
                      }
                    />
                    <span>Enable this destination</span>
                  </label>

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

function SmtpFields({
  draft,
  onChange,
}: {
  draft: DestinationDraft;
  onChange: (draft: DestinationDraft) => void;
}) {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Field>
        <FieldLabel htmlFor="notification-smtp-host">SMTP host</FieldLabel>
        <Input
          id="notification-smtp-host"
          maxLength={253}
          required
          value={draft.host}
          variant="secondary"
          onChange={(event) =>
            onChange({ ...draft, host: event.currentTarget.value })
          }
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="notification-smtp-port">Port</FieldLabel>
        <Input
          id="notification-smtp-port"
          max={65_535}
          min={1}
          required
          type="number"
          value={draft.port}
          variant="secondary"
          onChange={(event) =>
            onChange({ ...draft, port: event.currentTarget.value })
          }
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="notification-smtp-from">From</FieldLabel>
        <Input
          id="notification-smtp-from"
          maxLength={320}
          required
          type="email"
          value={draft.from}
          variant="secondary"
          onChange={(event) =>
            onChange({ ...draft, from: event.currentTarget.value })
          }
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="notification-smtp-prefix">
          Subject prefix
        </FieldLabel>
        <Input
          id="notification-smtp-prefix"
          maxLength={80}
          value={draft.subjectPrefix}
          variant="secondary"
          onChange={(event) =>
            onChange({ ...draft, subjectPrefix: event.currentTarget.value })
          }
        />
      </Field>
      <Field className="sm:col-span-2">
        <FieldLabel htmlFor="notification-smtp-recipients">
          Recipients
        </FieldLabel>
        <Input
          id="notification-smtp-recipients"
          required
          value={draft.recipients}
          variant="secondary"
          onChange={(event) =>
            onChange({ ...draft, recipients: event.currentTarget.value })
          }
        />
        <FieldDescription>
          Separate multiple email addresses with commas.
        </FieldDescription>
      </Field>
      <label className="inline-flex min-h-11 items-center gap-3 sm:col-span-2">
        <input
          checked={draft.secure}
          className="size-4 accent-[var(--accent)]"
          type="checkbox"
          onChange={(event) =>
            onChange({ ...draft, secure: event.currentTarget.checked })
          }
        />
        <span>Use implicit TLS</span>
      </label>
    </div>
  );
}

function draftFromDestination(
  destination: NotificationDestination,
): DestinationDraft {
  const smtp =
    destination.provider === "smtp" && "host" in destination.config
      ? destination.config
      : null;
  return {
    categories: destination.categories,
    enabled: destination.enabled,
    from: smtp?.from ?? "",
    host: smtp?.host ?? "",
    name: destination.name,
    port: String(smtp?.port ?? 587),
    provider: destination.provider,
    recipients: smtp?.recipients.join(", ") ?? "",
    secretReference: destination.secretReference,
    secure: smtp?.secure ?? false,
    subjectPrefix: smtp?.subjectPrefix ?? "Towbar",
  };
}

function destinationPayload(draft: DestinationDraft) {
  const base = {
    categories: draft.categories,
    enabled: draft.enabled,
    name: draft.name.trim(),
    secretReference: draft.secretReference.trim(),
  };
  if (draft.provider === "slack") {
    return { ...base, config: {}, provider: "slack" as const };
  }
  return {
    ...base,
    config: {
      from: draft.from.trim(),
      host: draft.host.trim(),
      port: Number(draft.port),
      recipients: draft.recipients
        .split(",")
        .map((recipient) => recipient.trim())
        .filter(Boolean),
      secure: draft.secure,
      subjectPrefix: draft.subjectPrefix.trim(),
    },
    provider: "smtp" as const,
  };
}

function providerLabel(provider: NotificationDestination["provider"]) {
  return provider === "slack" ? "Slack" : "Email (SMTP)";
}

function titleCase(value: string) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
