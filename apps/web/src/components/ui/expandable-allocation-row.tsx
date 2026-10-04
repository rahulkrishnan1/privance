import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type ExpandableAllocationRowProps = {
  detailsId: string;
  isOpen: boolean;
  color: string;
  label: ReactNode;
  amount: ReactNode;
  share: ReactNode;
  details: ReactNode;
  amountTestId?: string;
  isHighlighted?: boolean;
  isDimmed?: boolean;
  onToggle: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
};

export function ExpandableAllocationRow({
  detailsId,
  isOpen,
  color,
  label,
  amount,
  share,
  details,
  amountTestId,
  isHighlighted = false,
  isDimmed = false,
  onToggle,
  onFocus,
  onBlur,
  onMouseEnter,
  onMouseLeave,
}: ExpandableAllocationRowProps) {
  return (
    <li
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={cn(
        "col-span-4 grid grid-cols-subgrid max-[360px]:col-span-3",
        isHighlighted && "bg-panel-2",
        isDimmed && "opacity-50",
      )}
    >
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={detailsId}
        onClick={onToggle}
        onFocus={onFocus}
        onBlur={onBlur}
        className="col-span-4 grid min-h-[46px] grid-cols-subgrid items-center rounded-[5px] border-b border-line-soft px-1 py-[11px] text-left text-sm transition-colors duration-100 hover:bg-panel-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none max-[360px]:col-span-3 max-[360px]:min-h-[58px] max-[360px]:grid-rows-[auto_auto] max-[360px]:py-2"
      >
        <span className="flex min-w-0 items-center gap-2.5 max-[360px]:row-span-2">
          <span
            className="size-[9px] flex-none rounded-[2px]"
            style={{ background: color }}
            aria-hidden="true"
          />
          {label}
        </span>
        <span
          data-testid={amountTestId}
          className="vfig text-right font-mono text-sm tabular-nums text-cream max-[360px]:col-start-2 max-[360px]:row-start-1 max-[360px]:text-xs"
        >
          {amount}
        </span>
        <span className="text-right font-mono text-sm tabular-nums text-dim max-[360px]:col-start-2 max-[360px]:row-start-2 max-[360px]:text-xs">
          {share}
        </span>
        <ChevronDown
          aria-hidden="true"
          size={15}
          strokeWidth={1.6}
          className={cn(
            "-ml-5 justify-self-start text-faint transition-transform duration-150 motion-reduce:transition-none max-[360px]:col-start-3 max-[360px]:row-span-2 max-[360px]:ml-0 max-[360px]:justify-self-end max-[520px]:-ml-1",
            isOpen && "rotate-180",
          )}
        />
      </button>
      {isOpen && (
        <div id={detailsId} className="col-span-4 max-[360px]:col-span-3">
          {details}
        </div>
      )}
    </li>
  );
}
