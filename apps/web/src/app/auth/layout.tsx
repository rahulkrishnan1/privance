"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { AuthBackdrop } from "@/components/auth/AuthBackdrop";
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
      <AuthBackdrop />
      <main className="flex-1 flex items-center justify-center px-5 pb-16 pt-8 relative z-10">
        <div className="auth-rise w-full max-w-[440px]">{children}</div>
      </main>
    </div>
  );
}
