"use client";

import { FieldDescription } from "@workspace/web-design-system/forms/field";
import { useEffect, useState, type FormEvent } from "react";
import { Clock01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type {
  DateTimePreferences,
  LocalizedTimestamp,
} from "@workspace/towbar-web-client";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { Button } from "@workspace/web-design-system/buttons/button";
import { toast } from "@workspace/web-design-system/overlays/toast";
import { FormCard } from "./page-parts";
import {
  DateTimePreferenceFields,
  type DateTimePreferenceOptions,
} from "./date-time-preference-fields";
import { useApiQuery, clearApiQueryCache } from "@/hooks/use-api-query";
import { api } from "@/lib/api";

type Preview = { instant: string; display: LocalizedTimestamp };
type PreferencesResponse = {
  preferences: DateTimePreferences;
  preview: Preview;
  options: DateTimePreferenceOptions;
};

export function DateTimePreferencesSettings() {
  const query = useApiQuery<PreferencesResponse>(
    "/v1/core/profile/preferences",
  );
  if (query.error) return <QueryError message={query.error} />;
  if (!query.data) return <QueryLoading />;
  return (
    <div className="content-grid min-w-0 lg:grid-cols-2 lg:items-start">
      <FormCard
        title="Date and time"
        icon={<HugeiconsIcon icon={Clock01Icon} />}
      >
        <PreferencesForm
          key={JSON.stringify(query.data.preferences)}
          data={query.data}
        />
      </FormCard>
    </div>
  );
}

function PreferencesForm({ data }: { data: PreferencesResponse }) {
  const [preferences, setPreferences] = useState(data.preferences);
  const [preview, setPreview] = useState(data.preview);
  const [previewPending, setPreviewPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const dirty =
    JSON.stringify(preferences) !== JSON.stringify(data.preferences);
  useEffect(() => {
    let active = true;
    setPreviewPending(true);
    const timer = setTimeout(() => {
      void api
        .post<{ preview: Preview }>(
          "/v1/core/profile/preferences/preview",
          preferences,
        )
        .then((result) => {
          if (active) {
            setPreview(result.preview);
            setPreviewPending(false);
            setError(undefined);
          }
        })
        .catch((cause: unknown) => {
          if (active) {
            setPreviewPending(false);
            setError(
              cause instanceof Error ? cause.message : "Could not load preview",
            );
          }
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [preferences]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api.put("/v1/core/profile/preferences", preferences);
      clearApiQueryCache();
      // Other tabs reload their server-rendered labels after this save.
      try {
        localStorage.setItem(
          "towbar:preferences-revision",
          crypto.randomUUID(),
        );
      } catch {
        /* Storage can be unavailable in private browsing. */
      }
      toast.success("Preferences updated");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save preferences",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="grid gap-5" onSubmit={save}>
      <DateTimePreferenceFields
        disabled={busy}
        onChange={setPreferences}
        options={data.options}
        preferences={preferences}
        variant="secondary"
      />
      <div
        className="grid min-h-16 gap-0"
        aria-live="polite"
        aria-busy={previewPending}
      >
        <span className="text-xs text-muted">Preview</span>
        <span className="text-sm tabular-nums">{preview.display.dateTime}</span>
        <span className="text-xs text-muted">
          {preview.display.timeZone}
          {preview.display.timeZone === preview.display.zoneLabel
            ? ""
            : ` (${preview.display.zoneLabel})`}
        </span>
      </div>
      <FieldDescription>
        Applies to dates and times throughout Towbar and your personal API keys.
      </FieldDescription>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button
        className="w-fit min-w-24"
        type="submit"
        isDisabled={!dirty || busy}
        isPending={busy}
      >
        Save
      </Button>
    </form>
  );
}
