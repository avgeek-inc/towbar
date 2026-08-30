"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import type { AutoDeployControlResponse } from "@workspace/towbar-web-client";
import { Button } from "@workspace/web-design-system/buttons/button";
import { Label } from "@workspace/web-design-system/forms/label";
import { Switch } from "@workspace/web-design-system/forms/switch";
import { Card } from "@workspace/web-design-system/layout/card";
import { toast } from "@workspace/web-design-system/overlays/toast";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";

import { useApiQuery } from "@/hooks/use-api-query";
import { api } from "@/lib/api";

type TargetType = "app" | "resource" | "source";

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
  const [paused, setPaused] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (query.data) setPaused(query.data.autoDeploy.paused);
  }, [query.data]);

  if (query.error) return <QueryError message={query.error} />;
  if (!query.data) return <QueryLoading />;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      await api.patch<AutoDeployControlResponse>(endpoint, { paused });
      toast.success(
        paused
          ? "Automatic deployments paused"
          : "Automatic deployments resumed",
      );
      query.refresh();
      onChanged?.();
    } catch (error) {
      toast.danger(
        error instanceof Error
          ? error.message
          : "Could not update automatic deployments",
      );
    } finally {
      setSaving(false);
    }
  }

  const inheritedPause =
    type !== "source" &&
    !paused &&
    query.data.autoDeploy.effective.paused &&
    query.data.autoDeploy.effective.scope === "source";

  return (
    <form onSubmit={save}>
      <Card>
        <Card.Content className="grid gap-5">
          <Switch
            isDisabled={!query.data.canManageAutoDeploy}
            isSelected={paused}
            onChange={setPaused}
          >
            <Switch.Content className="min-h-11">
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
              <span className="grid gap-1">
                <Label>Pause automatic deployments</Label>
                <span className="text-sm text-muted">
                  {inheritedPause
                    ? "Automatic deployments are currently paused for the entire Source."
                    : "Running and queued deployments continue, and manual deployments remain available."}
                </span>
              </span>
            </Switch.Content>
          </Switch>
          <Button
            className="w-fit"
            isDisabled={
              saving ||
              !query.data.canManageAutoDeploy ||
              paused === query.data.autoDeploy.paused
            }
            type="submit"
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </Card.Content>
      </Card>
    </form>
  );
}

function controlEndpoint(type: TargetType, id: string) {
  if (type === "source") return `/v1/core/sources/${id}/auto-deploy-control`;
  return `/v1/core/${type === "app" ? "apps" : "resources"}/${id}/auto-deploy-control`;
}
