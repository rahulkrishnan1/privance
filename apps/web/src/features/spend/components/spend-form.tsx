"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  type BillingUnit,
  Decimal,
  SCALE_CENTS,
  type SpendCategory,
  type SpendGroup,
} from "@privance/core";
import { useEffect, useRef, useState } from "react";
import { Controller, type Resolver, useForm } from "react-hook-form";
import { DateField } from "@/components/DateField";
import { Button, CloseButton, Input, Select } from "@/components/index";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select as SelectControl } from "@/components/ui/select";
import { BILLING_UNIT_LABELS, CATEGORY_LABELS, GROUP_LABELS } from "../_constants";
import type { LocalSpendItem, SpendFormValues } from "../types";
import { spendFormSchema } from "../types";
import { defaultGroupForCategory } from "./_spend-math";

const UNIT_ORDER: BillingUnit[] = ["day", "week", "month", "year"];
const GROUP_ORDER: SpendGroup[] = ["essentials", "subscriptions"];

type SpendFormProps = {
  open: boolean;
  onClose: () => void;
  item?: LocalSpendItem;
  submitting: boolean;
  onSave: (values: SpendFormValues) => Promise<void>;
  onDelete?: () => Promise<void>;
  deleting?: boolean;
};

const EMPTY_FORM: SpendFormValues = {
  name: "",
  amount: "",
  intervalCount: "1",
  intervalUnit: "",
  category: "",
  group: "essentials",
  nextRenewalAt: "",
  status: "active",
};

// Convert a stored cents string to the display dollar string (e.g. "1549" ->
// "15.49") via Decimal, the house money-conversion path.
function centsToDisplay(amountCents: string): string {
  return Decimal.fromMinorUnits(BigInt(amountCents), SCALE_CENTS).toString();
}

