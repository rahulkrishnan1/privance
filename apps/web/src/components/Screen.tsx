"use client";

import type { ReactNode } from "react";

type ScreenProps = {
  children: ReactNode;
  scrollable?: boolean;
  /**
   * Content max-width on desktop. Defaults to "sm" (640px) for narrow flows
   * like Settings; use "wide" for data-dense screens (dashboard, holdings).
   */
  width?: "sm" | "wide";
  className?: string;
};

const WIDTH_CLASS: Record<NonNullable<ScreenProps["width"]>, string> = {
  sm: "max-w-screen-sm",
  // Match the data-dense wrapper used by Invest/Spend so page widths stay uniform.
  wide: "max-w-[1120px]",
};

export function Screen({ children, scrollable = true, width = "sm", className }: ScreenProps) {
  const base = "bg-vault text-cream [padding-bottom:env(safe-area-inset-bottom)]";
  const widthClass = WIDTH_CLASS[width];

  if (scrollable) {
    return (
      <div className={base}>
        <div
          className={["px-7 max-[760px]:px-4 pt-6 mx-auto w-full", widthClass, className]
            .filter(Boolean)
            .join(" ")}
        >
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className={[base, "flex flex-col h-[calc(100svh-4rem)] overflow-hidden"].join(" ")}>
      <div
        className={[
          "flex-1 px-7 max-[760px]:px-4 py-8 overflow-hidden mx-auto w-full",
          widthClass,
          className,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {children}
      </div>
    </div>
  );
}
