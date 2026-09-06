"use client";
import { useId } from "react";
import type { ScoutAlertCondition } from "@workspace/towbar-web-client";
import {
  Field,
  FieldLabel,
  FieldDescription,
} from "@workspace/web-design-system/forms/field";
import { Input } from "@workspace/web-design-system/forms/input";
import { ScoutNumber, ScoutSelect } from "./scout-controls";

export function ScoutHttpEditor({
  value,
  onChange,
}: {
  value: NonNullable<ScoutAlertCondition["http"]>;
  onChange: (value: NonNullable<ScoutAlertCondition["http"]>) => void;
}) {
  const id = useId();
  return (
    <div className="grid gap-4">
      <Field>
        <FieldLabel htmlFor={id}>Public URL</FieldLabel>
        <Input
          id={id}
          type="url"
          required
          maxLength={2048}
          placeholder="https://example.com/health"
          value={value.url}
          onChange={(event) =>
            onChange({ ...value, url: event.currentTarget.value })
          }
          variant="secondary"
        />
        <FieldDescription>
          Checked from your Towbar control plane. Use a public endpoint that is
          safe to request repeatedly.
        </FieldDescription>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <ScoutSelect
          label="Request method"
          value={value.method}
          onChange={(method) =>
            onChange({ ...value, method: method as "GET" | "HEAD" })
          }
          options={[
            { id: "GET", label: "GET" },
            { id: "HEAD", label: "HEAD" },
          ]}
        />
        <ScoutNumber
          label="Check every (seconds)"
          value={value.intervalSeconds}
          min={30}
          max={300}
          step={30}
          onChange={(intervalSeconds) =>
            onChange({ ...value, intervalSeconds })
          }
        />
        <ScoutNumber
          label="Timeout (seconds)"
          value={value.timeoutSeconds}
          min={1}
          max={10}
          onChange={(timeoutSeconds) => onChange({ ...value, timeoutSeconds })}
        />
        <ScoutNumber
          label="Maximum redirects"
          value={value.maxRedirects}
          min={0}
          max={3}
          onChange={(maxRedirects) => onChange({ ...value, maxRedirects })}
        />
        <ScoutNumber
          label="Healthy status from"
          value={value.expectedStatusMin}
          min={100}
          max={599}
          onChange={(expectedStatusMin) =>
            onChange({ ...value, expectedStatusMin })
          }
        />
        <ScoutNumber
          label="Healthy status through"
          value={value.expectedStatusMax}
          min={100}
          max={599}
          onChange={(expectedStatusMax) =>
            onChange({ ...value, expectedStatusMax })
          }
        />
      </div>
      <p className="text-sm text-muted">
        An unexpected status, timeout, connection failure, or invalid TLS
        certificate counts as unavailable. Responses and cookies are not stored.
      </p>
    </div>
  );
}
