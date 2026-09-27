"use client";

import { useId, useState } from "react";
import { Cancel01Icon, FilterHorizontalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@workspace/web-design-system/buttons/button";
import { Input } from "@workspace/web-design-system/forms/input";
import { Modal } from "@workspace/web-design-system/overlays/modal";
import { Chip } from "@workspace/web-design-system/data-display/chip";
import { Label } from "@workspace/web-design-system/forms/label";
import { ListBox, Select } from "@workspace/web-design-system/forms/select";

export type FilterCondition<Field extends string, Operator extends string> = {
  field: Field;
  operator: Operator;
  value: string;
};
export type FilterField<Field extends string, Operator extends string> = {
  field: Field;
  label: string;
  operators: readonly { value: Operator; label: string }[];
  placeholder?: string;
  pattern?: string;
  maxLength?: number;
};

export function FilterDialog<Field extends string, Operator extends string>({
  fields,
  value,
  onChange,
  maxConditions = 8,
}: {
  fields: readonly FilterField<Field, Operator>[];
  value: FilterCondition<Field, Operator>[];
  onChange: (value: FilterCondition<Field, Operator>[]) => void;
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
        <HugeiconsIcon icon={FilterHorizontalIcon} />
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
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>Filters</Modal.Heading>
              <p className="text-sm text-muted">
                Show results matching all conditions.
              </p>
            </Modal.Header>
            <Modal.Body>
              <form
                id={formId}
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  onChange(
                    (draft ?? []).filter(
                      (condition, index, all) =>
                        all.findIndex(
                          (item) =>
                            item.field === condition.field &&
                            item.operator === condition.operator &&
                            item.value === condition.value,
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
                    <div key={index} className="flex items-end gap-2">
                      <div className="grid min-w-0 flex-1 grid-cols-2 gap-3">
                        <FilterSelect
                          label="Field"
                          value={condition.field}
                          options={fields.map((field) => ({
                            value: field.field,
                            label: field.label,
                          }))}
                          onChange={(key) => {
                            const next = fields.find(
                              (field) => field.field === key,
                            )!;
                            update(index, {
                              field: key,
                              operator: next.operators[0]!.value,
                              value: "",
                            });
                          }}
                        />
                        <FilterSelect
                          label="Match"
                          value={condition.operator}
                          options={field.operators}
                          onChange={(operator) =>
                            update(index, { ...condition, operator })
                          }
                        />
                        <label className="col-span-2 grid gap-1 text-sm">
                          Value
                          <Input
                            aria-label={`Filter value ${index + 1}`}
                            variant="secondary"
                            value={condition.value}
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
                      </div>
                      <Button
                        isIconOnly
                        variant="ghost"
                        aria-label={`Remove condition ${index + 1}`}
                        onPress={() =>
                          setDraft(draft.filter((_, i) => i !== index))
                        }
                      >
                        <HugeiconsIcon icon={Cancel01Icon} />
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
                variant="ghost"
                className="mr-auto"
                isDisabled={!value.length}
                onPress={() => {
                  onChange([]);
                  setDraft(null);
                }}
              >
                Clear filters
              </Button>
              <Button variant="secondary" onPress={() => setDraft(null)}>
                Cancel
              </Button>
              <Button
                type="submit"
                form={formId}
                isDisabled={draft?.some((item) => !item.value)}
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
  value,
  options,
  onChange,
}: {
  label: string;
  value: Value;
  options: readonly { value: Value; label: string }[];
  onChange: (value: Value) => void;
}) {
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
      <Label>{label}</Label>
      <Select.Trigger>
        <Select.Value />
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
              {option.label}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
