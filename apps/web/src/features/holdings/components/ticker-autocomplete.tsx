"use client";

import type { SymbolProfile } from "@privance/core";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Input } from "@/components/index";
import { useTickerLookup } from "../queries";

const DEBOUNCE_MS = 300;

type TickerAutocompleteProps = {
  value: string;
  onChange: (ticker: string) => void;
  onProfileSelect?: (profile: SymbolProfile) => void;
  error?: string;
  label?: string;
};

export function TickerAutocomplete({
  value,
  onChange,
  onProfileSelect,
  error,
  label = "Ticker",
}: TickerAutocompleteProps) {
  const [inputValue, setInputValue] = useState(value);
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listboxId = useId();

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const upper = e.target.value.toUpperCase();
      setInputValue(upper);
      onChange(upper);
      setOpen(true);
      setActiveIndex(-1);

      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setDebouncedQuery(upper);
      }, DEBOUNCE_MS);
    },
    [onChange],
  );

  const { results } = useTickerLookup(debouncedQuery);
  const topResults = results.slice(0, 8);

  const handleSelect = useCallback(
    (profile: SymbolProfile) => {
      setInputValue(profile.ticker);
      onChange(profile.ticker);
      onProfileSelect?.(profile);
      setOpen(false);
      setDebouncedQuery("");
      setActiveIndex(-1);
    },
    [onChange, onProfileSelect],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!open || topResults.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, topResults.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && activeIndex >= 0) {
        e.preventDefault();
        const profile = topResults[activeIndex];
        if (profile !== undefined) handleSelect(profile);
      } else if (e.key === "Escape") {
        setOpen(false);
        setActiveIndex(-1);
      }
    },
    [open, topResults, activeIndex, handleSelect],
  );

  const optionId = (i: number) => `${listboxId}-option-${i}`;
  const activedescendant = open && activeIndex >= 0 ? optionId(activeIndex) : undefined;

  return (
    <div className="relative flex flex-col gap-1">
      <Input
        label={label}
        value={inputValue}
        onChange={handleChange}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setActiveIndex(-1);
        }}
        onKeyDown={handleKeyDown}
        role="combobox"
        aria-expanded={open && topResults.length > 0}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activedescendant}
        autoCapitalize="characters"
        autoCorrect="off"
        placeholder="e.g. AAPL"
        error={error}
      />

      {open && topResults.length > 0 && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute top-full left-0 right-0 z-50 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-md overflow-hidden mt-1"
        >
          {topResults.map((item, index) => (
            <div
              key={item.ticker}
              id={optionId(index)}
              role="option"
              aria-selected={index === activeIndex}
              tabIndex={-1}
              onMouseDown={() => handleSelect(item)}
              onMouseEnter={() => setActiveIndex(index)}
              className={[
                "w-full px-3 py-2 flex items-center gap-2 text-left cursor-pointer min-h-11",
                index < topResults.length - 1
                  ? "border-b border-neutral-100 dark:border-neutral-800"
                  : "",
                index === activeIndex
                  ? "bg-neutral-100 dark:bg-neutral-800"
                  : "hover:bg-neutral-50 dark:hover:bg-neutral-800",
              ].join(" ")}
            >
              <span className="text-sm font-bold text-neutral-900 dark:text-neutral-50 w-14 truncate">
                {item.ticker}
              </span>
              <span className="flex-1 flex flex-col min-w-0">
                <span className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                  {item.displayName}
                </span>
                <span className="text-xs text-neutral-400 dark:text-neutral-500 truncate">
                  {[item.assetClass, item.exchange].filter(Boolean).join(" · ")}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
