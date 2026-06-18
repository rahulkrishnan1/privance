"use client";

import { useRef } from "react";
import { Modal } from "@/components/index";
import { CANCEL_BTN, SAVE_BTN_RED } from "../types";
import { DialogHeader } from "./_primitives";

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
    <Modal open={open} onClose={onClose} labelledBy="signout-title">
      <DialogHeader title="Sign out" titleId="signout-title" onClose={onClose} />
      <p className="text-[13.5px] leading-[1.6] text-cream-soft">
        This wipes the decrypted store and biometric enrollment from this device. Your data stays on
        the server, as ciphertext, and comes back on your next sign-in.
      </p>
      <div className="mt-[18px] rounded-lg border border-signal/30 bg-signal/6 px-4 py-[13px] text-[12.5px] leading-[1.55] text-cream-soft">
        <strong className="font-medium text-signal">Know your password.</strong> Getting back in
        requires the master password, or the recovery phrase. There is no other door.
      </div>
      <div className="mt-[26px] flex gap-[10px]">
        <button type="button" onClick={onClose} className={CANCEL_BTN}>
          Stay
        </button>
        <button type="button" onClick={handleSignOut} className={SAVE_BTN_RED}>
          Sign out
        </button>
      </div>
    </Modal>
  );
}
