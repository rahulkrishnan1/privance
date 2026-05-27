"use client";

import type { HTMLAttributes, ReactNode } from "react";

type CardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

export function Card({ children, className, ...rest }: CardProps) {
  return (
    <div
      {...rest}
      className={["rounded-xl border border-app-line", "bg-app-panel p-6", className]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  );
}
