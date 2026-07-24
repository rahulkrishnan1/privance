import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { AuthBackdrop } from "@/components/auth/AuthBackdrop";
import { useAuthRedirect } from "@/lib/use-auth-redirect";

export const Route = createFileRoute("/auth/_auth")({
  component: AuthLayout,
});

function AuthLayout() {
  const navigate = useNavigate();
  useAuthRedirect({ onUnlocked: true, onLocked: true }, navigate);

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
