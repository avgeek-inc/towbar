"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import type {
  AutoDeployControl,
  AutoDeployControlResponse,
  AutoDeployMaintenanceWindow,
} from "@workspace/towbar-web-client";
import { Button } from "@workspace/web-design-system/buttons/button";
import { Alert } from "@workspace/web-design-system/feedback/alert";
import { Checkbox } from "@workspace/web-design-system/forms/checkbox";
import {
  Field,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@workspace/web-design-system/forms/field";
import { Input } from "@workspace/web-design-system/forms/input";
import { Label } from "@workspace/web-design-system/forms/label";
import { ListBox, Select } from "@workspace/web-design-system/forms/select";
import { Switch } from "@workspace/web-design-system/forms/switch";
import { Card } from "@workspace/web-design-system/layout/card";
import { toast } from "@workspace/web-design-system/overlays/toast";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";

import { useApiQuery } from "@/hooks/use-api-query";
import { api } from "@/lib/api";
import { formatDate } from "./dashboard-overview";

type TargetType = "app" | "resource" | "source";

type ControlDraft = {
  failureThreshold: string;
  maintenanceEnabled: boolean;
  maintenanceWindow: AutoDeployMaintenanceWindow;
  paused: boolean;
  pauseReason: string;
  recoveryPolicy: "manual" | "on_manual_success";
};

const days = [
  { label: "Sun", value: 0 },
  { label: "Mon", value: 1 },
  { label: "Tue", value: 2 },
  { label: "Wed", value: 3 },
  { label: "Thu", value: 4 },
  { label: "Fri", value: 5 },
  { label: "Sat", value: 6 },
];

export function AutoDeployControlEditor({
  id,
  onChanged,
  type,
}: {
  id: string;
  onChanged?: () => void;
  type: TargetType;
}) {
  const endpoint = controlEndpoint(type, id);
  const query = useApiQuery<AutoDeployControlResponse>(endpoint);
  const [draft, setDraft] = useState<ControlDraft>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (query.data) setDraft(controlDraft(query.data.autoDeploy.control));
  }, [query.data]);

  if (query.error) return <QueryError message={query.error} />;
  if (!query.data || !draft) return <QueryLoading />;

  const data = query.data.autoDeploy;
  const deployable = type !== "source";
  const effective = data.effective;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    if (
      draft.maintenanceEnabled &&
      draft.maintenanceWindow.daysOfWeek.length === 0
    ) {
      toast.danger("Select at least one maintenance-window day");
      return;
    }
    setSaving(true);
    try {
      await api.patch<AutoDeployControlResponse>(endpoint, {
        ...(deployable
          ? {
              failureThreshold: Number(draft.failureThreshold),
              recoveryPolicy: draft.recoveryPolicy,
            }
          : {}),
        maintenanceWindow: draft.maintenanceEnabled
          ? draft.maintenanceWindow
          : null,
        paused: draft.paused,
        pauseReason: draft.paused
          ? draft.pauseReason.trim() || "Paused by operator"
          : null,
      });
      toast.success("Automatic deployment controls saved");
      query.refresh();
      onChanged?.();
    } catch (error) {
      toast.danger(
        error instanceof Error ? error.message : "Could not save controls",
      );
    } finally {
      setSaving(false);
    }
  }

  async function recoverCircuit() {
    setSaving(true);
    try {
      await api.patch<AutoDeployControlResponse>(endpoint, {
        recoverCircuit: true,
      });
      toast.success("Automatic deployment circuit recovered");
      query.refresh();
      onChanged?.();
    } catch (error) {
      toast.danger(
        error instanceof Error ? error.message : "Could not recover circuit",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-4 sm:gap-6">
      <Alert status={effective.blocked ? "warning" : "success"}>
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>
            {effective.blocked
              ? "Automatic deployment admission is blocked"
              : "Automatic deployment admission is open"}
          </Alert.Title>
          <Alert.Description>
            {effective.blocked
              ? effectiveStatusDescription(data)
              : "Eligible revisions can be admitted automatically."}
          </Alert.Description>
        </Alert.Content>
      </Alert>

      <form className="grid gap-4 sm:gap-6" onSubmit={save}>
        <Card>
          <Card.Header>
            <Card.Title>Admission controls</Card.Title>
            <Card.Description>
              Changes affect new automatic admissions only. Running and queued
              deployments continue unchanged.
            </Card.Description>
          </Card.Header>
          <Card.Content className="grid gap-6">
            <Switch
              isDisabled={!query.data.canManageAutoDeploy}
              isSelected={draft.paused}
              onChange={(paused) => setDraft({ ...draft, paused })}
            >
              <Switch.Content className="min-h-11 w-fit">
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
                <Label>Pause automatic deployments</Label>
              </Switch.Content>
            </Switch>
            {draft.paused ? (
              <Field className="max-w-2xl">
                <FieldLabel htmlFor={`${type}-auto-deploy-pause-reason`}>
                  Pause reason
                </FieldLabel>
                <Input
                  id={`${type}-auto-deploy-pause-reason`}
                  disabled={!query.data.canManageAutoDeploy}
                  maxLength={500}
                  value={draft.pauseReason}
                  variant="secondary"
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      pauseReason: event.currentTarget.value,
                    })
                  }
                />
              </Field>
            ) : null}

            <Switch
              isDisabled={!query.data.canManageAutoDeploy}
              isSelected={draft.maintenanceEnabled}
              onChange={(maintenanceEnabled) =>
                setDraft({ ...draft, maintenanceEnabled })
              }
            >
              <Switch.Content className="min-h-11 w-fit">
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
                <Label>Restrict admissions to a maintenance window</Label>
              </Switch.Content>
            </Switch>
            {draft.maintenanceEnabled ? (
              <MaintenanceWindowFields
                disabled={!query.data.canManageAutoDeploy}
                value={draft.maintenanceWindow}
                onChange={(maintenanceWindow) =>
                  setDraft({ ...draft, maintenanceWindow })
                }
              />
            ) : null}

            {deployable ? (
              <div className="grid gap-5 border-t border-separator pt-6 md:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor={`${type}-failure-threshold`}>
                    Comparable failure threshold
                  </FieldLabel>
                  <Input
                    id={`${type}-failure-threshold`}
                    disabled={!query.data.canManageAutoDeploy}
                    max={20}
                    min={0}
                    type="number"
                    value={draft.failureThreshold}
                    variant="secondary"
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        failureThreshold: event.currentTarget.value,
                      })
                    }
                  />
                  <FieldDescription>
                    Use 0 to disable the failure circuit.
                  </FieldDescription>
                </Field>
                <Select
                  isDisabled={!query.data.canManageAutoDeploy}
                  selectedKey={draft.recoveryPolicy}
                  variant="secondary"
                  onSelectionChange={(key) =>
                    setDraft({
                      ...draft,
                      recoveryPolicy: String(
                        key,
                      ) as ControlDraft["recoveryPolicy"],
                    })
                  }
                >
                  <Label>Recovery policy</Label>
                  <Select.Trigger>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      <ListBox.Item id="manual" textValue="Manual recovery">
                        Manual recovery
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                      <ListBox.Item
                        id="on_manual_success"
                        textValue="Recover after a successful manual deploy"
                      >
                        Recover after a successful manual deploy
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    </ListBox>
                  </Select.Popover>
                </Select>
              </div>
            ) : null}
          </Card.Content>
          <Card.Footer className="flex flex-wrap justify-between gap-3">
            <div>
              {data.circuit?.openedAt ? (
                <Button
                  isDisabled={saving || !query.data.canManageAutoDeploy}
                  variant="secondary"
                  onPress={recoverCircuit}
                >
                  Recover circuit
                </Button>
              ) : null}
            </div>
            <Button
              isDisabled={saving || !query.data.canManageAutoDeploy}
              type="submit"
            >
              {saving ? "Saving…" : "Save controls"}
            </Button>
          </Card.Footer>
        </Card>
      </form>
    </div>
  );
}

