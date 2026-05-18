"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { useAuth } from "@/providers/auth-context";

export default function AuthLayout({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // Soft nav only, a hard reload here wipes the in-memory DEK that the
    // login/signup page just populated, which would bounce the user straight
    // back to /auth/login.
    if (state === "unlocked") router.replace("/");
    else if (state === "locked") router.replace("/unlock/");
  }, [state, router]);

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-neutral-50 dark:bg-neutral-950 px-4 py-12">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
