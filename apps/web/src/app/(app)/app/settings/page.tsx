"use client";

import { Button, Screen } from "@/components/index";
import { logout as apiLogout } from "@/lib/api/auth";
import { useAuth } from "@/providers/auth-context";

const APP_VERSION = "0.1.0";

export default function SettingsPage() {
  const { lock, logout } = useAuth();

  async function handleSignOut() {
    await apiLogout().catch(() => undefined);
    // Await logout so the registered store.destroy() finishes before we unload.
    await logout();
    window.location.replace("/auth/login/");
  }

  return (
    <Screen>
      <h1
        className="font-serif text-[32px] leading-tight font-light tracking-[-0.015em] text-app-text mb-10"
        style={{ fontVariationSettings: '"opsz" 48, "SOFT" 50' }}
      >
        Settings
      </h1>

      <div className="flex flex-col gap-10">
        <section className="flex flex-col gap-4">
          <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-app-dim">
            About
          </span>
          <div className="rounded-xl border border-app-line bg-app-panel divide-y divide-app-line-soft">
            <div className="flex justify-between items-center px-5 py-4">
              <span className="text-[14px] text-app-muted">App</span>
              <span className="font-mono text-[13px] text-app-text">Privance</span>
            </div>
            <div className="flex justify-between items-center px-5 py-4">
              <span className="text-[14px] text-app-muted">Version</span>
              <span className="font-mono text-[13px] tabular-nums text-app-text">
                {APP_VERSION}
              </span>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-app-dim">
            Security
          </span>
          <div className="rounded-xl border border-app-line bg-app-panel p-5 flex flex-col gap-5">
            <p className="text-[14px] text-app-muted">
              Privance uses zero-knowledge encryption. Your master password and data-encryption key
              never leave your device.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button variant="secondary" onClick={lock} className="sm:flex-1">
                Lock
              </Button>
              <Button
                variant="secondary"
                onClick={() => void handleSignOut()}
                className="sm:flex-1"
              >
                Sign out
              </Button>
            </div>
          </div>
        </section>

        <p className="font-mono text-[10px] tracking-[0.22em] uppercase text-app-dim text-center pt-4">
          More settings coming soon
        </p>
      </div>
    </Screen>
  );
}
