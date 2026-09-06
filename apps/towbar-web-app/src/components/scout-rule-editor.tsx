"use client";
import { ScoutHttpEditor } from "./scout-http-editor";
import { useId, useState, type FormEvent } from "react";
import {
  scoutAlertPresets,
  scoutAlertRuleSchema,
  type ScoutAlertRuleInput,
} from "@workspace/towbar-web-client";
import { Button } from "@workspace/web-design-system/buttons/button";
import { Input } from "@workspace/web-design-system/forms/input";
import { Field, FieldLabel } from "@workspace/web-design-system/forms/field";
import { Checkbox } from "@workspace/web-design-system/forms/checkbox";
import { Label } from "@workspace/web-design-system/forms/label";
import { Modal } from "@workspace/web-design-system/overlays/modal";
import { toast } from "@workspace/web-design-system/overlays/toast";
import { QueryError } from "@workspace/towbar-web-ui/query-state";
import { api } from "@/lib/api";
import {
  ScoutNumber,
  ScoutSelect,
  conditionDescription,
  metricDefinition,
  scoutMetrics,
  type ScoutRule,
  type ScoutRulesResponse,
} from "./scout-controls";

export function ScoutRuleEditor({
  serverId,
  initial,
  data,
  deployableId,
  onClose,
  onSaved,
}: {
  serverId: string;
  initial?: ScoutRule;
  data: ScoutRulesResponse;
  deployableId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<ScoutAlertRuleInput>(() =>
    scoutAlertRuleSchema.parse(
      initial
        ? {
            name: initial.name,
            enabled: initial.enabled,
            severity: initial.severity,
            deployableId: initial.deployableId,
            environment: initial.environment,
            condition: initial.condition,
            destinationIds: initial.destinationIds,
            notifyRecovery: initial.notifyRecovery,
            repeatSeconds: initial.repeatSeconds,
          }
        : {
            name: "Sustained memory pressure",
            condition: scoutAlertPresets.find((p) => p.id === "memory")!
              .condition,
            deployableId: deployableId ?? null,
          },
    ),
  );
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const nameId = useId();
  const [presetId, setPresetId] = useState(initial ? "custom" : "memory");
  const [customRepeat, setCustomRepeat] = useState(
    ![0, 900, 3600, 21600, 86400].includes(initial?.repeatSeconds ?? 0),
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const definition = metricDefinition(draft.condition.metric);
  const condition = (values: Partial<ScoutAlertRuleInput["condition"]>) => {
    setPresetId("custom");
    setDraft((old) => ({ ...old, condition: { ...old.condition, ...values } }));
  };
  const workload = data.workloads.find((w) => w.id === draft.deployableId);
  const destinations = data.destinations.filter(
    (d) =>
      d.serverId === serverId || (workload && d.sourceId === workload.sourceId),
  );
  const isCounter = ["missingReports", "restarts", "httpAvailability"].includes(
    draft.condition.metric,
  );
  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const result = scoutAlertRuleSchema.safeParse(draft);
    if (!result.success) {
      setFieldErrors(
        Object.fromEntries(
          result.error.issues.map((issue) => [
            issue.path.join("."),
            issue.message,
          ]),
        ),
      );
      setAdvancedOpen(true);
      setError(result.error.issues.map((issue) => issue.message).join(". "));
      return;
    }
    setSaving(true);
    setError(undefined);
    setFieldErrors({});
    try {
      const path = `/v1/core/servers/${serverId}/scout-alerts/rules`;
      if (initial) await api.put(`${path}/${initial.id}`, result.data);
      else await api.post(path, result.data);
      toast.success(initial ? "Alert rule updated" : "Alert rule created");
      onSaved();
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save the rule",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <Modal.Backdrop>
        <Modal.Container size="lg" scroll="inside">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>
                {initial ? "Edit alert rule" : "Create alert rule"}
              </Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <form onSubmit={save} className="grid gap-6">
                {error ? <QueryError message={error} /> : null}
                {!initial ? (
                  <ScoutSelect
                    label="Start with a preset"
                    value={presetId}
                    options={[
                      { id: "custom", label: "Customise this rule" },
                      ...scoutAlertPresets
                        .filter(
                          (p) =>
                            !draft.deployableId ||
                            !["disk", "offline"].includes(p.id),
                        )
                        .map((p) => ({ id: p.id, label: p.name })),
                    ]}
                    onChange={(id) => {
                      setPresetId(id);
                      const preset = scoutAlertPresets.find((p) => p.id === id);
                      if (preset)
                        setDraft({
                          ...draft,
                          name: preset.name,
                          severity: preset.severity,
                          condition: { ...preset.condition },
                        });
                    }}
                  />
                ) : null}
                <Field>
                  <FieldLabel htmlFor={nameId}>Rule name</FieldLabel>
                  <Input
                    id={nameId}
                    value={draft.name}
                    onChange={(e) =>
                      setDraft({ ...draft, name: e.currentTarget.value })
                    }
                    maxLength={100}
                    required
                    variant="secondary"
                    aria-invalid={Boolean(fieldErrors.name)}
                  />
                  {fieldErrors.name ? (
                    <p className="text-sm text-danger">{fieldErrors.name}</p>
                  ) : null}
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <ScoutSelect
                    label="Monitor"
                    value={draft.deployableId ?? "host"}
                    options={[
                      { id: "host", label: "This server" },
                      ...data.workloads.map((w) => ({
                        id: w.id,
                        label: w.name,
                      })),
                    ]}
                    onChange={(id) =>
                      setDraft({
                        ...draft,
                        deployableId: id === "host" ? null : id,
                        destinationIds: [],
                        condition:
                          id !== "host" &&
                          [
                            "diskPercent",
                            "dockerDiskPercent",
                            "missingReports",
                            "load1",
                            "load5",
                            "load15",
                            "swapUsedBytes",
                            "httpAvailability",
                          ].includes(draft.condition.metric)
                            ? { ...scoutAlertPresets[1]!.condition }
                            : draft.condition,
                      })
                    }
                  />
                  <ScoutSelect
                    label="Severity"
                    value={draft.severity}
                    options={[
                      { id: "warning", label: "Warning" },
                      { id: "critical", label: "Critical" },
                    ]}
                    onChange={(value) =>
                      setDraft({
                        ...draft,
                        severity: value as "warning" | "critical",
                      })
                    }
                  />
                </div>
                {draft.deployableId ? (
                  <ScoutSelect
                    label="Environment"
                    value={draft.environment}
                    options={[
                      { id: "production", label: "Production" },
                      { id: "preview", label: "Previews" },
                    ]}
                    onChange={(environment) =>
                      setDraft({
                        ...draft,
                        environment: environment as "production" | "preview",
                      })
                    }
                  />
                ) : null}
                <fieldset className="grid gap-4">
                  <legend className="mb-4 font-medium">Alert condition</legend>
                  <ScoutSelect
                    label="Metric"
                    value={draft.condition.metric}
                    options={scoutMetrics
                      .filter(
                        (m) =>
                          !draft.deployableId ||
                          ![
                            "diskPercent",
                            "dockerDiskPercent",
                            "missingReports",
                            "load1",
                            "load5",
                            "load15",
                            "swapUsedBytes",
                            "httpAvailability",
                          ].includes(m.id),
                      )
                      .map((m) => ({ id: m.id, label: m.label }))}
                    onChange={(metric) => {
                      if (metric === "httpAvailability") {
                        condition({
                          metric,
                          threshold: 1,
                          recoveryThreshold: 0,
                          operator: "above",
                          http: {
                            url: "",
                            method: "GET",
                            intervalSeconds: 60,
                            timeoutSeconds: 5,
                            expectedStatusMin: 200,
                            expectedStatusMax: 299,
                            maxRedirects: 0,
                          },
                        });
                        return;
                      }
                      const preset = scoutAlertPresets.find(
                        (p) => p.condition.metric === metric,
                      );
                      condition({
                        http: undefined,
                        ...(preset
                          ? preset.condition
                          : {
                              metric:
                                metric as ScoutAlertRuleInput["condition"]["metric"],
                              threshold: metricDefinition(metric).factor,
                              recoveryThreshold:
                                metricDefinition(metric).factor * 0.8,
                              operator: "above",
                            }),
                      });
                    }}
                  />
                  {draft.condition.http ? (
                    <ScoutHttpEditor
                      value={draft.condition.http}
                      onChange={(http) => condition({ http })}
                    />
                  ) : (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <ScoutSelect
                        label="Trigger when"
                        value={draft.condition.operator}
                        options={[
                          { id: "above", label: "At least" },
                          ...(!isCounter
                            ? [{ id: "below", label: "At most" }]
                            : []),
                        ]}
                        onChange={(operator) =>
                          condition({
                            operator: operator as "above" | "below",
                            recoveryThreshold: draft.condition.threshold,
                          })
                        }
                      />
                      <ScoutNumber
                        label={`Threshold${definition.unit ? ` (${definition.unit})` : ""}`}
                        value={draft.condition.threshold / definition.factor}
                        onChange={(value) =>
                          condition({ threshold: value * definition.factor })
                        }
                        step={isCounter ? 1 : 0.01}
                      />
                    </div>
                  )}
                  {fieldErrors["condition.threshold"] ? (
                    <p className="text-sm text-danger">
                      {fieldErrors["condition.threshold"]}
                    </p>
                  ) : null}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <ScoutNumber
                      label="Must last (minutes)"
                      min={0}
                      max={60}
                      step={0.5}
                      value={draft.condition.durationSeconds / 60}
                      onChange={(value) =>
                        condition({ durationSeconds: value * 60 })
                      }
                      description="Zero alerts on the next qualifying measurement."
                    />
                    {draft.condition.metric === "restarts" ? (
                      <ScoutNumber
                        label="Count within (minutes)"
                        value={draft.condition.windowSeconds / 60}
                        min={1}
                        max={60}
                        onChange={(value) =>
                          condition({ windowSeconds: value * 60 })
                        }
                      />
                    ) : !isCounter ? (
                      <ScoutSelect
                        label="Use readings"
                        value={draft.condition.aggregation}
                        options={[
                          { id: "average", label: "Average" },
                          { id: "peak", label: "Peak" },
                        ]}
                        onChange={(aggregation) =>
                          condition({
                            aggregation: aggregation as "average" | "peak",
                          })
                        }
                      />
                    ) : null}
                  </div>
                </fieldset>
                <details
                  open={advancedOpen}
                  onToggle={(event) =>
                    setAdvancedOpen(event.currentTarget.open)
                  }
                  className="rounded-xl bg-default p-4"
                >
                  <summary className="cursor-pointer font-medium">
                    Recovery and reminders
                  </summary>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    {!draft.condition.http ? (
                      <ScoutNumber
                        label={`Recover at${definition.unit ? ` (${definition.unit})` : ""}`}
                        value={
                          draft.condition.recoveryThreshold / definition.factor
                        }
                        step={0.01}
                        onChange={(value) =>
                          condition({
                            recoveryThreshold: value * definition.factor,
                          })
                        }
                      />
                    ) : null}
                    <ScoutNumber
                      label="Recovery must last (minutes)"
                      value={draft.condition.recoverySeconds / 60}
                      min={0}
                      max={60}
                      step={0.5}
                      onChange={(value) =>
                        condition({ recoverySeconds: value * 60 })
                      }
                    />
                    {fieldErrors["condition.recoveryThreshold"] ? (
                      <p className="text-sm text-danger sm:col-span-2">
                        {fieldErrors["condition.recoveryThreshold"]}
                      </p>
                    ) : null}
                    <ScoutSelect
                      label="Repeat while active"
                      value={
                        customRepeat ? "custom" : String(draft.repeatSeconds)
                      }
                      options={[
                        { id: "0", label: "Do not repeat" },
                        { id: "900", label: "Every 15 minutes" },
                        { id: "3600", label: "Every hour" },
                        { id: "21600", label: "Every 6 hours" },
                        { id: "86400", label: "Every day" },
                        { id: "custom", label: "Custom interval" },
                      ]}
                      onChange={(value) => {
                        setCustomRepeat(value === "custom");
                        setDraft({
                          ...draft,
                          repeatSeconds:
                            value === "custom" ? 1800 : Number(value),
                        });
                      }}
                    />
                    {customRepeat ? (
                      <ScoutNumber
                        label="Repeat every (minutes)"
                        min={15}
                        max={1440}
                        step={1}
                        value={draft.repeatSeconds / 60}
                        onChange={(value) =>
                          setDraft({ ...draft, repeatSeconds: value * 60 })
                        }
                      />
                    ) : null}
                  </div>
                </details>
                <fieldset className="grid gap-3">
                  <legend className="mb-3 font-medium">Notify</legend>
                  {destinations.length ? (
                    destinations.map((destination) => (
                      <Checkbox
                        key={destination.id}
                        isSelected={draft.destinationIds.includes(
                          destination.id,
                        )}
                        isDisabled={
                          !destination.enabled ||
                          !destination.categories.includes("scout") ||
                          !data.providers[destination.provider]
                        }
                        onChange={(selected) =>
                          setDraft({
                            ...draft,
                            destinationIds: selected
                              ? [...draft.destinationIds, destination.id]
                              : draft.destinationIds.filter(
                                  (id) => id !== destination.id,
                                ),
                          })
                        }
                      >
                        <Checkbox.Content>
                          <Checkbox.Control>
                            <Checkbox.Indicator />
                          </Checkbox.Control>
                          <Label>
                            {destination.provider === "slack"
                              ? `Slack · ${"channelId" in destination.config ? destination.config.channelId : ""}`
                              : `Email · ${"recipients" in destination.config ? destination.config.recipients.join(", ") : ""}`}
                            {!destination.enabled ||
                            !destination.categories.includes("scout") ||
                            !data.providers[destination.provider]
                              ? " (disabled for Scout)"
                              : ""}
                          </Label>
                        </Checkbox.Content>
                      </Checkbox>
                    ))
                  ) : (
                    <p className="text-sm text-muted">
                      No destinations yet. You can save this rule for in-app
                      alerts, then add a destination in Notifications.
                    </p>
                  )}
                  <Checkbox
                    isSelected={draft.notifyRecovery}
                    onChange={(notifyRecovery) =>
                      setDraft({ ...draft, notifyRecovery })
                    }
                  >
                    <Checkbox.Content>
                      <Checkbox.Control>
                        <Checkbox.Indicator />
                      </Checkbox.Control>
                      <Label>Send a recovery notification</Label>
                    </Checkbox.Content>
                  </Checkbox>
                  <Checkbox
                    isSelected={draft.enabled}
                    onChange={(enabled) => setDraft({ ...draft, enabled })}
                  >
                    <Checkbox.Content>
                      <Checkbox.Control>
                        <Checkbox.Indicator />
                      </Checkbox.Control>
                      <Label>Enable this rule</Label>
                    </Checkbox.Content>
                  </Checkbox>
                </fieldset>
                <p className="text-sm text-muted">
                  {conditionDescription(draft.condition)}
                </p>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    isDisabled={saving}
                    onPress={onClose}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" isDisabled={saving}>
                    {saving
                      ? "Saving…"
                      : initial
                        ? "Save changes"
                        : "Create rule"}
                  </Button>
                </div>
              </form>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
