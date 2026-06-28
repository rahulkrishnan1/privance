"use client";

import { CalendarDays } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type DateFieldProps = {
  id?: string;
  /** Canonical wire value, `YYYY-MM-DD`, or "" when unset. */
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
};

// `YYYY-MM-DD` <-> Date at local midnight, so the displayed day never shifts
// across a timezone boundary the way `new Date("2026-06-25")` (parsed as UTC) would.
function toDate(value: string): Date | undefined {
  if (!value) return undefined;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

function toValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const DATE_DISPLAY = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const THIS_YEAR = new Date().getFullYear();
const CALENDAR_START = new Date(THIS_YEAR - 20, 0);
const CALENDAR_END = new Date(THIS_YEAR + 10, 11);

function display(value: string): string | null {
  const date = toDate(value);
  return date ? DATE_DISPLAY.format(date) : null;
}

export function DateField({
  id,
  value,
  onChange,
  onBlur,
  placeholder = "Select a date",
}: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const selected = toDate(value);
  const label = display(value);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) onBlur?.();
      }}
    >
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          className="flex w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-line bg-panel-2 px-3.5 py-3 text-left font-mono text-base text-cream outline-none transition-colors focus:border-accent-dim"
        >
          <span className={label ? "" : "text-faint"}>{label ?? placeholder}</span>
          <CalendarDays size={16} className="text-faint shrink-0" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-auto p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Calendar
          mode="single"
          captionLayout="dropdown"
          startMonth={CALENDAR_START}
          endMonth={CALENDAR_END}
          selected={selected}
          defaultMonth={selected}
          onSelect={(date) => {
            onChange(date ? toValue(date) : "");
            setOpen(false);
          }}
          // `accent` is our brand teal, so the default today highlight (a teal box)
          // would clash with the selected day. Mark today with teal text instead.
          classNames={{ today: "text-accent" }}
        />
        {value && (
          <div className="border-t border-line px-2 py-1.5">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-left"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              Clear
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
