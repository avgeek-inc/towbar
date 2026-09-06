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
} from "./scout-controls";

export function ScoutRuleEditor({
  serverId,
  initial,
  deployableId,
  onClose,
  onSaved,
}: {
  serverId: string;
  initial?: ScoutRule;
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
            deployableId: deployableId ?? null,
            environment: initial.environment,
            condition: initial.condition,
            notifyRecovery: initial.notifyRecovery,
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
  const definition = metricDefinition(draft.condition.metric);
  const condition = (values: Partial<ScoutAlertRuleInput["condition"]>) => {
    setPresetId("custom");
    setDraft((old) => ({ ...old, condition: { ...old.condition, ...values } }));
  };
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
                <div>
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
                <fieldset className="grid gap-3">
                  <legend className="mb-3 font-medium">Notifications</legend>
                  <p className="text-sm text-muted">
                    Alerts are sent once to all notification destinations. An
                    alert recovers when its condition clears.
                  </p>
                  <Checkbox
                    variant="secondary"
                    isSelected={draft.notifyRecovery}
                    onChange={(notifyRecovery) =>
                      setDraft({ ...draft, notifyRecovery })
                    }
                  >
                    <Checkbox.Content>
                      <Checkbox.Control className="border border-muted">
                        <Checkbox.Indicator />
                      </Checkbox.Control>
                      <Label>Send a recovery notification</Label>
                    </Checkbox.Content>
                  </Checkbox>
                  <Checkbox
                    variant="secondary"
                    isSelected={draft.enabled}
                    onChange={(enabled) => setDraft({ ...draft, enabled })}
                  >
                    <Checkbox.Content>
                      <Checkbox.Control className="border border-muted">
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
