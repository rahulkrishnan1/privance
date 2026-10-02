import { lazy, Suspense, useState } from "react";
import { DateFieldTrigger } from "./date-field-trigger";

const DateFieldPicker = lazy(() =>
  import("./date-field-picker").then((module) => ({ default: module.DateFieldPicker })),
);

type DateFieldProps = {
  id?: string;
  /** Canonical wire value, `YYYY-MM-DD`, or "" when unset. */
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
};

const DATE_DISPLAY = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

// Parse at local midnight so the displayed day never shifts across a timezone
// boundary the way a UTC-parsed YYYY-MM-DD value can.
function parseDate(value: string): Date | undefined {
  if (!value) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return undefined;
  return new Date(year, month - 1, day);
}

export function DateField({
  id,
  value,
  onChange,
  onBlur,
  placeholder = "Select a date",
}: DateFieldProps) {
  const [activated, setActivated] = useState(false);
  const selectedDate = parseDate(value);
  const label = selectedDate ? DATE_DISPLAY.format(selectedDate) : null;

  if (!activated) {
    return (
      <DateFieldTrigger
        id={id}
        label={label}
        placeholder={placeholder}
        aria-haspopup="dialog"
        onClick={() => setActivated(true)}
      />
    );
  }

  return (
    <Suspense
      fallback={
        <DateFieldTrigger
          id={id}
          label={label}
          placeholder={placeholder}
          aria-haspopup="dialog"
          loading
          disabled
        />
      }
    >
      <DateFieldPicker
        id={id}
        value={value}
        selectedDate={selectedDate}
        label={label}
        placeholder={placeholder}
        onChange={onChange}
        onBlur={onBlur}
      />
    </Suspense>
  );
}
