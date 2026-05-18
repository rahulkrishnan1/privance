"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { InvestmentAccount } from "@privance/core";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Button, Input } from "@/components/index";
import type { HoldingFormValues, LocalGroup } from "../types";
import { groupFormSchema, holdingFormSchema } from "../types";
import { GroupChip } from "./group-chips";
import { TickerAutocomplete } from "./ticker-autocomplete";

type HoldingFormProps = {
  initialValues?: Partial<HoldingFormValues>;
  investmentAccounts: InvestmentAccount[];
  groups: LocalGroup[];
  submitting: boolean;
  onSubmit: (values: HoldingFormValues, opts: { proxyPrice?: string }) => void | Promise<void>;
  onLookupProxyPrice?: (ticker: string) => Promise<string | null>;
  onCreateGroup: (name: string) => Promise<string>;
};

export function HoldingForm({
  initialValues,
  investmentAccounts,
  groups,
  submitting,
  onSubmit,
  onLookupProxyPrice,
  onCreateGroup,
}: HoldingFormProps) {
  const [advancedOpen, setAdvancedOpen] = useState(
    (initialValues?.proxyTicker ?? "").trim().length > 0,
  );
  const [newGroupName, setNewGroupName] = useState("");
  const [groupNameError, setGroupNameError] = useState<string | undefined>(undefined);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);

  const {
    control,
    handleSubmit,
    setError,
    setValue,
    watch,
    formState: { errors },
  } = useForm<HoldingFormValues>({
    resolver: zodResolver(holdingFormSchema),
    defaultValues: {
      assetType: "stock",
      ticker: "",
      // Auto-pick the only investment account so the user doesn't have to.
      accountId: investmentAccounts.length === 1 ? investmentAccounts[0].id : "",
      shares: "",
      avgCostPerShare: "",
      proxyTicker: "",
      nav: "",
      groupId: "",
      ...initialValues,
    },
  });

  const selectedGroupId = watch("groupId");
  const selectedGroup = groups.find((g) => g.id === selectedGroupId);
  const currentAccountId = watch("accountId");
  const currentProxyTicker = watch("proxyTicker") ?? "";
  const currentAssetType = watch("assetType");

  // Hydrate the auto-pick once accounts load (defaultValues snapshot at mount).
  useEffect(() => {
    if (investmentAccounts.length === 1 && !currentAccountId) {
      setValue("accountId", investmentAccounts[0].id, { shouldValidate: false });
    }
  }, [investmentAccounts, currentAccountId, setValue]);

  const handleCreateGroup = async () => {
    const parsed = groupFormSchema.safeParse({ name: newGroupName });
    if (!parsed.success) {
      setGroupNameError(parsed.error.issues[0]?.message ?? "Invalid group name");
      return;
    }
    setGroupNameError(undefined);
    setCreatingGroup(true);
    try {
      const id = await onCreateGroup(parsed.data.name);
      setValue("groupId", id);
      setNewGroupName("");
    } finally {
      setCreatingGroup(false);
    }
  };

  const handleFormSubmit = async (values: HoldingFormValues) => {
    const proxyTicker = values.proxyTicker?.trim().toUpperCase();
    const navFilled = (values.nav?.trim() ?? "").length > 0;

    if (proxyTicker && navFilled && onLookupProxyPrice !== undefined) {
      setLookingUp(true);
      try {
        const price = await onLookupProxyPrice(proxyTicker);
        if (price === null) {
          setError("proxyTicker", {
            type: "manual",
            message:
              "We couldn't get a current price for this proxy. Try a different ticker or come back in a few minutes.",
          });
          return;
        }
        await onSubmit(values, { proxyPrice: price });
      } finally {
        setLookingUp(false);
      }
      return;
    }

    await onSubmit(values, {});
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void handleSubmit(handleFormSubmit)();
      }}
      className="flex flex-col gap-4 pb-8"
      noValidate
    >
      {/* Asset type */}
      <Controller
        control={control}
        name="assetType"
        render={({ field }) => (
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Asset type
            </span>
            <div
              role="radiogroup"
              aria-label="Asset type"
              className="inline-flex rounded-lg border border-neutral-300 dark:border-neutral-700 p-0.5 self-start"
            >
              {(["stock", "crypto"] as const).map((type) => (
                // biome-ignore lint/a11y/useSemanticElements: styled segmented control needs button, role+aria provide radio semantics
                <button
                  key={type}
                  type="button"
                  role="radio"
                  aria-checked={field.value === type}
                  onClick={() => field.onChange(type)}
                  className={[
                    "px-3 py-1.5 text-sm rounded-md min-h-9 cursor-pointer focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:outline-none",
                    field.value === type
                      ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                      : "text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800",
                  ].join(" ")}
                >
                  {type === "stock" ? "Stock" : "Crypto"}
                </button>
              ))}
            </div>
          </div>
        )}
      />

      {/* Ticker, conditional input by asset type */}
      {currentAssetType === "stock" ? (
        <Controller
          control={control}
          name="ticker"
          render={({ field }) => (
            <TickerAutocomplete
              value={field.value}
              onChange={(v) => field.onChange(v.toUpperCase())}
              error={errors.ticker?.message}
            />
          )}
        />
      ) : (
        <Controller
          control={control}
          name="ticker"
          render={({ field }) => (
            <div className="flex flex-col gap-1">
              <Input
                label="CoinGecko ID"
                {...field}
                value={field.value ?? ""}
                onChange={(e) => field.onChange(e.target.value.toLowerCase())}
                autoCorrect="off"
                autoCapitalize="none"
                placeholder="e.g. bitcoin"
                error={errors.ticker?.message}
              />
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Find IDs at coingecko.com (URL ends with the ID). Use{" "}
                <span className="font-mono">bitcoin</span>, not{" "}
                <span className="font-mono">BTC</span>.
              </p>
            </div>
          )}
        />
      )}

      {/* Account */}
      <div className="flex flex-col gap-1">
        <label
          htmlFor="holding-account"
          className="text-sm font-medium text-neutral-700 dark:text-neutral-300"
        >
          Account
        </label>
        <Controller
          control={control}
          name="accountId"
          render={({ field }) => (
            <select
              id="holding-account"
              {...field}
              className={[
                "rounded-lg border px-3 py-2 text-sm bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-50 min-h-11 focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:outline-none cursor-pointer",
                errors.accountId ? "border-red-500" : "border-neutral-300 dark:border-neutral-700",
              ].join(" ")}
              disabled={investmentAccounts.length === 0}
            >
              {investmentAccounts.length === 0 ? (
                <option value="">No investment accounts, add one first</option>
              ) : (
                <>
                  <option value="" disabled>
                    Select an account
                  </option>
                  {investmentAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.payload.name}
                    </option>
                  ))}
                </>
              )}
            </select>
          )}
        />
        {errors.accountId && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {errors.accountId.message}
          </p>
        )}
      </div>

      {/* Shares */}
      <Controller
        control={control}
        name="shares"
        render={({ field }) => (
          <Input
            label="Shares"
            {...field}
            inputMode="decimal"
            placeholder="e.g. 10.5"
            error={errors.shares?.message}
          />
        )}
      />

      {/* Avg cost per share */}
      <Controller
        control={control}
        name="avgCostPerShare"
        render={({ field }) => (
          <Input
            label="Avg cost per share"
            {...field}
            inputMode="decimal"
            placeholder="e.g. 150.00"
            error={errors.avgCostPerShare?.message}
          />
        )}
      />

      {/* Group picker */}
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
          Group (optional)
        </span>
        <div className="flex flex-wrap gap-2">
          {groups.map((g) => (
            <GroupChip
              key={g.id}
              group={g}
              selected={selectedGroupId === g.id}
              onPress={() => setValue("groupId", selectedGroupId === g.id ? "" : g.id)}
            />
          ))}
        </div>

        {/* Inline group creation */}
        <div className="flex flex-col gap-1 mt-1">
          <div className="flex gap-2">
            <input
              value={newGroupName}
              onChange={(e) => {
                setNewGroupName(e.target.value);
                if (groupNameError !== undefined) setGroupNameError(undefined);
              }}
              placeholder="New group name"
              aria-label="New group name"
              maxLength={64}
              className="flex-1 rounded-lg border border-neutral-300 dark:border-neutral-700 px-3 py-2 text-sm text-neutral-900 dark:text-neutral-50 bg-white dark:bg-neutral-900 placeholder:text-neutral-400 focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:outline-none min-h-9"
            />
            <Button
              onClick={() => void handleCreateGroup()}
              disabled={creatingGroup || newGroupName.trim().length === 0}
              loading={creatingGroup}
              aria-label="Create group"
              size="sm"
            >
              {creatingGroup ? "Creating…" : "Create"}
            </Button>
          </div>
          {groupNameError !== undefined && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {groupNameError}
            </p>
          )}
        </div>

        {selectedGroup !== undefined && (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Selected: {selectedGroup.name}, click to deselect
          </p>
        )}
      </div>

      {/* Advanced section */}
      <button
        type="button"
        onClick={() => setAdvancedOpen((o) => !o)}
        aria-label={advancedOpen ? "Collapse advanced options" : "Expand advanced options"}
        aria-expanded={advancedOpen}
        className="flex items-center gap-1 focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:outline-none rounded min-h-9 cursor-pointer"
      >
        <span className="text-sm font-medium text-gold-600 dark:text-gold-400">
          Advanced options
        </span>
        {advancedOpen ? (
          <ChevronUp size={16} className="text-gold-600" />
        ) : (
          <ChevronDown size={16} className="text-gold-600" />
        )}
      </button>

      {advancedOpen && (
        <div className="flex flex-col gap-4 pl-2 border-l-2 border-neutral-200 dark:border-neutral-700">
          <Controller
            control={control}
            name="proxyTicker"
            render={({ field }) => (
              <div className="flex flex-col gap-1">
                <Input
                  label="Proxy ticker"
                  {...field}
                  value={field.value ?? ""}
                  onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                  autoCapitalize="characters"
                  placeholder="e.g. VOO"
                  error={errors.proxyTicker?.message}
                />
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Use a public ticker to track an asset we can't price directly (mutual funds,
                  private holdings). Leave blank if your ticker already has a live price.
                </p>
              </div>
            )}
          />
          {currentProxyTicker.trim().length > 0 && (
            <Controller
              control={control}
              name="nav"
              render={({ field }) => (
                <div className="flex flex-col gap-1">
                  <Input
                    label="Current price per share"
                    {...field}
                    value={field.value ?? ""}
                    inputMode="decimal"
                    placeholder="e.g. 342.19"
                    error={errors.nav?.message}
                  />
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    Today's per-share price of your actual asset. We anchor the proxy to this so
                    your market value tracks reality. Re-anchor anytime by editing this holding.
                  </p>
                </div>
              )}
            />
          )}
        </div>
      )}

      {/* Submit */}
      <Button
        type="submit"
        disabled={submitting || lookingUp}
        loading={submitting || lookingUp}
        aria-label={submitting || lookingUp ? "Saving" : "Save holding"}
        size="md"
        className="w-full"
      >
        {submitting || lookingUp ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
