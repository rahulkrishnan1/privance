import { CalendarDays } from "lucide-react";
import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";
import { Spinner } from "./Spinner";

type DateFieldTriggerProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string | null;
  placeholder: string;
  loading?: boolean;
};

export const DateFieldTrigger = forwardRef<HTMLButtonElement, DateFieldTriggerProps>(
  ({ label, placeholder, loading = false, className, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      className={cn(
        "flex w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-line bg-panel-2 px-3.5 py-3 text-left font-mono text-base text-cream outline-none transition-[border-color,box-shadow] focus:border-accent-dim focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:ring-offset-2 focus-visible:ring-offset-panel",
        className,
      )}
      {...props}
    >
      <span className={label ? "" : "text-faint"}>{label ?? placeholder}</span>
      {loading ? (
        <Spinner className="size-4 shrink-0 text-accent" />
      ) : (
        <CalendarDays size={16} className="shrink-0 text-faint" aria-hidden="true" />
      )}
    </button>
  ),
);
DateFieldTrigger.displayName = "DateFieldTrigger";
