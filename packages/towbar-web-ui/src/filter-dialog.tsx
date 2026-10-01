"use client";

import { useEffect, useId, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowDown01Icon,
  Delete02Icon,
  FilterIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@workspace/web-design-system/buttons/button";
import { Input } from "@workspace/web-design-system/forms/input";
import { Modal } from "@workspace/web-design-system/overlays/modal";
import { Chip } from "@workspace/web-design-system/data-display/chip";
import { Label } from "@workspace/web-design-system/forms/label";
import { ListBox, Select } from "@workspace/web-design-system/forms/select";
import { SearchField } from "@workspace/web-design-system/pickers/autocomplete";
import { Popover } from "@workspace/web-design-system/overlays/popover";

export type FilterCondition<Field extends string, Operator extends string> = {
  field: Field;
  operator: Operator;
  value: string | string[];
};
export type FilterField<Field extends string, Operator extends string> = {
  field: Field;
  label: string;
  icon?: ReactNode;
  operators: readonly { value: Operator; label: string; icon?: ReactNode }[];
  placeholder?: string;
  pattern?: string;
  maxLength?: number;
  searchable?: boolean;
};

export function FilterDialog<Field extends string, Operator extends string>({
  fields,
  value,
  onChange,
  getOptions,
  renderOption,
  maxConditions = 8,
}: {
  fields: readonly FilterField<Field, Operator>[];
  value: FilterCondition<Field, Operator>[];
  onChange: (value: FilterCondition<Field, Operator>[]) => void;
  getOptions?: (field: Field, search: string) => Promise<string[]>;
  renderOption?: (field: Field, value: string) => ReactNode;
  maxConditions?: number;
}) {
  const formId = useId();
  const [draft, setDraft] = useState<FilterCondition<Field, Operator>[] | null>(
    null,
  );
  const newCondition = () => {
    const first = fields[0]!;
    return {
      field: first.field,
      operator: first.operators[0]!.value,
      value: "",
    };
  };
  const update = (index: number, condition: FilterCondition<Field, Operator>) =>
    setDraft(
      (current) =>
        current?.map((item, i) => (i === index ? condition : item)) ?? null,
    );
  return (
    <>
      <Button
        variant="secondary"
        onPress={() =>
          setDraft(
            value.length
              ? value.map((item) => ({ ...item }))
              : [newCondition()],
          )
        }
      >
        <HugeiconsIcon icon={FilterIcon} />
        Filters
        {value.length ? (
          <Chip size="small" aria-label={`${value.length} active filters`}>
            {value.length}
          </Chip>
        ) : null}
      </Button>
      <Modal.Backdrop
        isOpen={draft !== null}
        onOpenChange={(open) => {
          if (!open) setDraft(null);
        }}
      >
        <Modal.Container size="lg" scroll="inside">
          <Modal.Dialog className="sm:max-w-[60rem]">
            <Modal.Header className="flex-row items-center justify-between gap-3">
              <Modal.Heading className="flex items-center gap-2">
                <HugeiconsIcon
                  icon={FilterIcon}
                  className="size-4"
                  aria-hidden="true"
                />
                Filters
              </Modal.Heading>
              <Modal.CloseTrigger className="static shrink-0" />
            </Modal.Header>
            <Modal.Body className="pt-1">
              <form
                id={formId}
                className="space-y-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  onChange(
                    (draft ?? []).filter(
                      (condition, index, all) =>
                        all.findIndex(
                          (item) =>
                            item.field === condition.field &&
                            item.operator === condition.operator &&
                            JSON.stringify(item.value) ===
                              JSON.stringify(condition.value),
                        ) === index,
                    ),
                  );
                  setDraft(null);
                }}
              >
                {draft?.map((condition, index) => {
                  const field = fields.find(
                    (field) => field.field === condition.field,
                  )!;
                  return (
                    <div
                      key={index}
                      className="grid grid-cols-[minmax(0,1fr)_2rem] items-end gap-2"
                    >
                      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)]">
                        <FilterSelect
                          label="Field"
                          hideLabel={index > 0}
                          value={condition.field}
                          options={fields.map((field) => ({
                            value: field.field,
                            label: field.label,
                            icon: field.icon,
                          }))}
                          onChange={(key) => {
                            const next = fields.find(
                              (field) => field.field === key,
                            )!;
                            update(index, {
                              field: key,
                              operator: next.operators[0]!.value,
                              value: next.searchable ? [] : "",
                            });
                          }}
                        />
                        <FilterSelect
                          label="Match"
                          hideLabel={index > 0}
                          value={condition.operator}
                          options={field.operators}
                          onChange={(operator) =>
                            update(index, {
                              ...condition,
                              operator,
                              value: operator === "in" ? [] : "",
                            })
                          }
                        />
                        {field.searchable &&
                        getOptions &&
                        condition.operator === "in" ? (
                          <FilterValueSelect
                            key={field.field}
                            field={field.field}
                            label={`Value ${index + 1}`}
                            hideLabel={index > 0}
                            value={
                              Array.isArray(condition.value)
                                ? condition.value
                                : []
                            }
                            getOptions={getOptions}
                            renderOption={renderOption}
                            onChange={(value) =>
                              update(index, { ...condition, value })
                            }
                          />
                        ) : (
                          <label className="grid gap-1 text-sm">
                            <span
                              className={
                                index > 0 ? "sr-only" : "text-xs text-muted"
                              }
                            >
                              Value
                            </span>
                            <Input
                              aria-label={`Filter value ${index + 1}`}
                              variant="secondary"
                              value={
                                typeof condition.value === "string"
                                  ? condition.value
                                  : ""
                              }
                              onChange={(event) =>
                                update(index, {
                                  ...condition,
                                  value: event.currentTarget.value,
                                })
                              }
                              placeholder={field.placeholder}
                              pattern={field.pattern}
                              maxLength={field.maxLength}
                              required
                            />
                          </label>
                        )}
                      </div>
                      <Button
                        isIconOnly
                        variant="danger-ghost"
                        className="size-8 min-w-0 shrink-0 rounded-lg"
                        aria-label={`Remove condition ${index + 1}`}
                        onPress={() =>
                          setDraft(draft.filter((_, i) => i !== index))
                        }
                      >
                        <HugeiconsIcon icon={Delete02Icon} aria-hidden="true" />
                      </Button>
                    </div>
                  );
                })}
                <Button
                  variant="secondary"
                  isDisabled={(draft?.length ?? 0) >= maxConditions}
                  onPress={() => setDraft([...(draft ?? []), newCondition()])}
                >
                  Add condition
                </Button>
              </form>
            </Modal.Body>
            <Modal.Footer>
              <Button
                variant="danger"
                className="mr-auto"
                isDisabled={!value.length}
                onPress={() => {
                  onChange([]);
                  setDraft(null);
                }}
              >
                Clear all filters
              </Button>
              <Button variant="secondary" onPress={() => setDraft(null)}>
                Cancel
              </Button>
              <Button
                type="submit"
                form={formId}
                isDisabled={draft?.some(
                  (item) =>
                    !item.value ||
                    (Array.isArray(item.value) && !item.value.length),
                )}
              >
                Apply
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </>
  );
}

