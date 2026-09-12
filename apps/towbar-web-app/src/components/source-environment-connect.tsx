"use client";
import {
  Add01Icon,
  Cancel01Icon,
  Link01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { Button } from "@workspace/web-design-system/buttons/button";
import { Input } from "@workspace/web-design-system/forms/input";
import { Field, FieldLabel } from "@workspace/web-design-system/forms/field";
import { toast } from "@workspace/web-design-system/overlays/toast";
import { FormCard } from "./page-parts";
import { refreshApiQueries } from "@/hooks/use-api-query";
import { api } from "@/lib/api";

export function SourceEnvironmentConnect({ sourceId }: { sourceId: string }) {
  const [open, setOpen] = useState(false);
  const [environment, setEnvironment] = useState("");
  const [branch, setBranch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open)
    return (
      <div>
        <Button variant="secondary" onPress={() => setOpen(true)}>
          <HugeiconsIcon
            icon={Add01Icon}
            aria-hidden="true"
            className="size-4"
          />
          Add environment
        </Button>
      </div>
    );
  return (
    <FormCard
      title="Connect environment"
      icon={<HugeiconsIcon icon={Link01Icon} />}
    >
      <form
        className="content-grid"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api.post(`/v1/core/sources/${sourceId}/environments`, {
              environment: environment.trim(),
              branch: branch.trim(),
            });
            toast.success("Environment connected; initial sync queued");
            setOpen(false);
            setEnvironment("");
            setBranch("");
            refreshApiQueries();
          } catch (error) {
            setError(
              error instanceof Error
                ? error.message
                : "Couldn't connect environment",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="connect-environment-name">
              Environment
            </FieldLabel>
            <Input
              id="connect-environment-name"
              value={environment}
              onChange={(event) => setEnvironment(event.target.value)}
              required
              maxLength={63}
              pattern="[a-z][a-z0-9-]*"
              variant="secondary"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="connect-environment-branch">Branch</FieldLabel>
            <Input
              id="connect-environment-branch"
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
              required
              variant="secondary"
            />
          </Field>
        </div>
        <p className="text-xs text-muted">
          Use an environment declared in towbar.yml on this branch. Connecting
          validates and syncs its configuration without deploying.
        </p>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex gap-2">
          <Button type="submit" isDisabled={busy}>
            <HugeiconsIcon
              icon={Link01Icon}
              aria-hidden="true"
              className="size-4"
            />
            {busy ? "Connecting…" : "Connect environment"}
          </Button>
          <Button
            variant="secondary"
            isDisabled={busy}
            onPress={() => {
              setOpen(false);
              setError(null);
            }}
          >
            <HugeiconsIcon
              icon={Cancel01Icon}
              aria-hidden="true"
              className="size-4"
            />
            Cancel
          </Button>
        </div>
      </form>
    </FormCard>
  );
}
