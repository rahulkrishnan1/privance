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

  const submit = handleSubmit(async (values) => {
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
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="flex flex-col gap-4 pb-8"
      noValidate
    >
      {/* Asset type */}
      <Controller
        control={control}
        name="assetType"
        render={({ field }) => (
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-app-dim">
              Asset type
            </span>
            <div role="radiogroup" aria-label="Asset type" className="flex gap-2 self-start">
              {(["stock", "crypto"] as const).map((type) => (
                // biome-ignore lint/a11y/useSemanticElements: styled segmented control needs button, role+aria provide radio semantics
                <button
                  key={type}
                  type="button"
                  role="radio"
                  aria-checked={field.value === type}
                  onClick={() => field.onChange(type)}
                  className={[
                    "rounded-full border px-4 sm:px-5 h-9 sm:h-10 text-xs sm:text-[13px] font-medium tracking-tight whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-accent focus-visible:rounded-[inherit] cursor-pointer",
                    field.value === type
                      ? "bg-gold-accent/10 border-gold-accent text-gold-accent"
                      : "bg-transparent border-app-line text-app-muted hover:text-app-text hover:border-app-muted/40",
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
            <Input
              label="Ticker"
              {...field}
              value={field.value ?? ""}
              onChange={(e) => field.onChange(e.target.value.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect="off"
              mono
              placeholder="e.g. AAPL"
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
              <p className="text-xs text-app-muted">
                Find IDs at coingecko.com (URL ends with the ID). Use{" "}
                <span className="font-mono">bitcoin</span>, not{" "}
                <span className="font-mono">BTC</span>.
              </p>
            </div>
          )}
        />
      )}

      {/* Account */}
      <div className="flex flex-col gap-2">
        <label
          htmlFor="holding-account"
          className="font-mono text-[10px] tracking-[0.22em] uppercase text-app-dim"
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
                "bg-transparent border-b px-1 py-2.5 text-[15px] text-app-text min-h-11 focus:outline-none cursor-pointer appearance-none transition-colors",
                "bg-[length:14px] bg-[right_center] bg-no-repeat pr-7",
                errors.accountId ? "border-app-red" : "border-app-line focus:border-gold-accent",
              ].join(" ")}
              style={{
                backgroundImage:
                  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%23a8a195'><path d='M5.5 7.5l4.5 4.5 4.5-4.5' stroke='%23a8a195' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>\")",
              }}
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
          <p role="alert" className="text-[13px] text-app-red">
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
        <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-app-dim">
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
          <div className="flex gap-2 items-end">
            <input
              value={newGroupName}
              onChange={(e) => {
                setNewGroupName(e.target.value);
                if (groupNameError !== undefined) setGroupNameError(undefined);
              }}
              placeholder="New group name"
              aria-label="New group name"
              maxLength={64}
              className="flex-1 bg-transparent border-b border-app-line focus:border-gold-accent px-1 py-2 text-[14px] text-app-text placeholder:text-app-dim/70 focus:outline-none transition-colors min-h-9"
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
            <p role="alert" className="text-[13px] text-app-red">
              {groupNameError}
            </p>
          )}
        </div>

        {selectedGroup !== undefined && (
          <p className="text-xs text-app-muted">
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
        className="flex items-center gap-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-accent focus-visible:rounded-[inherit] rounded min-h-9 cursor-pointer"
      >
        <span className="text-sm font-medium text-gold-accent">Advanced options</span>
        {advancedOpen ? (
          <ChevronUp size={16} className="text-gold-accent" />
        ) : (
          <ChevronDown size={16} className="text-gold-accent" />
        )}
      </button>

      {advancedOpen && (
        <div className="flex flex-col gap-4 pl-2 border-l-2 border-app-line">
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
                <p className="text-xs text-app-muted">
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
                  <p className="text-xs text-app-muted">
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
