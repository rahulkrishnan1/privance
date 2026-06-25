"use client";

import { useState } from "react";
import { PasswordStrength } from "@/components/auth/PasswordStrength";
import { Modal } from "@/components/index";
import * as authApi from "@/lib/api/auth";
import { ApiError } from "@/lib/api/client";
import { deriveLoginCrypto, deriveNewCredsAfterRecovery } from "@/lib/auth-crypto";
import { validatePassword } from "@/lib/validation";
import { readItemsKey } from "@/providers/auth-context";
import { CANCEL_BTN, FIELD_INPUT, FIELD_LABEL, SAVE_BTN } from "../types";
import { DialogHeader, PhraseGrid } from "./_primitives";

export function ChangePasswordDialog({
  open,
  onClose,
  username,
}: {
  open: boolean;
  onClose: () => void;
  username: string | undefined;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newPhrase, setNewPhrase] = useState<string | null>(null);

  function reset() {
    setCurrent("");
    setNext("");
    setPending(false);
    setError(null);
    setNewPhrase(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending || !username) return;
    setError(null);

    const itemsKey = readItemsKey();
    if (!itemsKey) {
      setError("Lock and unlock first.");
      return;
    }

    const passwordError = validatePassword(next);
    if (passwordError !== undefined) {
      setError(passwordError);
      return;
    }

    setPending(true);
    try {
      const params = await authApi.kdfParams(username);
      const currentCreds = await deriveLoginCrypto({
        password: current,
        kdfSalt: params.kdf_salt,
      });

      const newCreds = await deriveNewCredsAfterRecovery({ newPassword: next, itemsKey });

      await authApi.passwordChange({
        current_auth_hash: currentCreds.authHash,
        new_auth_hash: newCreds.newAuthHash,
        new_kdf_salt: newCreds.newKdfSalt,
        new_kdf_params: newCreds.newKdfParams,
        new_recovery_blob: newCreds.newRecoveryBlob,
        new_recovery_salt: newCreds.newRecoverySalt,
        new_recovery_params: newCreds.newRecoveryParams,
        new_wrapped_dek: newCreds.newWrappedDek,
        new_wrapped_dek_iv: newCreds.newWrappedDekIv,
        new_wrapped_dek_recovery: newCreds.newWrappedDekRecovery,
        new_wrapped_dek_recovery_iv: newCreds.newWrappedDekRecoveryIv,
      });

      setNewPhrase(newCreds.newPhrase);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError("Current password is incorrect.");
      } else {
        setError("Could not change your password. Try again.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal open={open} onClose={handleClose} labelledBy="change-password-title">
      {newPhrase === null ? (
        <form onSubmit={(e) => void onSubmit(e)} noValidate>
          <DialogHeader
            title="Change master password"
            titleId="change-password-title"
            onClose={handleClose}
          />
          <div className="mt-4">
            <label htmlFor="cp-current" className={FIELD_LABEL}>
              Current password
            </label>
            <input
              id="cp-current"
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
              className={FIELD_INPUT}
            />
          </div>
          <div className="mt-4">
            <label htmlFor="cp-new" className={FIELD_LABEL}>
              New password
            </label>
            <input
              id="cp-new"
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
              placeholder="long and memorable beats short and clever"
              className={FIELD_INPUT}
            />
            <PasswordStrength password={next} />
          </div>

          {error && (
            <p role="alert" className="mt-4 font-mono text-xs text-signal">
              {error}
            </p>
          )}

          <div className="mt-[26px] flex gap-[10px]">
            <button type="button" onClick={handleClose} className={CANCEL_BTN}>
              Cancel
            </button>
            <button type="submit" disabled={pending} aria-busy={pending} className={SAVE_BTN}>
              {pending ? "Changing…" : "Change password"}
            </button>
          </div>
        </form>
      ) : (
        <div>
          <DialogHeader
            title="Save your new phrase"
            titleId="change-password-title"
            onClose={handleClose}
          />
          <p className="text-sm leading-[1.6] text-cream-soft">
            Your password changed, and that replaced your recovery phrase. The old twelve words can
            never open this vault again. Write these down before you close.
          </p>
          <PhraseGrid phrase={newPhrase} />
          <div className="mt-[26px] flex">
            <button type="button" onClick={handleClose} className={SAVE_BTN}>
              I saved the new phrase
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
