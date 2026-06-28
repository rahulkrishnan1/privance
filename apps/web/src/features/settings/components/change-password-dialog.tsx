"use client";

import { useState } from "react";
import { Button } from "@/components";
import { PasswordStrength } from "@/components/auth/PasswordStrength";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import * as authApi from "@/lib/api/auth";
import { ApiError } from "@/lib/api/client";
import { deriveLoginCrypto, deriveNewCredsAfterRecovery } from "@/lib/auth-crypto";
import { validatePassword } from "@/lib/validation";
import { readItemsKey } from "@/providers/auth-context";
import { PhraseGrid, SettingsDialogHeader } from "./_primitives";

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
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) handleClose();
      }}
    >
      <DialogContent
        aria-labelledby="change-password-title"
        onEscapeKeyDown={(e) => {
          if (newPhrase !== null || pending) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (newPhrase !== null || pending) e.preventDefault();
        }}
      >
        {newPhrase === null ? (
          <form onSubmit={(e) => void onSubmit(e)} noValidate>
            <SettingsDialogHeader
              title="Change master password"
              titleId="change-password-title"
              onClose={handleClose}
            />
            <div className="mt-4 flex flex-col gap-2">
              <Label htmlFor="cp-current">Current password</Label>
              <Input
                id="cp-current"
                type="password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <div className="mt-4 flex flex-col gap-2">
              <Label htmlFor="cp-new">New password</Label>
              <Input
                id="cp-new"
                type="password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                autoComplete="new-password"
                placeholder="long and memorable beats short and clever"
              />
              <PasswordStrength password={next} />
            </div>

            {error && (
              <p role="alert" className="mt-4 font-mono text-xs text-signal">
                {error}
              </p>
            )}

            <DialogFooter className="mt-[26px]">
              <Button type="button" variant="secondary" onClick={handleClose}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={pending}>
                {pending ? "Changing…" : "Change password"}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div>
            <SettingsDialogHeader
              title="Save your new phrase"
              titleId="change-password-title"
              onClose={handleClose}
            />
            <p className="text-sm leading-[1.6] text-dim">
              Your password changed, and that replaced your recovery phrase. The old twelve words
              can never open this vault again. Write these down before you close.
            </p>
            <PhraseGrid phrase={newPhrase} />
            <DialogFooter className="mt-[26px]">
              <Button type="button" variant="primary" onClick={handleClose}>
                I saved the new phrase
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
