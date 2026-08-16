import { useEffect } from "react";
import { Outlet, useNavigate } from "react-router";
import { AuthBackdrop } from "@/components/auth/AuthBackdrop";
import { useAuth } from "@/providers/auth-context";

export default function AuthLayout() {
  const { state } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (state === "unlocked") navigate("/app", { replace: true });
    else if (state === "locked") navigate("/unlock", { replace: true });
  }, [state, navigate]);

  if (state !== "unauthenticated") {
    return <div className="dark min-h-svh bg-vault" />;
  }

  return (
    <div className="relative flex min-h-svh flex-col bg-vault text-cream">
      <AuthBackdrop />
      <main className="flex-1 flex items-center justify-center px-5 pb-16 pt-8 relative z-10">
        <div className="auth-rise w-full max-w-[440px]">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
