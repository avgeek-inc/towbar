import { GitBranchIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { ListBox } from "@workspace/web-design-system/collections/list-box";
import { Select } from "@workspace/web-design-system/forms/select";
import {
  Autocomplete,
  SearchField,
} from "@workspace/web-design-system/pickers/autocomplete";

export function SourceBranchSelect({
  ariaLabel,
  branches,
  disabled = false,
  required = false,
  triggerId,
  value,
  onChange,
}: {
  ariaLabel: string;
  branches: string[];
  disabled?: boolean;
  required?: boolean;
  triggerId?: string;
  value: string;
  onChange: (branch: string) => void;
}) {
  const options = value ? [...new Set([value, ...branches])] : branches;

  return (
    <Select
      aria-label={ariaLabel}
      aria-required={required}
      fullWidth
      isDisabled={disabled}
      selectedKey={value || null}
      variant="secondary"
      onSelectionChange={(key) => onChange(key === null ? "" : String(key))}
    >
      <Select.Trigger id={triggerId}>
        <Select.Value className="flex min-w-0 flex-1 items-center overflow-hidden">
          <span className="flex min-w-0 items-center gap-2">
            <HugeiconsIcon
              icon={GitBranchIcon}
              aria-hidden="true"
              className="size-4 shrink-0 text-muted"
            />
            <span className="truncate">{value || "Choose a branch"}</span>
          </span>
        </Select.Value>
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover className="w-(--trigger-width) min-w-[min(18rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] overflow-hidden">
        <Autocomplete.Filter
          filter={(text, search) =>
            text.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
          }
        >
          <SearchField
            aria-label="Search branches"
            className="px-2 pt-2"
            variant="secondary"
          >
            <SearchField.Group className="rounded">
              <SearchField.SearchIcon />
              <SearchField.Input
                className="text-base sm:text-sm"
                placeholder="Search branches…"
                maxLength={255}
                autoComplete="off"
                spellCheck={false}
                autoFocus={
                  typeof window !== "undefined" &&
                  window.matchMedia("(pointer: fine)").matches
                }
              />
              <SearchField.ClearButton aria-label="Clear branch search" />
            </SearchField.Group>
          </SearchField>
          <ListBox>
            {options.map((branch) => (
              <ListBox.Item id={branch} key={branch} textValue={branch}>
                <HugeiconsIcon
                  icon={GitBranchIcon}
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted"
                />
                <span className="min-w-0 flex-1 truncate">{branch}</span>
                <ListBox.ItemIndicator />
              </ListBox.Item>
            ))}
          </ListBox>
        </Autocomplete.Filter>
      </Select.Popover>
    </Select>
  );
}
