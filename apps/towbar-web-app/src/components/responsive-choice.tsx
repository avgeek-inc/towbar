"use client";
import { HugeiconsIcon } from "@hugeicons/react";
import { PackageIcon } from "@hugeicons/core-free-icons";
import { Select, ListBox } from "@workspace/web-design-system/forms/select";
import { Label } from "@workspace/web-design-system/forms/label";
import { Tabs } from "@workspace/web-design-system/navigation/tabs";
export function ResponsiveChoice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string; icon: typeof PackageIcon }>;
  onChange: (value: string) => void;
}) {
  const selected = options.find((option) => option.value === value);
  return (
    <>
      <Select
        className="md:hidden"
        fullWidth
        variant="secondary"
        selectedKey={value}
        onSelectionChange={(key) => {
          if (key !== null) onChange(String(key));
        }}
      >
        <Label className="sr-only">{label}</Label>
        <Select.Trigger>
          <Select.Value>
            <span className="inline-flex min-w-0 items-center gap-2">
              <HugeiconsIcon
                aria-hidden="true"
                icon={selected?.icon ?? PackageIcon}
                className="size-4 shrink-0"
              />
              <span className="truncate">{selected?.label}</span>
            </span>
          </Select.Value>
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            {options.map((option) => (
              <ListBox.Item
                key={option.value}
                id={option.value}
                textValue={option.label}
              >
                <span className="inline-flex items-center gap-2">
                  <HugeiconsIcon
                    aria-hidden="true"
                    icon={option.icon}
                    className="size-4 shrink-0"
                  />
                  {option.label}
                </span>
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>
      <Tabs
        className="hidden min-w-0 md:block"
        selectedKey={value}
        onSelectionChange={(key) => {
          if (key !== null) onChange(String(key));
        }}
      >
        <Tabs.ListContainer className="w-fit max-w-full overflow-x-auto">
          <Tabs.List aria-label={label} className="min-w-max">
            {options.map((option) => (
              <Tabs.Tab
                key={option.value}
                id={option.value}
                className="w-auto shrink-0 gap-2 whitespace-nowrap"
              >
                <HugeiconsIcon
                  aria-hidden="true"
                  icon={option.icon}
                  className="size-4 shrink-0"
                />
                {option.label}
                <Tabs.Indicator />
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs.ListContainer>
      </Tabs>
    </>
  );
}
