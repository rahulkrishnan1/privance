"use client";

import { Button } from "@/components";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import type { BiometricMessage, BiometricPhase } from "../types";
import { SettingsDialogHeader } from "./_primitives";

export function BiometricDialog({
  open,
  onClose,
  phase,
  message,
  onEnroll,
  onDisable,
}: {
  open: boolean;
  onClose: () => void;
  phase: BiometricPhase;
  message: BiometricMessage | null;
  onEnroll: () => Promise<void>;
  onDisable: () => Promise<void>;
}) {
  const enrolled = phase === "enrolled" || phase === "disabling";
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent aria-labelledby="biometric-title">
        <SettingsDialogHeader
          title="Biometric unlock"
          titleId="biometric-title"
          onClose={onClose}
        />
        {enrolled ? (
          <p className="text-sm leading-[1.6] text-dim">
            Face ID or Touch ID opens the vault on this device. The master password is still
            demanded every 14 days, so it never fades from memory.
          </p>
        ) : (
          <p className="text-sm leading-[1.6] text-dim">
            Enable Face ID or Touch ID to unlock without typing the master password. Your OS will
            prompt for the gesture.
          </p>
        )}

        {message && (
          <div className="mt-4 flex flex-col gap-2">
            {message.kind === "cancelled" && (
              <p role="alert" className="font-mono text-xs text-signal">
                Enrollment was cancelled.
              </p>
            )}
            {message.kind === "unsupported" && (
              <p role="alert" className="font-mono text-xs text-signal">
                This device does not support biometric unlock.
              </p>
            )}
            {message.kind === "other" && (
              <p role="alert" className="font-mono text-xs text-signal">
                {message.text}
              </p>
            )}
            {message.kind === "save-failed-with-orphan" && (
              <p role="alert" className="font-mono text-xs text-signal">
                Enrollment failed to save. A passkey was created and may appear in your OS passkey
                manager. You can remove it there.
              </p>
            )}
            {(message.kind === "os-passkey-notice" ||
              message.kind === "save-failed-with-orphan" ||
              message.kind === "unsupported") && (
              <p className="font-mono text-xs text-faint">
                The associated passkey remains in your device credential manager. You can remove it
                from your OS settings.
              </p>
            )}
          </div>
        )}

        <DialogFooter className="mt-[26px]">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {enrolled ? (
            <Button
              variant="danger"
              onClick={() => void onDisable()}
              loading={phase === "disabling"}
              aria-label="Disable biometric unlock"
            >
              {phase === "disabling" ? "Disabling…" : "Disable"}
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => void onEnroll()}
              loading={phase === "enrolling"}
              aria-label="Enable biometric unlock"
            >
              {phase === "enrolling" ? "Enabling…" : "Enable"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