export function SpendForm({
  open,
  onClose,
  item,
  submitting,
  onSave,
  onDelete,
  deleting,
}: SpendFormProps) {
  const isEdit = item !== undefined;
  const formId = "spend-form";

  const [removeArmed, setRemoveArmed] = useState(false);
  const disarmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    control,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm<SpendFormValues>({
    resolver: zodResolver(spendFormSchema) as Resolver<SpendFormValues>,
    mode: "onBlur",
    defaultValues: EMPTY_FORM,
  });

  useEffect(() => {
    if (open) {
      reset(
        item !== undefined
          ? {
              name: item.name,
              amount: centsToDisplay(item.amountCents),
              intervalCount: String(item.intervalCount),
              intervalUnit: item.intervalUnit,
              category: item.category,
              group: item.group,
              nextRenewalAt: item.nextRenewalAt ?? "",
              status: item.status,
            }
          : EMPTY_FORM,
      );
      setRemoveArmed(false);
    }
    return () => {
      if (disarmTimer.current !== null) clearTimeout(disarmTimer.current);
    };
  }, [open, item, reset]);

  function handleRemoveClick() {
    if (!isEdit || onDelete === undefined) return;
    if (removeArmed) {
      if (disarmTimer.current !== null) clearTimeout(disarmTimer.current);
      setRemoveArmed(false);
      void onDelete();
      return;
    }
    setRemoveArmed(true);
    disarmTimer.current = setTimeout(() => {
      setRemoveArmed(false);
    }, 3500);
  }

  const onSubmit = handleSubmit(async (values: SpendFormValues) => {
    await onSave(values);
  });

  const titleId = `${formId}-title`;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent aria-labelledby={titleId}>
        <div className="flex justify-between items-center mb-[18px]">
          <DialogTitle asChild>
            <h3 id={titleId} className="font-serif text-2xl tracking-[-0.01em]">
              {isEdit ? `Edit ${item.name}` : "Add expense"}
            </h3>
          </DialogTitle>
          <CloseButton onClick={onClose} />
        </div>

        <form
          id={formId}
          onSubmit={(e) => {
            e.preventDefault();
            void onSubmit();
          }}
          noValidate
        >
          <div className="mt-4">
            <label
              htmlFor={`${formId}-amount`}
              className="block font-mono text-xs tracking-label uppercase text-dim mb-2"
            >
              Amount
            </label>
            <Controller
              control={control}
              name="amount"
              render={({ field }) => (
                <input
                  id={`${formId}-amount`}
                  {...field}
                  type="text"
                  inputMode="decimal"
                  placeholder="$0"
                  aria-label="Amount"
                  aria-invalid={errors.amount !== undefined}
                  aria-describedby={errors.amount ? `${formId}-amount-error` : undefined}
                  className="w-full bg-panel-2 border border-line rounded-[8px] text-cream font-serif text-5xl text-center tracking-[-0.01em] py-[18px] px-[14px] outline-none focus:border-accent/60 transition-colors placeholder:text-faint"
                />
              )}
            />
            {errors.amount && (
              <p id={`${formId}-amount-error`} role="alert" className="text-sm text-signal mt-1.5">
                {errors.amount.message}
              </p>
            )}
          </div>

          <div className="mt-4">
            <span className="block font-mono text-xs tracking-label uppercase text-dim mb-2">
              Bills every
            </span>
            <div className="flex gap-2">
              <Controller
                control={control}
                name="intervalCount"
                render={({ field }) => (
                  <input
                    {...field}
                    type="text"
                    inputMode="numeric"
                    aria-label="Interval count"
                    className="w-[78px] bg-panel-2 border border-line rounded-[8px] text-cream font-mono text-base text-center py-[13px] px-[10px] outline-none focus:border-accent/60 transition-colors"
                  />
                )}
              />
              <Controller
                control={control}
                name="intervalUnit"
                render={({ field }) => (
                  <SelectControl
                    {...field}
                    aria-label="Interval unit"
                    invalid={errors.intervalUnit !== undefined}
                    className="flex-1"
                  >
                    <option value="" disabled>
                      Select a cadence
                    </option>
                    {UNIT_ORDER.map((unit) => (
                      <option key={unit} value={unit}>
                        {BILLING_UNIT_LABELS[unit]}
                      </option>
                    ))}
                  </SelectControl>
                )}
              />
            </div>
            {(errors.intervalCount || errors.intervalUnit) && (
              <p role="alert" className="text-sm text-signal mt-1.5">
                {errors.intervalCount?.message ?? errors.intervalUnit?.message}
              </p>
            )}
          </div>

          <div className="mt-4">
            <Controller
              control={control}
              name="name"
              render={({ field }) => (
                <Input
                  {...field}
                  label="Name"
                  error={errors.name?.message}
                  type="text"
                  placeholder="Rent, Netflix, Auto insurance..."
                />
              )}
            />
          </div>

          <div className="mt-4">
            <Controller
              control={control}
              name="category"
              render={({ field }) => (
                <Select
                  {...field}
                  label="Category"
                  error={errors.category?.message}
                  onChange={(e) => {
                    const category = e.target.value as SpendCategory;
                    field.onChange(category);
                    // Suggest a panel from the category when adding; on edit the
                    // user's chosen group stands.
                    if (!isEdit) setValue("group", defaultGroupForCategory(category));
                  }}
                >
                  <option value="" disabled>
                    Select a category
                  </option>
                  {(Object.entries(CATEGORY_LABELS) as [SpendCategory, string][]).map(
                    ([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ),
                  )}
                </Select>
              )}
            />
          </div>

          <div className="mt-4">
            <span className="block font-mono text-xs tracking-label uppercase text-dim mb-2">
              Group
            </span>
            <Controller
              control={control}
              name="group"
              render={({ field }) => (
                <RadioGroup
                  value={field.value}
                  onValueChange={field.onChange}
                  aria-label="Group"
                  className="w-full bg-panel-2 border border-line rounded-[8px] p-1"
                >
                  {GROUP_ORDER.map((group) => (
                    <RadioGroupItem key={group} value={group} size="sm" className="flex-1">
                      {GROUP_LABELS[group]}
                    </RadioGroupItem>
                  ))}
                </RadioGroup>
              )}
            />
          </div>

          <div className="mt-4">
            <Label htmlFor={`${formId}-renews`} className="block mb-2">
              Next bill (optional)
            </Label>
            <Controller
              control={control}
              name="nextRenewalAt"
              render={({ field }) => (
                <DateField
                  id={`${formId}-renews`}
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                />
              )}
            />
            {errors.nextRenewalAt && (
              <p role="alert" className="text-sm text-signal mt-1">
                {errors.nextRenewalAt.message}
              </p>
            )}
          </div>

          {isEdit && (
            <div className="mt-4">
              <span className="block font-mono text-xs tracking-label uppercase text-dim mb-2">
                Status
              </span>
              <Controller
                control={control}
                name="status"
                render={({ field }) => (
                  <RadioGroup
                    value={field.value}
                    onValueChange={field.onChange}
                    aria-label="Status"
                    className="w-full bg-panel-2 border border-line rounded-[8px] p-1"
                  >
                    {(["active", "paused"] as const).map((s) => (
                      <RadioGroupItem key={s} value={s} size="sm" className="flex-1">
                        {s === "active" ? "Active" : "Paused"}
                      </RadioGroupItem>
                    ))}
                  </RadioGroup>
                )}
              />
            </div>
          )}

          <div className="flex gap-2.5 mt-[26px]">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={submitting}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form={formId}
              loading={submitting}
              disabled={submitting}
              className="flex-1"
            >
              {submitting ? "Saving..." : isEdit ? "Save changes" : "Add expense"}
            </Button>
          </div>

          {isEdit && onDelete !== undefined && (
            <Button
              type="button"
              variant={removeArmed ? "danger" : "dangerOutline"}
              onClick={handleRemoveClick}
              disabled={deleting}
              className="w-full mt-3.5"
            >
              {removeArmed
                ? "Tap again to remove this recurring expense"
                : deleting
                  ? "Removing..."
                  : "Remove"}
            </Button>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
