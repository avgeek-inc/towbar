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
import { Label } from "@workspace/web-design-system/forms/label";
import { Select, ListBox } from "@workspace/web-design-system/forms/select";
import {
  Autocomplete,
  SearchField,
} from "@workspace/web-design-system/pickers/autocomplete";
import { toast } from "@workspace/web-design-system/overlays/toast";
import { FormCard } from "./page-parts";
import { useApiQuery, clearApiQueryCache } from "@/hooks/use-api-query";
import { api } from "@/lib/api";

type Preview = { instant: string; display: LocalizedTimestamp };
type PreferencesResponse = {
  preferences: DateTimePreferences;
  preview: Preview;
  options: {
    dateFormats: Array<{
      id: DateTimePreferences["dateFormat"];
      label: string;
    }>;
    timeFormats: Array<{
      id: DateTimePreferences["timeFormat"];
      label: string;
    }>;
    timeZones: string[];
  };
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
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          variant="secondary"
          fullWidth
          isRequired
          isDisabled={busy}
          selectedKey={preferences.dateFormat}
          onSelectionChange={(key) => {
            const option = data.options.dateFormats.find(
              (item) => item.id === key,
            );
            if (option)
              setPreferences((value) => ({ ...value, dateFormat: option.id }));
          }}
        >
          <Label isRequired>Date format</Label>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {data.options.dateFormats.map((option) => (
                <ListBox.Item
                  id={option.id}
                  key={option.id}
                  textValue={option.label}
                >
                  {option.label}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
        <Select
          variant="secondary"
          fullWidth
          isRequired
          isDisabled={busy}
          selectedKey={preferences.timeFormat}
          onSelectionChange={(key) => {
            const option = data.options.timeFormats.find(
              (item) => item.id === key,
            );
            if (option)
              setPreferences((value) => ({ ...value, timeFormat: option.id }));
          }}
        >
          <Label isRequired>Time format</Label>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {data.options.timeFormats.map((option) => (
                <ListBox.Item
                  id={option.id}
                  key={option.id}
                  textValue={option.label}
                >
                  {option.label}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </div>
      <Select
        fullWidth
        isRequired
        isDisabled={busy}
        selectedKey={preferences.timeZone}
        onSelectionChange={(key) => {
          if (typeof key === "string" && data.options.timeZones.includes(key))
            setPreferences((value) => ({ ...value, timeZone: key }));
        }}
      >
        <Label isRequired>Time zone</Label>
        <Select.Trigger>
          <Select.Value>{preferences.timeZone}</Select.Value>
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover className="w-(--trigger-width) min-w-[min(18rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] overflow-hidden">
          <Autocomplete.Filter
            filter={(text, search) =>
              text
                .toLocaleLowerCase()
                .includes(search.trim().toLocaleLowerCase())
            }
          >
            <SearchField
              aria-label="Search time zones"
              className="px-2 pt-2"
              variant="secondary"
            >
              <SearchField.Group className="rounded">
                <SearchField.SearchIcon />
                <SearchField.Input
                  className="text-base sm:text-sm"
                  placeholder="Search time zones…"
                  maxLength={200}
                  autoComplete="off"
                  spellCheck={false}
                  autoFocus={
                    typeof window !== "undefined" &&
                    window.matchMedia("(pointer: fine)").matches
                  }
                />
                <SearchField.ClearButton aria-label="Clear time zone search" />
              </SearchField.Group>
            </SearchField>
            <ListBox>
              {data.options.timeZones.map((zone) => (
                <ListBox.Item id={zone} key={zone} textValue={zone}>
                  {zone}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Autocomplete.Filter>
        </Select.Popover>
      </Select>
      <div
        className="grid min-h-16 gap-1"
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
