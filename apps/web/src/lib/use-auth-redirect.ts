import type { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/providers/auth-context";

type NavigateFn = ReturnType<typeof useNavigate>;

interface AuthRedirectConfig {
  /** If true, redirect unlocked users to /app. */
  onUnlocked?: boolean;
  /** If true, redirect locked users to /unlock. */
  onLocked?: boolean;
  /** If true, redirect unauthenticated users to /auth/login. */
  onUnauthenticated?: boolean;
}

/**
 * Redirects based on auth state. Defaults to soft navigation via the router
 * navigate function. If no navigate function is provided, uses
 * window.location.replace for hard navigation (DEK-scrubbing safe).
 */
export function useAuthRedirect(config: AuthRedirectConfig, navigate?: NavigateFn) {
  const { state } = useAuth();

  useEffect(() => {
    if (config.onUnlocked && state === "unlocked") {
      if (navigate) navigate({ to: "/app", replace: true });
      else window.location.replace("/app");
    } else if (config.onLocked && state === "locked") {
      if (navigate) navigate({ to: "/unlock", replace: true });
      else window.location.replace("/unlock");
    } else if (config.onUnauthenticated && state === "unauthenticated") {
      if (navigate) navigate({ to: "/auth/login", replace: true });
      else window.location.replace("/auth/login");
    }
  }, [state, navigate, config.onUnlocked, config.onLocked, config.onUnauthenticated]);
}
