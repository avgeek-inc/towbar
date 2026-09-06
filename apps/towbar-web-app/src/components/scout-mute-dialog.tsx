"use client";
import { useId, useState, type FormEvent } from "react";
import { Button } from "@workspace/web-design-system/buttons/button";
import { Input } from "@workspace/web-design-system/forms/input";
import { Field, FieldLabel } from "@workspace/web-design-system/forms/field";
import { Modal } from "@workspace/web-design-system/overlays/modal";
import { QueryError } from "@workspace/towbar-web-ui/query-state";
import { toast } from "@workspace/web-design-system/overlays/toast";
import { api } from "@/lib/api";
import { ScoutSelect, ScoutNumber } from "./scout-controls";

export function ScoutMuteDialog({
  endpoint,
  title,
  mutedUntil,
  onClose,
  onSaved,
}: {
  endpoint: string;
  title: string;
  mutedUntil: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [duration, setDuration] = useState("1800"),
    [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const id = useId();
  const [customMinutes, setCustomMinutes] = useState(60);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.post(endpoint, {
        durationSeconds:
          duration === "custom" ? customMinutes * 60 : Number(duration),
        reason,
      });
      onSaved();
      toast.success(
        duration === "0"
          ? "Scout notifications resumed"
          : "Scout notifications muted",
      );
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not update mute",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Modal.Backdrop>
        <Modal.Container size="md">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>{title}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <form className="grid gap-4" onSubmit={save}>
                <p className="text-sm text-muted">
                  Pause notifications during maintenance. Metrics and incidents
                  continue to be recorded.
                </p>
                {error ? <QueryError message={error} /> : null}
                <ScoutSelect
                  label="Mute duration"
                  value={duration}
                  onChange={setDuration}
                  options={[
                    ...(mutedUntil &&
                    new Date(mutedUntil).getTime() > Date.now()
                      ? [{ id: "0", label: "Resume notifications now" }]
                      : []),
                    { id: "1800", label: "30 minutes" },
                    { id: "3600", label: "1 hour" },
                    { id: "14400", label: "4 hours" },
                    { id: "86400", label: "24 hours" },
                    { id: "604800", label: "7 days" },
                    { id: "custom", label: "Custom duration" },
                  ]}
                />
                {duration === "custom" ? (
                  <ScoutNumber
                    label="Mute for (minutes)"
                    value={customMinutes}
                    onChange={setCustomMinutes}
                    min={1}
                    max={10080}
                    step={1}
                  />
                ) : null}
                <Field>
                  <FieldLabel htmlFor={id}>Reason (optional)</FieldLabel>
                  <Input
                    id={id}
                    variant="secondary"
                    value={reason}
                    onChange={(event) => setReason(event.currentTarget.value)}
                    maxLength={240}
                  />
                </Field>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    isDisabled={busy}
                    onPress={onClose}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" isDisabled={busy}>
                    {busy
                      ? "Saving…"
                      : duration === "0"
                        ? "Resume notifications"
                        : "Mute notifications"}
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
