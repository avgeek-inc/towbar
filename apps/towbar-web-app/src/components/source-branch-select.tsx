import { GitBranchIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { ListBox } from "@workspace/web-design-system/collections/list-box";
import { Select } from "@workspace/web-design-system/forms/select";

export function SourceBranchSelect({
  ariaLabel,
  branches,
  disabled = false,
  required = false,
  value,
  onChange,
}: {
  ariaLabel: string;
  branches: string[];
  disabled?: boolean;
  required?: boolean;
  value: string;
  onChange: (branch: string) => void;
}) {
  const options = value ? [...new Set([value, ...branches])] : branches;

  return (
    <Select
      aria-label={ariaLabel}
      fullWidth
      isDisabled={disabled}
      isRequired={required}
      selectedKey={value || null}
      variant="secondary"
      onSelectionChange={(key) => onChange(key === null ? "" : String(key))}
    >
      <Select.Trigger>
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
      <Select.Popover>
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
      </Select.Popover>
    </Select>
  );
}
