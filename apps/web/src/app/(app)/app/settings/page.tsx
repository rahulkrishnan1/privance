"use client";

import { Screen } from "@/components/index";

const APP_VERSION = "0.1.0";

/**
 * Settings page, placeholder with version and about info.
 * Full feature module ships in a future task.
 */
export default function SettingsPage() {
  return (
    <Screen>
      <h1
        className="font-serif text-[32px] leading-tight font-light tracking-[-0.015em] text-app-text mb-6"
        style={{ fontVariationSettings: '"opsz" 48, "SOFT" 50' }}
      >
        Settings
      </h1>

      <div className="flex flex-col gap-4">
        {/* About card */}
        <div className="rounded-xl border border-app-line bg-app-panel p-4">
          <h2 className="text-sm font-semibold text-app-text mb-3">About</h2>
          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-center py-1 border-b border-app-line-soft">
              <span className="text-sm text-app-muted">App</span>
              <span className="text-sm font-medium text-app-text">Privance</span>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-app-line-soft">
              <span className="text-sm text-app-muted">Version</span>
              <span className="text-sm font-medium text-app-text tabular-nums">{APP_VERSION}</span>
            </div>
          </div>
        </div>

        {/* Security card */}
        <div className="rounded-xl border border-app-line bg-app-panel p-4">
          <h2 className="text-sm font-semibold text-app-text mb-3">Security</h2>
          <p className="text-sm text-app-muted">
            Privance uses zero-knowledge encryption. Your master password and data encryption key
            never leave your device.
          </p>
        </div>

        {/* Coming soon card */}
        <div className="rounded-xl border border-dashed border-app-line p-4">
          <p className="text-sm text-app-muted text-center">More settings coming soon</p>
        </div>
      </div>
    </Screen>
  );
}
