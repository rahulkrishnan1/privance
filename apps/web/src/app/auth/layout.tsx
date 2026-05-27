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
    <div className="flex min-h-svh flex-col items-center justify-center bg-neutral-50 dark:bg-neutral-950 px-4 py-12">
      <Link
        href="/"
        aria-label="Back to home"
        className="mb-8 flex items-center gap-2.5 text-neutral-900 dark:text-neutral-50 transition-opacity hover:opacity-80"
      >
        <Logo size={28} className="text-gold-600 dark:text-gold-400" />
        <span className="text-lg font-bold tracking-tight">Privance</span>
      </Link>
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
