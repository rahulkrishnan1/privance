"use client";

import type { ReactNode } from "react";

/**
 * Signal-bordered alert bar shared across the auth screens. The lead clause is
 * emphasised in the signal colour; the body sits in cream-soft. Presentation
 * only, it never decides which error maps to which copy.
 */
export function AuthErrorBar({ lead, children }: { lead: string; children: ReactNode }) {
  return (
    <div
      role="alert"
      className="mt-[22px] border border-signal/35 bg-signal/7 rounded-[8px] px-4 py-[13px] text-sm text-cream-soft leading-[1.55]"
    >
      <b className="text-signal font-medium">{lead}</b> {children}
    </div>
  );
}
