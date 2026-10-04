import { useEffect } from "react";
import { Outlet, useNavigate } from "react-router";
import { AuthBackdrop } from "@/components/auth/AuthBackdrop";
import { keyboardInsetStyle, useKeyboardInset } from "@/lib/use-keyboard-inset";
import { useAuth } from "@/providers/auth-context";

export default function AuthLayout() {
  const { state } = useAuth();
  const navigate = useNavigate();
  const keyboard = useKeyboardInset();

  useEffect(() => {
    if (state === "unlocked") navigate("/app", { replace: true });
    else if (state === "locked") navigate("/unlock", { replace: true });
  }, [state, navigate]);

  if (state !== "unauthenticated") {
    return <div className="min-h-svh bg-vault" />;
  }

  return (
    <div
      className="relative flex min-h-svh flex-col bg-vault text-cream max-md:fixed max-md:inset-x-0 max-md:top-0 max-md:bottom-(--kb-bottom) max-md:min-h-0"
      style={keyboardInsetStyle(keyboard, "100svh")}
    >
      <AuthBackdrop />
      <main
        className={`relative z-10 flex min-h-0 flex-1 justify-center overflow-y-auto px-5 ${
          keyboard.height > 0 ? "items-start py-5" : "items-center pb-16 pt-8"
        }`}
      >
        <div className="auth-rise w-full max-w-[440px]">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
