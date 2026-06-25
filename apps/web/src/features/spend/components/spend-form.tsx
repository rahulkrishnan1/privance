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
import { StyledSelect } from "@/components/index";
import { Modal } from "@/components/Modal";
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

  const segBase =
    "flex-1 font-mono text-xs tracking-[.08em] uppercase border-0 rounded-[6px] py-[9px] px-1 cursor-pointer transition-colors";
  const segOn = "bg-vault text-accent border border-line";
  const segOff = "bg-transparent text-faint hover:text-cream";

  return (
    <Modal open={open} onClose={onClose} variant="center" labelledBy={titleId}>
      <div className="flex justify-between items-center mb-[18px]">
        <h3 id={titleId} className="font-serif text-2xl tracking-[-0.01em]">
          {isEdit ? `Edit ${item.name}` : "Add expense"}
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-faint hover:text-cream bg-transparent border-0 text-lg leading-none p-1 cursor-pointer"
        >
          &#10005;
        </button>
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
            className="block font-mono text-xs tracking-label uppercase text-faint mb-2"
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
                className="w-full bg-panel-2 border border-line rounded-[8px] text-cream font-serif text-5xl text-center tracking-[-0.01em] py-[18px] px-[14px] outline-none focus:border-accent/60 transition-colors placeholder:text-faint"
              />
            )}
          />
          {errors.amount && (
            <p role="alert" className="font-mono text-xs text-signal mt-1.5">
              {errors.amount.message}
            </p>
          )}
        </div>

        <div className="mt-4">
          <span className="block font-mono text-xs tracking-label uppercase text-faint mb-2">
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
                <StyledSelect
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
                </StyledSelect>
              )}
            />
          </div>
          {(errors.intervalCount || errors.intervalUnit) && (
            <p role="alert" className="font-mono text-xs text-signal mt-1.5">
              {errors.intervalCount?.message ?? errors.intervalUnit?.message}
            </p>
          )}
        </div>

        <div className="mt-4">
          <label
            htmlFor={`${formId}-name`}
            className="block font-mono text-xs tracking-label uppercase text-faint mb-2"
          >
            Name
          </label>
          <Controller
            control={control}
            name="name"
            render={({ field }) => (
              <input
                id={`${formId}-name`}
                {...field}
                type="text"
                placeholder="Rent, Netflix, Auto insurance..."
                aria-label="Name"
                className="w-full bg-panel-2 border border-line rounded-[8px] text-cream font-mono text-base py-[13px] px-[14px] outline-none focus:border-accent/60 transition-colors placeholder:text-faint"
              />
            )}
          />
          {errors.name && (
            <p role="alert" className="font-mono text-xs text-signal mt-1.5">
              {errors.name.message}
            </p>
          )}
        </div>

        <div className="mt-4">
          <label
            htmlFor={`${formId}-category`}
            className="block font-mono text-xs tracking-label uppercase text-faint mb-2"
          >
            Category
          </label>
          <Controller
            control={control}
            name="category"
            render={({ field }) => (
              <StyledSelect
                id={`${formId}-category`}
                {...field}
                onChange={(e) => {
                  const category = e.target.value as SpendCategory;
                  field.onChange(category);
                  // Suggest a panel from the category when adding; on edit the
                  // user's chosen group stands.
                  if (!isEdit) setValue("group", defaultGroupForCategory(category));
                }}
                aria-label="Category"
                invalid={errors.category !== undefined}
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
              </StyledSelect>
            )}
          />
          {errors.category && (
            <p role="alert" className="font-mono text-xs text-signal mt-1.5">
              {errors.category.message}
            </p>
          )}
        </div>

        <div className="mt-4">
          <span className="block font-mono text-xs tracking-label uppercase text-faint mb-2">
            Group
          </span>
          <Controller
            control={control}
            name="group"
            render={({ field }) => (
              <div
                role="radiogroup"
                aria-label="Group"
                className="flex gap-1 bg-panel-2 border border-line rounded-[8px] p-1"
              >
                {GROUP_ORDER.map((group) => (
                  // biome-ignore lint/a11y/useSemanticElements: styled segmented control needs button, role+aria provide radio semantics
                  <button
                    key={group}
                    type="button"
                    role="radio"
                    aria-checked={field.value === group}
                    onClick={() => field.onChange(group)}
                    className={`${segBase} ${field.value === group ? segOn : segOff}`}
                  >
                    {GROUP_LABELS[group]}
                  </button>
                ))}
              </div>
            )}
          />
        </div>

        <div className="mt-4">
          <label
            htmlFor={`${formId}-renews`}
            className="block font-mono text-xs tracking-label uppercase text-faint mb-2"
          >
            Next bill &middot; optional
          </label>
          <Controller
            control={control}
            name="nextRenewalAt"
            render={({ field }) => (
              <input
                id={`${formId}-renews`}
                type="date"
                aria-label="Next renewal date"
                value={field.value ?? ""}
                onChange={(e) => field.onChange(e.target.value)}
                onBlur={field.onBlur}
                className="w-full bg-panel-2 border border-line rounded-[8px] text-cream font-mono text-base py-[13px] px-[14px] outline-none focus:border-accent/60 transition-colors [color-scheme:dark]"
              />
            )}
          />
          <p className="font-mono text-sm text-faint mt-1.5 tracking-[.04em]">
            the date it next charges &middot; stays current automatically
          </p>
          {errors.nextRenewalAt && (
            <p role="alert" className="font-mono text-xs text-signal mt-1">
              {errors.nextRenewalAt.message}
            </p>
          )}
        </div>

        {isEdit && (
          <div className="mt-4">
            <span className="block font-mono text-xs tracking-label uppercase text-faint mb-2">
              Status
            </span>
            <Controller
              control={control}
              name="status"
              render={({ field }) => (
                <div
                  role="radiogroup"
                  aria-label="Status"
                  className="flex gap-1 bg-panel-2 border border-line rounded-[8px] p-1"
                >
                  {(["active", "paused"] as const).map((s) => (
                    // biome-ignore lint/a11y/useSemanticElements: styled segmented control needs button, role+aria provide radio semantics
                    <button
                      key={s}
                      type="button"
                      role="radio"
                      aria-checked={field.value === s}
                      onClick={() => field.onChange(s)}
                      className={`${segBase} ${field.value === s ? segOn : segOff}`}
                    >
                      {s === "active" ? "Active" : "Paused"}
                    </button>
                  ))}
                </div>
              )}
            />
            <p className="font-mono text-sm text-faint mt-1.5 tracking-[.04em]">
              paused items stay in your list but drop out of the total
            </p>
          </div>
        )}

        <div className="flex gap-2.5 mt-[26px]">
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-xs tracking-button uppercase text-dim bg-transparent border border-line rounded-[8px] py-[15px] px-5 cursor-pointer hover:text-cream transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            form={formId}
            disabled={submitting}
            className="flex-1 font-mono text-xs tracking-button uppercase text-vault bg-accent rounded-[8px] py-[15px] cursor-pointer hover:bg-cream transition-colors font-medium disabled:opacity-50"
          >
            {submitting ? "Saving..." : isEdit ? "Save changes" : "Add"}
          </button>
        </div>

        {isEdit && onDelete !== undefined && (
          <button
            type="button"
            onClick={handleRemoveClick}
            disabled={deleting}
            className="w-full mt-3.5 font-mono text-xs tracking-button uppercase text-down bg-transparent border border-down/35 rounded-[8px] py-[13px] cursor-pointer hover:bg-down/8 transition-colors disabled:opacity-50"
          >
            {removeArmed
              ? "Tap again to remove this recurring expense"
              : deleting
                ? "Removing..."
                : "Remove"}
          </button>
        )}
      </form>
    </Modal>
  );
}