function FilterSelect<Value extends string>({
  label,
  hideLabel = false,
  value,
  options,
  onChange,
}: {
  label: string;
  hideLabel?: boolean;
  value: Value;
  options: readonly { value: Value; label: string; icon?: ReactNode }[];
  onChange: (value: Value) => void;
}) {
  const selected = options.find((option) => option.value === value);
  return (
    <Select
      className="min-w-0"
      aria-label={label}
      selectedKey={value}
      variant="secondary"
      onSelectionChange={(key) => {
        const selected = options.find((option) => option.value === key);
        if (selected) onChange(selected.value);
      }}
    >
      <Label
        className={hideLabel ? "sr-only" : "text-xs font-normal text-muted"}
      >
        {label}
      </Label>
      <Select.Trigger>
        <Select.Value className="flex min-w-0 flex-1 items-center gap-2">
          {selected?.icon}
          <span className="truncate">{selected?.label}</span>
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
              <span className="flex min-w-0 flex-1 items-center gap-2">
                {option.icon}
                <span className="truncate">{option.label}</span>
              </span>
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

function FilterValueSelect<Field extends string>({
  field,
  label,
  hideLabel,
  value,
  onChange,
  getOptions,
  renderOption,
}: {
  field: Field;
  label: string;
  hideLabel: boolean;
  value: string[];
  onChange: (value: string[]) => void;
  getOptions: (field: Field, search: string) => Promise<string[]>;
  renderOption?: (field: Field, value: string) => ReactNode;
}) {
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<string[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    let current = true;
    const timer = setTimeout(
      () => {
        void getOptions(field, search).then(
          (next) => {
            if (current) {
              setOptions(next);
              setError(false);
            }
          },
          () => {
            if (current) setError(true);
          },
        );
      },
      search ? 200 : 0,
    );
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [field, getOptions, search]);
  const visible = [...new Set([...value, ...options])];
  return (
    <div className="select select--secondary min-w-0">
      <span
        className={`label text-xs font-normal text-muted ${hideLabel ? "sr-only" : ""}`}
      >
        Value
      </span>
      <Popover>
        <Popover.Trigger className="select__trigger" aria-label={label}>
          <span className="select__value">
            {value.length ? `${value.length} selected` : "Choose values"}
          </span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            className="size-4 text-muted"
            aria-hidden="true"
          />
        </Popover.Trigger>
        <Popover.Content
          placement="bottom start"
          className="select__popover w-[min(22rem,calc(100vw-2rem))] overflow-hidden p-0"
        >
          <Popover.Dialog className="p-0 outline-none">
            <SearchField
              aria-label="Search values"
              className="px-2 pt-2"
              variant="secondary"
              value={search}
              onChange={setSearch}
            >
              <SearchField.Group className="rounded-md">
                <SearchField.SearchIcon />
                <SearchField.Input
                  className="text-base sm:text-sm"
                  placeholder="Search values…"
                  maxLength={100}
                  autoComplete="off"
                  spellCheck={false}
                />
                <SearchField.ClearButton aria-label="Clear value search" />
              </SearchField.Group>
            </SearchField>
            {error ? (
              <p className="px-3 py-2 text-sm text-danger">
                Couldn’t load values. Try again.
              </p>
            ) : null}
            <ListBox
              aria-label={label}
              selectionMode="multiple"
              escapeKeyBehavior="none"
              selectedKeys={value}
              onSelectionChange={(keys) => {
                if (keys === "all") return;
                const selected = [...keys].map(String);
                if (selected.length <= 20) onChange(selected);
              }}
            >
              {visible.map((item) => (
                <ListBox.Item key={item} id={item} textValue={item}>
                  {renderOption ? renderOption(field, item) : item}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Popover.Dialog>
        </Popover.Content>
      </Popover>
    </div>
  );
}
