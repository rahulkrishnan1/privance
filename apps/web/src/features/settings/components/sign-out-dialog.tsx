"use client";

import { useRef } from "react";
import { Button } from "@/components";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { SettingsDialogHeader } from "./_primitives";

export function SignOutDialog({
  open,
  onClose,
  onSignOut,
}: {
  open: boolean;
  onClose: () => void;
  onSignOut: () => Promise<void>;
}) {
  // Drop re-entrant clicks so a fast double-tap can't fire logout twice; no
  // visual busy state since sign-out redirects immediately.
  const signingOut = useRef(false);
  const handleSignOut = () => {
    if (signingOut.current) return;
    signingOut.current = true;
    void onSignOut().finally(() => {
      signingOut.current = false;
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent aria-labelledby="signout-title">
        <SettingsDialogHeader title="Sign out" titleId="signout-title" onClose={onClose} />
        <p className="text-sm leading-[1.6] text-dim">
          Clears the decrypted data and biometric unlock from this device. Everything stays
          encrypted on the server and returns when you sign back in.
        </p>
        <div className="mt-[18px] rounded-lg border border-signal/30 bg-signal/6 px-4 py-[13px] text-sm leading-[1.55] text-cream-soft">
          <strong className="font-medium text-signal">Know your password.</strong> Getting back in
          needs your master password or recovery phrase, nothing else.
        </div>
        <DialogFooter className="mt-[26px]">
          <Button variant="secondary" onClick={onClose}>
            Stay
          </Button>
          <Button variant="danger" onClick={handleSignOut}>
            Sign out
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
