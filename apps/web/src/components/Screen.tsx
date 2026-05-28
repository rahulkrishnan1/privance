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
  wide: "max-w-screen-2xl",
};

export function Screen({ children, scrollable = true, width = "sm", className }: ScreenProps) {
  const base = "bg-app-bg text-app-text [padding-bottom:env(safe-area-inset-bottom)]";
  const widthClass = WIDTH_CLASS[width];

  if (scrollable) {
    return (
      <div className={base}>
        <div
          className={["px-5 py-8 md:py-10 mx-auto w-full", widthClass, className]
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
        className={["flex-1 px-5 py-8 overflow-hidden mx-auto w-full", widthClass, className]
          .filter(Boolean)
          .join(" ")}
      >
        {children}
      </div>
    </div>
  );
}
