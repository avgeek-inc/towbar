"use client";
import {
  dateFormatOptions,
  timeFormatOptions,
} from "@avgeek-oss/design-system/utilities/date-time-preferences";
import { useEffect, useState } from "react";
import type { LocalizedTimestamp } from "@workspace/towbar-web-client";
import { PreferencesSettings } from "@avgeek-oss/design-system";
import type {
  DateTimePreferences,
  DateTimePreferenceOptions,
} from "@avgeek-oss/design-system/patterns/settings/date-time-preference-fields";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
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
  const data = query.data;
  return (
    <div className="content-grid min-w-0 lg:grid-cols-2 lg:items-start">
      <PreferencesSettings
        key={JSON.stringify(data.preferences)}
        value={data.preferences}
        options={{
          ...data.options,
          dateFormats: dateFormatOptions,
          timeFormats: timeFormatOptions,
        }}
        formatPreview={(preferences) => (
          <PreferencePreview value={preferences} initial={data.preview} />
        )}
        onSave={async (preferences) => {
          await api.put("/v1/core/profile/preferences", preferences);
          clearApiQueryCache();
          window.dispatchEvent(new Event("towbar:preferences-changed"));
          try {
            localStorage.setItem(
              "towbar:preferences-revision",
              crypto.randomUUID(),
            );
          } catch {
            /* Storage can be unavailable in private browsing. */
          }
        }}
      />
    </div>
  );
}
function PreferencePreview({
  value,
  initial,
}: {
  value: DateTimePreferences;
  initial: Preview;
}) {
  const [preview, setPreview] = useState(initial);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      void api
        .post<{ preview: Preview }>(
          "/v1/core/profile/preferences/preview",
          value,
        )
        .then((result) => {
          if (active) {
            setPreview(result.preview);
            setError(undefined);
          }
        })
        .catch((cause: unknown) => {
          if (active)
            setError(
              cause instanceof Error ? cause.message : "Could not load preview",
            );
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [value]);
  return (
    <>
      {preview.display.dateTime}
      {error && (
        <span role="alert" className="block text-danger-soft-foreground">
          {error}
        </span>
      )}
    </>
  );
}
