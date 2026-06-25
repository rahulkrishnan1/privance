"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { Account, AccountKind, InvestmentAccountSubKind } from "@privance/core";
import { Decimal, SCALE_CENTS } from "@privance/core";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { Controller, type Resolver, useForm } from "react-hook-form";
import { Button, Input, StyledSelect } from "@/components/index";
import { Modal } from "@/components/Modal";
import {
  CASH_TYPE_OPTIONS,
  INVESTMENT_TYPE_OPTIONS,
} from "@/features/accounts/_investment-constants";
import type { CashSubKindValue } from "../types";
import { type AccountFormValues, accountFormSchema, KIND_META, SECTION_ORDER } from "../types";

function centsStringToDisplay(cents: string): string {
  return Decimal.fromMinorUnits(BigInt(cents), SCALE_CENTS).toString();
}

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

/** Stored APY/rate fractions ("0.0410") render as percent inputs ("4.10"). */
function fractionToPercentInput(fraction: string | undefined): string | undefined {
  return fraction ? (Number(fraction) * 100).toFixed(2) : undefined;
}

function apyPercentDefault(account: Account | undefined): string | undefined {
  const p = account?.payload;
  if (p?.kind === "cash" || p?.kind === "investment") return fractionToPercentInput(p.apy);
  return undefined;
}

function ratePercentDefault(account: Account | undefined): string | undefined {
  if (account?.payload.kind !== "liability") return undefined;
  return fractionToPercentInput(account.payload.interestRate);
}

function termYearsDefault(account: Account | undefined): string | undefined {
  if (account?.payload.kind !== "liability") return undefined;
  return account.payload.termYearsRemaining ?? undefined;
}

function valuedAtDefault(account: Account | undefined): string | undefined {
  if (account?.payload.kind !== "manual_asset") return undefined;
  return account.payload.valuedAt ?? undefined;
}

/**
 * Initial subKind for the form. Edit mode keeps a cash/investment account's own
 * subKind; a new account starts blank so the "Select an account type" placeholder
 * shows and the user picks explicitly.
 */
function initialSubKind(account: Account | undefined): AccountFormValues["subKind"] {
  if (account?.payload.kind === "investment" || account?.payload.kind === "cash") {
    return account.payload.subKind;
  }
  return undefined;
}

type KindSegmentProps = {
  value: AccountKind;
  onChange: (kind: AccountKind) => void;
  disabled?: boolean;
};

const KIND_DISPLAY: Record<AccountKind, string> = {
  investment: "Investment",
  cash: "Cash",
  manual_asset: "Asset",
  liability: "Liability",
};

