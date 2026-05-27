"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { Logo } from "@/components/index";
import { useAuth } from "@/providers/auth-context";

export default function AuthLayout({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // Soft nav only, a hard reload here wipes the in-memory DEK that the
    // login/signup page just populated, which would bounce the user straight
    // back to /auth/login.
    if (state === "unlocked") router.replace("/app/");
    else if (state === "locked") router.replace("/unlock/");
  }, [state, router]);

  return (
    <div className="dark relative flex min-h-svh flex-col items-center justify-center bg-app-bg text-app-text px-4 py-12">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[55vh] bg-[radial-gradient(ellipse_at_top,_rgba(230,211,154,0.08),_transparent_60%)]"
      />
      <Link
        href="/"
        aria-label="Back to home"
        className="relative z-10 mb-10 flex items-center gap-2.5 transition-opacity hover:opacity-80"
      >
        <Logo size={26} className="text-gold-accent" />
        <span
          className="font-serif text-[17px] text-app-text"
          style={{ fontVariationSettings: '"opsz" 24, "SOFT" 80' }}
        >
          Privance
        </span>
      </Link>
      <div className="relative z-10 w-full max-w-md">{children}</div>
    </div>
  );
}
