"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { Account, AccountKind } from "@privance/core";
import { useEffect, useRef } from "react";
import { Controller, useForm } from "react-hook-form";
import { Button, Input } from "@/components/index";
import { type AccountFormValues, accountFormSchema, accountKindValues, KIND_META } from "../types";

// ---------------------------------------------------------------------------
// Balance serialisation helper
// ---------------------------------------------------------------------------

function deriveBalanceString(account: Account | undefined): string {
  if (account === undefined) return "";
  switch (account.payload.kind) {
    case "cash":
      return centsStringToDisplay(account.payload.balanceCents);
    case "investment":
      return centsStringToDisplay(account.payload.cashBalanceCents);
    case "liability":
      return centsStringToDisplay(account.payload.balanceCents);
    case "manual_asset":
      return centsStringToDisplay(account.payload.valueCents);
  }
}

function centsStringToDisplay(cents: string): string {
  const n = BigInt(cents);
  const isNeg = n < 0n;
  const abs = isNeg ? -n : n;
  const intPart = (abs / 100n).toString();
  const fracPart = (abs % 100n).toString().padStart(2, "0");
  return isNeg ? `-${intPart}.${fracPart}` : `${intPart}.${fracPart}`;
}

// ---------------------------------------------------------------------------
// Kind segmented control
// ---------------------------------------------------------------------------

type KindSegmentProps = {
  value: AccountKind;
  onChange: (kind: AccountKind) => void;
  disabled?: boolean;
};

function KindSegmentControl({ value, onChange, disabled = false }: KindSegmentProps) {
  return (
    <fieldset className="flex flex-col gap-1 border-0 p-0 m-0">
      <legend className="text-sm font-medium text-app-text mb-1">Account type</legend>
      <div className="flex flex-wrap gap-2">
        {accountKindValues.map((k) => {
          const active = k === value;
          return (
            <button
              key={k}
              type="button"
              onClick={() => !disabled && onChange(k)}
              aria-pressed={active}
              aria-label={KIND_META[k].label}
              disabled={disabled}
              className={[
                "px-3 py-2 rounded-lg border text-xs font-medium focus-visible:ring-2 focus-visible:ring-gold-accent/40 focus-visible:outline-none min-h-11 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50",
                active
                  ? "bg-gold-600 border-gold-600 text-white font-semibold"
                  : "bg-app-panel border-app-line text-app-text",
              ].join(" ")}
            >
              {KIND_META[k].label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// AccountForm
// ---------------------------------------------------------------------------

type AccountFormProps = {
  account?: Account;
  defaultKind?: AccountKind;
  open: boolean;
  onClose: () => void;
  onSubmit: (values: AccountFormValues) => Promise<void>;
  submitting?: boolean;
};

export function AccountForm({
  account,
  defaultKind = "cash",
  open,
  onClose,
  onSubmit,
  submitting = false,
}: AccountFormProps) {
  const isEditMode = account !== undefined;
  const dialogRef = useRef<HTMLDialogElement>(null);

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<AccountFormValues>({
    resolver: zodResolver(accountFormSchema),
    defaultValues: {
      name: account?.payload.name ?? "",
      kind: account?.payload.kind ?? defaultKind,
      currency: account?.payload.currency ?? "USD",
      balance: deriveBalanceString(account),
    },
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: open is a trigger, not read in the body
  useEffect(() => {
    reset({
      name: account?.payload.name ?? "",
      kind: account?.payload.kind ?? defaultKind,
      currency: account?.payload.currency ?? "USD",
      balance: deriveBalanceString(account),
    });
  }, [defaultKind, reset, account, open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const submit = handleSubmit(async (values) => {
    await onSubmit(values);
  });

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="m-0 sm:m-auto rounded-none sm:rounded-2xl p-0 shadow-xl w-full h-svh sm:h-auto max-w-none sm:max-w-sm max-h-none sm:max-h-[90vh] bg-app-panel border-0 backdrop:bg-black/50 focus-visible:outline-none overflow-y-auto"
      aria-modal="true"
      aria-label={isEditMode ? "Edit account" : "Add account"}
    >
      <div className="p-6 flex flex-col gap-5 [padding-bottom:max(env(safe-area-inset-bottom),5rem)] sm:[padding-bottom:1.5rem]">
        <h2 className="text-lg font-bold text-app-text">
          {isEditMode ? "Edit account" : "Add account"}
        </h2>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="flex flex-col gap-5"
          noValidate
        >
          {/* Name */}
          <Controller
            control={control}
            name="name"
            render={({ field }) => (
              <Input
                label="Account name"
                {...field}
                autoCapitalize="words"
                maxLength={64}
                error={errors.name?.message}
              />
            )}
          />

          {/* Kind, disabled in edit mode */}
          <Controller
            control={control}
            name="kind"
            render={({ field }) => (
              <KindSegmentControl
                value={field.value}
                onChange={field.onChange}
                disabled={isEditMode}
              />
            )}
          />

          {/* Currency */}
          <Controller
            control={control}
            name="currency"
            render={({ field }) => (
              <Input
                label="Currency (ISO 4217)"
                {...field}
                onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                autoCapitalize="characters"
                maxLength={3}
                placeholder="USD"
                error={errors.currency?.message}
              />
            )}
          />

          {/* Balance */}
          <Controller
            control={control}
            name="balance"
            render={({ field }) => (
              <Input
                label="Balance"
                {...field}
                inputMode="decimal"
                placeholder="0.00"
                error={errors.balance?.message}
              />
            )}
          />

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={submitting}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button type="submit" loading={submitting} disabled={submitting} className="flex-1">
              {submitting ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