function KindSegmentControl({ value, onChange, disabled = false }: KindSegmentProps) {
  return (
    <fieldset className="flex flex-col gap-2 border-0 p-0 m-0">
      <legend className="font-mono text-xs tracking-label uppercase text-faint mb-2">Kind</legend>
      <div className="flex gap-1 bg-panel-2 border border-line rounded-lg p-1">
        {SECTION_ORDER.map((k) => {
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
                "flex-1 font-mono text-xs tracking-button uppercase rounded-md py-2.5 px-1 cursor-pointer transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                active
                  ? "bg-vault text-accent border border-line"
                  : "text-faint hover:text-cream-soft",
              ].join(" ")}
            >
              {KIND_DISPLAY[k]}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

type SubKindSelectProps = {
  value: InvestmentAccountSubKind | "";
  onChange: (v: InvestmentAccountSubKind) => void;
  error?: string;
};

function SubKindSelect({ value, onChange, error }: SubKindSelectProps) {
  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor="account-subkind"
        className="font-mono text-xs tracking-label uppercase text-faint"
      >
        Account type
      </label>
      <StyledSelect
        id="account-subkind"
        value={value}
        onChange={(e) => onChange(e.target.value as InvestmentAccountSubKind)}
        invalid={error !== undefined}
      >
        <option value="" disabled>
          Select an account type
        </option>
        {INVESTMENT_TYPE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </StyledSelect>
      {error !== undefined && (
        <p role="alert" className="text-sm text-signal">
          {error}
        </p>
      )}
    </div>
  );
}

type CashSubKindSelectProps = {
  value: CashSubKindValue | "";
  onChange: (v: CashSubKindValue) => void;
  error?: string;
};

function CashSubKindSelect({ value, onChange, error }: CashSubKindSelectProps) {
  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor="cash-subkind"
        className="font-mono text-xs tracking-label uppercase text-faint"
      >
        Account type
      </label>
      <StyledSelect
        id="cash-subkind"
        value={value}
        onChange={(e) => onChange(e.target.value as CashSubKindValue)}
        invalid={error !== undefined}
      >
        <option value="" disabled>
          Select an account type
        </option>
        {CASH_TYPE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </StyledSelect>
      {error !== undefined && (
        <p role="alert" className="text-sm text-signal">
          {error}
        </p>
      )}
    </div>
  );
}

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
  const [saveError, setSaveError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<AccountFormValues>({
    resolver: zodResolver(accountFormSchema) as Resolver<AccountFormValues>,
    defaultValues: {
      name: account?.payload.name ?? "",
      kind: account?.payload.kind ?? defaultKind,
      currency: account?.payload.currency ?? "USD",
      balance: deriveBalanceString(account),
      subKind: initialSubKind(account),
      apy: apyPercentDefault(account),
      interestRate: ratePercentDefault(account),
      termYears: termYearsDefault(account),
      valuedAt: valuedAtDefault(account),
    },
  });

  const selectedKind = watch("kind");
  const showSweepField = selectedKind === "investment";
  const showBalanceField = selectedKind !== "investment";

  const balanceLabel =
    selectedKind === "manual_asset"
      ? "Current value"
      : selectedKind === "liability"
        ? "Amount owed"
        : "Current balance";

  const balanceNote =
    selectedKind === "manual_asset"
      ? "your estimate for a home, car, or other asset, update it anytime"
      : selectedKind === "liability"
        ? "the balance you still owe, subtracted from net worth"
        : "";

  // biome-ignore lint/correctness/useExhaustiveDependencies: open triggers reset
  useEffect(() => {
    reset({
      name: account?.payload.name ?? "",
      kind: account?.payload.kind ?? defaultKind,
      currency: account?.payload.currency ?? "USD",
      balance: deriveBalanceString(account),
      subKind: initialSubKind(account),
      apy: apyPercentDefault(account),
      interestRate: ratePercentDefault(account),
      termYears: termYearsDefault(account),
      valuedAt: valuedAtDefault(account),
    });
    setSaveError(null);
  }, [defaultKind, reset, account, open]);

  const submit = handleSubmit(async (values) => {
    try {
      setSaveError(null);
      await onSubmit(values);
    } catch {
      setSaveError("Could not save. Please try again.");
    }
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="account-form-title"
      className="max-h-[88vh] overflow-y-auto"
    >
      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <h2
            id="account-form-title"
            className="font-serif text-2xl leading-tight font-light tracking-[-0.01em] text-cream"
          >
            {isEditMode ? "Edit account" : "Add account"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 cursor-pointer text-faint hover:text-cream focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <X size={18} />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="flex flex-col gap-5"
          noValidate
        >
          <Controller
            control={control}
            name="kind"
            render={({ field }) => (
              <KindSegmentControl
                value={field.value}
                onChange={(k) => {
                  field.onChange(k);
                  // Clear the type so the placeholder shows and the user picks
                  // one valid for the new kind.
                  setValue("subKind", undefined);
                }}
                disabled={isEditMode}
              />
            )}
          />

          {selectedKind === "investment" && (
            <Controller
              control={control}
              name="subKind"
              render={({ field }) => (
                <SubKindSelect
                  value={(field.value ?? "") as InvestmentAccountSubKind | ""}
                  onChange={(v) => {
                    field.onChange(v);
                  }}
                  error={errors.subKind?.message}
                />
              )}
            />
          )}

          {selectedKind === "cash" && (
            <Controller
              control={control}
              name="subKind"
              render={({ field }) => (
                <CashSubKindSelect
                  value={(field.value ?? "") as CashSubKindValue | ""}
                  onChange={(v) => {
                    field.onChange(v);
                  }}
                  error={errors.subKind?.message}
                />
              )}
            />
          )}

          <Controller
            control={control}
            name="name"
            render={({ field }) => (
              <Input
                label="Name"
                {...field}
                autoCapitalize="words"
                maxLength={64}
                error={errors.name?.message}
              />
            )}
          />

          {showSweepField && (
            <div className="flex flex-col gap-1">
              <Controller
                control={control}
                name="balance"
                render={({ field }) => (
                  <Input
                    label="Cash balance / optional"
                    {...field}
                    inputMode="decimal"
                    placeholder="0.00"
                    error={errors.balance?.message}
                  />
                )}
              />
              <p className="font-mono text-xs text-faint tracking-[.04em]">
                uninvested cash in this account, added to its total alongside holdings
              </p>
            </div>
          )}

          {showBalanceField && (
            <div className="flex flex-col gap-1">
              <Controller
                control={control}
                name="balance"
                render={({ field }) => (
                  <Input
                    label={balanceLabel}
                    {...field}
                    inputMode="decimal"
                    placeholder="0.00"
                    error={errors.balance?.message}
                  />
                )}
              />
              {balanceNote && (
                <p className="font-mono text-xs text-faint tracking-[.04em]">{balanceNote}</p>
              )}
            </div>
          )}

          {(selectedKind === "cash" || selectedKind === "investment") && (
            <div className="flex flex-col gap-1">
              <Controller
                control={control}
                name="apy"
                render={({ field }) => (
                  <Input
                    label={selectedKind === "investment" ? "Cash APY (optional)" : "APY (optional)"}
                    {...field}
                    value={field.value ?? ""}
                    inputMode="decimal"
                    placeholder="e.g. 4.10"
                  />
                )}
              />
            </div>
          )}

          {selectedKind === "liability" && (
            <div className="flex gap-2.5">
              <div className="flex flex-col gap-1 flex-1">
                <Controller
                  control={control}
                  name="interestRate"
                  render={({ field }) => (
                    <Input
                      label="Rate (optional)"
                      {...field}
                      value={field.value ?? ""}
                      inputMode="decimal"
                      placeholder="e.g. 6.25"
                    />
                  )}
                />
              </div>
              <div className="flex flex-col gap-1 flex-1">
                <Controller
                  control={control}
                  name="termYears"
                  render={({ field }) => (
                    <Input
                      label="Years left (optional)"
                      {...field}
                      value={field.value ?? ""}
                      inputMode="decimal"
                      placeholder="e.g. 22"
                    />
                  )}
                />
              </div>
            </div>
          )}

          {selectedKind === "manual_asset" && (
            <div className="flex flex-col gap-2">
              <label
                htmlFor="valued-at"
                className="font-mono text-xs tracking-label uppercase text-faint"
              >
                Valued date (optional)
              </label>
              <Controller
                control={control}
                name="valuedAt"
                render={({ field }) => (
                  <input
                    id="valued-at"
                    type="date"
                    {...field}
                    value={field.value ?? ""}
                    className="w-full bg-panel-2 border border-line rounded-lg text-cream font-mono text-base px-3.5 py-3 outline-none focus:border-accent-dim transition-colors"
                  />
                )}
              />
            </div>
          )}

          {saveError !== null && (
            <div role="alert" className="rounded-lg border border-signal/40 bg-signal/10 px-4 py-3">
              <p className="text-sm text-signal">{saveError}</p>
            </div>
          )}

          <div className="flex gap-2.5 pt-2">
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
              {submitting ? "Saving..." : isEditMode ? "Save changes" : "Create account"}
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
