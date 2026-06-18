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
    <div className="relative flex min-h-svh flex-col bg-vault text-cream">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed w-[900px] h-[900px] rounded-full"
        style={{
          left: "50%",
          top: -480,
          transform: "translateX(-50%)",
          background: "radial-gradient(circle, rgba(127,196,198,.07), transparent 62%)",
          zIndex: 0,
        }}
      />
      <header className="px-8 py-[26px] flex justify-between items-center relative z-10">
        <Link
          href="/"
          aria-label="Back to home"
          className="flex items-center gap-[9px] no-underline font-serif text-[22px] text-cream hover:opacity-80 transition-opacity"
        >
          <Logo size={24} className="text-cream flex-none" />
          Privance
        </Link>
      </header>
      <main className="flex-1 flex items-center justify-center px-5 pb-16 pt-8 relative z-10">
        <div className="auth-rise w-full max-w-[440px]">{children}</div>
      </main>
    </div>
  );
}