function MaintenanceWindowFields({
  disabled,
  onChange,
  value,
}: {
  disabled: boolean;
  onChange: (value: AutoDeployMaintenanceWindow) => void;
  value: AutoDeployMaintenanceWindow;
}) {
  const [timezones, setTimezones] = useState(() =>
    initialTimezoneOptions(value.timezone),
  );

  useEffect(() => {
    setTimezones(supportedTimezoneOptions(value.timezone));
  }, [value.timezone]);

  return (
    <FieldSet className="rounded-3xl border border-separator p-4 sm:p-6">
      <FieldLegend>Maintenance window</FieldLegend>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
        {days.map((day) => (
          <Checkbox
            isDisabled={disabled}
            isSelected={value.daysOfWeek.includes(day.value)}
            key={day.value}
            onChange={(selected) =>
              onChange({
                ...value,
                daysOfWeek: selected
                  ? [...value.daysOfWeek, day.value].sort()
                  : value.daysOfWeek.filter((value) => value !== day.value),
              })
            }
          >
            <Checkbox.Content className="min-h-11 w-fit">
              <Checkbox.Control className="border border-border">
                <Checkbox.Indicator />
              </Checkbox.Control>
              <Label>{day.label}</Label>
            </Checkbox.Content>
          </Checkbox>
        ))}
      </div>
      <div className="grid gap-5 md:grid-cols-3">
        <Field>
          <FieldLabel htmlFor="auto-deploy-window-start">Starts</FieldLabel>
          <Input
            id="auto-deploy-window-start"
            disabled={disabled}
            type="time"
            value={minuteToTime(value.startMinute)}
            variant="secondary"
            onChange={(event) =>
              onChange({
                ...value,
                startMinute: timeToMinute(event.currentTarget.value),
              })
            }
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="auto-deploy-window-end">Ends</FieldLabel>
          <Input
            id="auto-deploy-window-end"
            disabled={disabled}
            type="time"
            value={minuteToTime(value.endMinute)}
            variant="secondary"
            onChange={(event) =>
              onChange({
                ...value,
                endMinute: timeToMinute(event.currentTarget.value),
              })
            }
          />
        </Field>
        <Select
          fullWidth
          isDisabled={disabled}
          selectedKey={value.timezone}
          variant="secondary"
          onSelectionChange={(key) =>
            onChange({ ...value, timezone: String(key) })
          }
        >
          <Label>Timezone</Label>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {timezones.map((timezone) => (
                <ListBox.Item id={timezone} key={timezone} textValue={timezone}>
                  {timezone}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </div>
      <FieldDescription>
        Times use the selected IANA timezone and follow daylight-saving changes.
      </FieldDescription>
    </FieldSet>
  );
}

function initialTimezoneOptions(current: string) {
  return [...new Set([current, "UTC"].filter(Boolean))];
}

function supportedTimezoneOptions(current: string) {
  const timezones = initialTimezoneOptions(current);
  const supportedValuesOf = (
    Intl as typeof Intl & {
      supportedValuesOf?: (key: "timeZone") => string[];
    }
  ).supportedValuesOf;

  if (supportedValuesOf) {
    timezones.push(...supportedValuesOf.call(Intl, "timeZone"));
  }

  return [...new Set(timezones)].sort((left, right) => {
    if (left === "UTC") return -1;
    if (right === "UTC") return 1;
    return left.localeCompare(right);
  });
}

function controlDraft(control: AutoDeployControl): ControlDraft {
  return {
    failureThreshold: String(control.failureThreshold),
    maintenanceEnabled: Boolean(control.maintenanceWindow),
    maintenanceWindow: control.maintenanceWindow ?? {
      daysOfWeek: [1, 2, 3, 4, 5],
      endMinute: 17 * 60,
      startMinute: 9 * 60,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    },
    paused: control.paused,
    pauseReason: control.pauseReason ?? "",
    recoveryPolicy: control.recoveryPolicy,
  };
}

function effectiveStatusDescription(
  data: AutoDeployControlResponse["autoDeploy"],
) {
  const { effective } = data;
  const parts = [
    effective.reasonDetail ?? "Automatic admissions are blocked",
    effective.scope ? `${titleCase(effective.scope)} scope` : null,
    effective.actor ? `Changed by ${effective.actor.displayName}` : null,
    effective.nextOpenAt
      ? `Next opens ${formatDate(effective.nextOpenAt)}`
      : null,
    effective.pending
      ? `Latest queued revision ${effective.pending.commitSha.slice(0, 12)}`
      : null,
  ].filter(Boolean);
  return `${parts.join(" · ")}. Manual deploy remains available with confirmation.`;
}

function controlEndpoint(type: TargetType, id: string) {
  if (type === "source") return `/v1/core/sources/${id}/auto-deploy-control`;
  return `/v1/core/${type === "app" ? "apps" : "resources"}/${id}/auto-deploy-control`;
}

function minuteToTime(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function timeToMinute(value: string) {
  const [hour = "0", minute = "0"] = value.split(":");
  return Number(hour) * 60 + Number(minute);
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " ");
}
