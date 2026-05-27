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
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50 mb-6">Settings</h1>

      <div className="flex flex-col gap-4">
        {/* About card */}
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
          <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300 mb-3">
            About
          </h2>
          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-center py-1 border-b border-neutral-100 dark:border-neutral-800">
              <span className="text-sm text-neutral-600 dark:text-neutral-400">App</span>
              <span className="text-sm font-medium text-neutral-900 dark:text-neutral-50">
                Privance
              </span>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-neutral-100 dark:border-neutral-800">
              <span className="text-sm text-neutral-600 dark:text-neutral-400">Version</span>
              <span className="text-sm font-medium text-neutral-900 dark:text-neutral-50 tabular-nums">
                {APP_VERSION}
              </span>
            </div>
          </div>
        </div>

        {/* Security card */}
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
          <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300 mb-3">
            Security
          </h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Privance uses zero-knowledge encryption. Your master password and data encryption key
            never leave your device.
          </p>
        </div>

        {/* Coming soon card */}
        <div className="rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 p-4">
          <p className="text-sm text-neutral-500 dark:text-neutral-400 text-center">
            More settings coming soon
          </p>
        </div>
      </div>
    </Screen>
  );
}
