"use client";

import { Add01Icon, Link01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { Button } from "@workspace/web-design-system/buttons/button";
import { Field, FieldLabel } from "@workspace/web-design-system/forms/field";
import { Input } from "@workspace/web-design-system/forms/input";
import { Modal } from "@workspace/web-design-system/overlays/modal";
import { toast } from "@workspace/web-design-system/overlays/toast";
import { refreshApiQueries } from "@/hooks/use-api-query";
import { api } from "@/lib/api";
import { SourceBranchSelect } from "./source-branch-select";

export function SourceEnvironmentConnect({
  sourceId,
  branches,
}: {
  sourceId: string;
  branches: string[];
}) {
  const [open, setOpen] = useState(false);
  const [environment, setEnvironment] = useState("");
  const [branch, setBranch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (busy) return;
    setOpen(false);
    setError(null);
  }

  return (
    <div className="flex justify-end">
      <Button variant="secondary" onPress={() => setOpen(true)}>
        <HugeiconsIcon icon={Add01Icon} aria-hidden="true" className="size-4" />
        Add environment
      </Button>
      <Modal.Backdrop isOpen={open} onOpenChange={(next) => !next && close()}>
        <Modal.Container size="md">
          <Modal.Dialog>
            <Modal.CloseTrigger isDisabled={busy} />
            <Modal.Header>
              <Modal.Heading>
                <span className="flex items-center gap-2">
                  <HugeiconsIcon
                    icon={Link01Icon}
                    aria-hidden="true"
                    className="size-5"
                  />
                  Add environment
                </span>
              </Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <form
                className="content-grid"
                onSubmit={async (event) => {
                  event.preventDefault();
                  setBusy(true);
                  setError(null);
                  try {
                    await api.post(
                      `/v1/core/sources/${sourceId}/environments`,
                      {
                        environment: environment.trim(),
                        branch: branch.trim(),
                      },
                    );
                    toast.success("Environment connected; initial sync queued");
                    setOpen(false);
                    setEnvironment("");
                    setBranch("");
                    refreshApiQueries();
                  } catch (failure) {
                    setError(
                      failure instanceof Error
                        ? failure.message
                        : "Couldn't connect environment",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Field>
                  <FieldLabel htmlFor="connect-environment-name" isRequired>
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
                  <FieldLabel isRequired>Branch</FieldLabel>
                  <SourceBranchSelect
                    ariaLabel="Branch"
                    branches={branches}
                    required
                    value={branch}
                    onChange={setBranch}
                  />
                </Field>
                {error ? (
                  <p role="alert" className="text-sm text-danger">
                    {error}
                  </p>
                ) : null}
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" isDisabled={busy} onPress={close}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    isDisabled={busy || !environment.trim() || !branch}
                  >
                    <HugeiconsIcon
                      icon={Link01Icon}
                      aria-hidden="true"
                      className="size-4"
                    />
                    {busy ? "Connecting…" : "Connect environment"}
                  </Button>
                </div>
              </form>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </div>
  );
}
