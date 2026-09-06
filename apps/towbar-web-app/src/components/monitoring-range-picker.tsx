"use client";
import { useId, useState } from "react";
import { Button } from "@workspace/web-design-system/buttons/button";
import { Input } from "@workspace/web-design-system/forms/input";
import { Field, FieldLabel } from "@workspace/web-design-system/forms/field";
import { Modal } from "@workspace/web-design-system/overlays/modal";
import { ScoutIcon } from "./scout-icons";
import {
  localDateTime,
  parseCustomRange,
  type CustomMonitoringRange,
} from "./monitoring-range";

export function MonitoringRangePicker({
  initial,
  retentionDays,
  onApply,
  onClose,
}: {
  initial: CustomMonitoringRange;
  retentionDays: number;
  onApply: (range: CustomMonitoringRange) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [now] = useState(() => Date.now());
  const [start, setStart] = useState(() =>
    localDateTime(
      Math.max(
        Date.parse(initial.startAt),
        now - retentionDays * 86400000 + 30000,
      ),
    ),
  );
  const [end, setEnd] = useState(() =>
    localDateTime(Math.min(Date.parse(initial.endAt), Date.now())),
  );
  const [error, setError] = useState<string>();
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal.Backdrop>
        <Modal.Container size="md">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>Custom time range</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <form
                className="grid gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  try {
                    onApply(parseCustomRange(start, end, retentionDays));
                    onClose();
                  } catch (cause) {
                    setError(
                      cause instanceof Error
                        ? cause.message
                        : "Invalid time range",
                    );
                  }
                }}
              >
                <p className="text-sm text-muted">
                  Time zone: {zone}. History is retained for {retentionDays}{" "}
                  days.
                </p>
                <div className="grid gap-4">
                  <Field>
                    <FieldLabel htmlFor={`${id}-start`}>
                      Start date and time
                    </FieldLabel>
                    <Input
                      id={`${id}-start`}
                      type="datetime-local"
                      step={1}
                      variant="secondary"
                      required
                      value={start}
                      onChange={(e) => setStart(e.currentTarget.value)}
                      min={localDateTime(now - retentionDays * 86400000)}
                      max={localDateTime(now)}
                      aria-describedby={error ? `${id}-error` : undefined}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`${id}-end`}>
                      End date and time
                    </FieldLabel>
                    <Input
                      id={`${id}-end`}
                      type="datetime-local"
                      step={1}
                      variant="secondary"
                      required
                      value={end}
                      onChange={(e) => setEnd(e.currentTarget.value)}
                      min={localDateTime(now - retentionDays * 86400000)}
                      max={localDateTime(now)}
                      aria-describedby={error ? `${id}-error` : undefined}
                    />
                  </Field>
                </div>
                {error ? (
                  <p
                    id={`${id}-error`}
                    role="alert"
                    className="text-sm text-danger"
                  >
                    {error}
                  </p>
                ) : null}
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="secondary" onPress={onClose}>
                    Cancel
                  </Button>
                  <Button type="submit">
                    <ScoutIcon name="date" />
                    Apply range
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
