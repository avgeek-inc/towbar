"use client";

import type { DateTimePreferences } from "@workspace/towbar-web-client";
import { Label } from "@workspace/web-design-system/forms/label";
import { Select, ListBox } from "@workspace/web-design-system/forms/select";
import {
  Autocomplete,
  SearchField,
} from "@workspace/web-design-system/pickers/autocomplete";

export type DateTimePreferenceOptions = {
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

export function browserDateTimePreferences(
  options: DateTimePreferenceOptions,
): DateTimePreferences {
  const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return {
    dateFormat: options.dateFormats[0]?.id ?? "day-short-month-year",
    timeFormat: options.timeFormats[0]?.id ?? "24-hour",
    timeZone: options.timeZones.includes(browserTimeZone)
      ? browserTimeZone
      : "UTC",
  };
}

export function DateTimePreferenceFields({
  disabled,
  onChange,
  options,
  preferences,
  variant = "primary",
}: {
  disabled?: boolean;
  onChange: (preferences: DateTimePreferences) => void;
  options: DateTimePreferenceOptions;
  preferences: DateTimePreferences;
  variant?: "primary" | "secondary";
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          variant={variant}
          fullWidth
          isRequired
          isDisabled={disabled}
          selectedKey={preferences.dateFormat}
          onSelectionChange={(key) => {
            const option = options.dateFormats.find((item) => item.id === key);
            if (option) onChange({ ...preferences, dateFormat: option.id });
          }}
        >
          <Label isRequired>Date format</Label>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {options.dateFormats.map((option) => (
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
          variant={variant}
          fullWidth
          isRequired
          isDisabled={disabled}
          selectedKey={preferences.timeFormat}
          onSelectionChange={(key) => {
            const option = options.timeFormats.find((item) => item.id === key);
            if (option) onChange({ ...preferences, timeFormat: option.id });
          }}
        >
          <Label isRequired>Time format</Label>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {options.timeFormats.map((option) => (
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
        variant={variant}
        fullWidth
        isRequired
        isDisabled={disabled}
        selectedKey={preferences.timeZone}
        onSelectionChange={(key) => {
          if (typeof key === "string" && options.timeZones.includes(key))
            onChange({ ...preferences, timeZone: key });
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
              {options.timeZones.map((zone) => (
                <ListBox.Item id={zone} key={zone} textValue={zone}>
                  {zone}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Autocomplete.Filter>
        </Select.Popover>
      </Select>
    </>
  );
}
