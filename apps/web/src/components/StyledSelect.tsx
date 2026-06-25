import type { SelectHTMLAttributes } from "react";

// Inline chevron so the control renders identically across browsers (native
// select arrows differ); paired with appearance-none below.
const CHEVRON =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'><path d='M5.5 7.5l4.5 4.5 4.5-4.5' stroke='%235e5e5a' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>\")";

type StyledSelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  /** Renders the error border when the field is invalid. */
  invalid?: boolean;
};

/**
 * App-standard dropdown: panel-2 surface, custom chevron, mono text. Shared so
 * every form's select matches the holding "Account" picker.
 */
export function StyledSelect({
  invalid = false,
  className = "",
  style,
  children,
  ...props
}: StyledSelectProps) {
  return (
    <select
      {...props}
      className={[
        "w-full bg-panel-2 border rounded-lg text-cream font-mono text-base px-3.5 py-3 outline-none focus:border-accent-dim transition-colors cursor-pointer appearance-none",
        "bg-[length:14px] bg-[right_12px_center] bg-no-repeat pr-9",
        invalid ? "border-signal" : "border-line",
        className,
      ].join(" ")}
      style={{ backgroundImage: CHEVRON, ...style }}
    >
      {children}
    </select>
  );
}
