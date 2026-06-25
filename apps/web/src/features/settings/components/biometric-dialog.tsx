"use client";

import { Modal } from "@/components/index";
import type { BiometricMessage, BiometricPhase } from "../types";
import { CANCEL_BTN, SAVE_BTN, SAVE_BTN_RED } from "../types";
import { DialogHeader } from "./_primitives";

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
    <Modal open={open} onClose={onClose} labelledBy="biometric-title">
      <DialogHeader title="Biometric unlock" titleId="biometric-title" onClose={onClose} />
      {enrolled ? (
        <p className="text-sm leading-[1.6] text-cream-soft">
          Face ID or Touch ID opens the vault on this device. The master password is still demanded
          every 14 days, so it never fades from memory.
        </p>
      ) : (
        <p className="text-sm leading-[1.6] text-cream-soft">
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

      <div className="mt-[26px] flex gap-[10px]">
        <button type="button" onClick={onClose} className={CANCEL_BTN}>
          Close
        </button>
        {enrolled ? (
          <button
            type="button"
            onClick={() => void onDisable()}
            disabled={phase === "disabling"}
            className={SAVE_BTN_RED}
          >
            {phase === "disabling" ? "Disabling…" : "Disable biometric unlock"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void onEnroll()}
            disabled={phase === "enrolling"}
            className={SAVE_BTN}
          >
            {phase === "enrolling" ? "Enabling…" : "Enable biometric unlock"}
          </button>
        )}
      </div>
    </Modal>
  );
}
