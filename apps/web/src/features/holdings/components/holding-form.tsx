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
  isEdit: boolean;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (values: HoldingFormValues, opts: { proxyPrice?: string }) => void | Promise<void>;
  onLookupProxyPrice?: (ticker: string) => Promise<string | null>;
  onCreateGroup: (name: string) => Promise<string>;
};

export function HoldingForm({
  initialValues,
  investmentAccounts,
  groups,
  isEdit,
  submitting,
  onCancel,
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
    const initialProxy = (initialValues?.proxyTicker ?? "").trim().toUpperCase();
    const proxyChanged = (proxyTicker ?? "") !== initialProxy;

    // A new or changed proxy must be re-anchored from the current price per
    // share; an unchanged proxy reuses its stored anchor, so nav can stay blank.
    if (proxyTicker && proxyChanged && !navFilled) {
      setError("nav", {
        type: "manual",
        message: "Enter the current price per share for the proxy ticker.",
      });
      return;
    }

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
            <span className="font-mono text-xs tracking-label uppercase text-faint">
              Asset type
            </span>
            <div
              role="radiogroup"
              aria-label="Asset type"
              className="flex gap-1 bg-panel-2 border border-line rounded-lg p-1 self-start"
            >
              {(["stock", "crypto"] as const).map((type) => {
                const active = field.value === type;
                return (
                  // biome-ignore lint/a11y/useSemanticElements: styled segmented control needs button, role+aria provide radio semantics
                  <button
                    key={type}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => field.onChange(type)}
                    className={[
                      "font-mono text-xs tracking-button uppercase rounded-md py-2.5 px-4 cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                      active
                        ? "bg-vault text-accent border border-line"
                        : "text-faint hover:text-cream-soft",
                    ].join(" ")}
                  >
                    {type === "stock" ? "Stock" : "Crypto"}
                  </button>
                );
              })}
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
              <p className="font-mono text-xs text-faint tracking-[.04em]">
                Find IDs at coingecko.com (URL ends with the ID).
              </p>
            </div>
          )}
        />
      )}

      {/* Account */}
      <div className="flex flex-col gap-2">
        <label
          htmlFor="holding-account"
          className="font-mono text-xs tracking-label uppercase text-faint"
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
                "w-full bg-panel-2 border border-line rounded-lg text-cream font-mono text-base px-3.5 py-3 outline-none focus:border-accent-dim transition-colors cursor-pointer appearance-none",
                "bg-[length:14px] bg-[right_12px_center] bg-no-repeat pr-9",
                errors.accountId ? "border-signal" : "",
              ].join(" ")}
              style={{
                backgroundImage:
                  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%235e5e5a'><path d='M5.5 7.5l4.5 4.5 4.5-4.5' stroke='%235e5e5a' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>\")",
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
          <p role="alert" className="text-sm text-signal">
            {errors.accountId.message}
          </p>
        )}
      </div>

      {/* Quantity */}
      <Controller
        control={control}
        name="shares"
        render={({ field }) => (
          <Input
            label="Quantity"
            {...field}
            inputMode="decimal"
            placeholder="e.g. 10.5"
            error={errors.shares?.message}
          />
        )}
      />

      {/* Avg cost per share (total cost basis = this times shares) */}
      <Controller
        control={control}
        name="avgCostPerShare"
        render={({ field }) => (
          <Input
            label="Avg cost basis"
            {...field}
            inputMode="decimal"
            placeholder="e.g. 150.00"
            error={errors.avgCostPerShare?.message}
          />
        )}
      />

      {/* Current price per share of the actual asset, shown alongside cost basis
          because it describes the holding, not the proxy. Only when a proxy is set. */}
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
              <p className="font-mono text-xs text-faint tracking-[.04em]">
                Today's per-share price of your actual asset (not the proxy). We anchor the proxy to
                this so your market value tracks reality. Re-anchor anytime by editing this holding.
              </p>
            </div>
          )}
        />
      )}

      {/* Group picker, edit-only */}
      {isEdit && (
        <div className="flex flex-col gap-2">
          <span className="font-mono text-xs tracking-label uppercase text-faint">
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
                className="flex-1 bg-transparent border-b border-line focus:border-accent-dim px-1 py-2 text-base text-cream placeholder:text-faint/70 focus:outline-none transition-colors min-h-9"
              />
              <Button
                type="button"
                onClick={() => void handleCreateGroup()}
                disabled={creatingGroup || newGroupName.trim().length === 0}
                loading={creatingGroup}
                aria-label="Create group"
                size="sm"
              >
                {creatingGroup ? "Creating..." : "Create"}
              </Button>
            </div>
            {groupNameError !== undefined && (
              <p role="alert" className="text-sm text-signal">
                {groupNameError}
              </p>
            )}
          </div>

          {selectedGroup !== undefined && (
            <p className="font-mono text-xs text-faint tracking-[.04em]">
              Selected: {selectedGroup.name}, click to deselect
            </p>
          )}
        </div>
      )}

      {/* Advanced section */}
      <button
        type="button"
        onClick={() => setAdvancedOpen((o) => !o)}
        aria-label={advancedOpen ? "Collapse advanced options" : "Expand advanced options"}
        aria-expanded={advancedOpen}
        className="flex items-center gap-1 font-mono text-xs tracking-button uppercase text-accent-dim hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent focus-visible:rounded rounded min-h-9 cursor-pointer transition-colors"
      >
        <span>No public ticker? Use a price proxy</span>
        {advancedOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {advancedOpen && (
        <div className="flex flex-col gap-4 pl-3 border-l border-line">
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
                <p className="font-mono text-xs text-faint tracking-[.04em]">
                  Use a public ticker to track an asset we can't price directly (mutual funds,
                  private holdings). Leave blank if your ticker already has a live price.
                </p>
              </div>
            )}
          />
        </div>
      )}

      <div className="flex gap-2.5 pt-2">
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          disabled={submitting || lookingUp}
          className="flex-1"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={submitting || lookingUp}
          loading={submitting || lookingUp}
          className="flex-1"
        >
          {submitting || lookingUp ? "Saving..." : isEdit ? "Save changes" : "Add holding"}
        </Button>
      </div>
    </form>
  );
}
