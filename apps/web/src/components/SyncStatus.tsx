import { useState } from "react";
import { useSync } from "@/providers/sync-context";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTitleRow } from "./ui/dialog";

export function SyncStatus() {
  const { store, saveError, initialising, conflicts = [], resolveConflict } = useSync();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const conflict = conflicts[0];
  const label = initialising
    ? "Sync status: syncing"
    : conflicts.length > 0
      ? "Sync status: conflict"
      : "Sync status: synced";
  const resolve = async (action: "keep-mine" | "keep-theirs") => {
    if (!conflict) return;
    setBusy(true);
    setError(null);
    try {
      await resolveConflict(conflict.queueId, action);
      setOpen(false);
    } catch {
      setError(
        "Could not resolve this conflict. Your device's changes are still pending. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div role="status" aria-label={label} className="sr-only">
        {label}
      </div>
      {store?.mode === "memory" && (
        <div role="status" className="border-b border-line bg-panel p-3 text-cream">
          Temporary storage: saves require server confirmation. Unconfirmed changes can be lost on
          reload.
        </div>
      )}
      {saveError && (
        <p role="alert" className="border-b border-line p-3 text-down">
          {saveError}
        </p>
      )}
      {conflict && (
        <div role="alert" className="border-b border-line bg-panel p-3 text-cream">
          Changes on this device conflict with the server. They have not been uploaded.
          <Button variant="secondary" onClick={() => setOpen(true)}>
            Review conflict
          </Button>
        </div>
      )}
      <Dialog open={open && !!conflict} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitleRow
            title="Resolve sync conflict"
            titleId="sync-conflict-title"
            onClose={() => setOpen(false)}
          />
          <p className="my-4">
            Choose which version of this {conflict?.kind ?? "record"} to keep. Later edits on this
            device will remain pending.
          </p>
          <p className="mb-4">
            This device: {conflict?.myTombstone ? "deleted" : "saved record"}. Server:{" "}
            {conflict?.theirTombstone ? "deleted" : "saved record"}.
          </p>
          <p className="mb-4">
            Keeping a saved record instead of a deletion restores it. Choosing a deletion removes
            the record.
          </p>
          {error && <p role="alert">{error}</p>}
          <DialogFooter>
            <Button disabled={busy} onClick={() => void resolve("keep-mine")}>
              Keep this device
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => void resolve("keep-theirs")}>
              Use server version
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
