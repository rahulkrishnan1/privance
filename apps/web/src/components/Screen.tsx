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
  const base =
    "min-h-svh bg-neutral-50 dark:bg-neutral-950 [padding-top:env(safe-area-inset-top)] [padding-bottom:env(safe-area-inset-bottom)]";
  const widthClass = WIDTH_CLASS[width];

  if (scrollable) {
    return (
      <main className={[base, "overflow-y-auto"].filter(Boolean).join(" ")}>
        <div
          className={["px-4 py-6 mx-auto w-full", widthClass, className].filter(Boolean).join(" ")}
        >
          {children}
        </div>
      </main>
    );
  }

  return (
    <main className={[base, "flex flex-col h-svh overflow-hidden"].filter(Boolean).join(" ")}>
      <div
        className={["flex-1 px-4 py-6 overflow-hidden mx-auto w-full", widthClass, className]
          .filter(Boolean)
          .join(" ")}
      >
        {children}
      </div>
    </main>
  );
}
