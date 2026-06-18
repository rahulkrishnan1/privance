"use client";

import { useSync } from "@/providers/sync-context";

/**
 * Screen-reader-only live region announcing whether the local store has
 * finished its initial sync. There is no visible sync chrome in the redesign
 * (the old "Synced" pill was removed), but assistive-tech users still benefit
 * from knowing when their encrypted data has settled, and it gives automated
 * tests a stable "ready" signal to wait on before interacting.
 */
export function SyncStatus() {
  const { initialising } = useSync();
  const label = initialising ? "Sync status: syncing" : "Sync status: synced";
  // aria-label (not text content) supplies the accessible name: role="status"
  // does not compute its name from contents.
  return (
    <div role="status" aria-label={label} className="sr-only">
      {label}
    </div>
  );
}
