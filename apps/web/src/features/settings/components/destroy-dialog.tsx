"use client";

import { useState } from "react";
import { Button } from "@/components";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import * as accountApi from "@/lib/api/account";
import * as authApi from "@/lib/api/auth";
import { ApiError } from "@/lib/api/client";
import { deriveLoginCrypto } from "@/lib/auth-crypto";
import { hardRedirect } from "@/lib/navigate";
import { SettingsDialogHeader } from "./_primitives";

export function DestroyDialog({
  open,
  onClose,
  username,
  onDestroyed,
}: {
  open: boolean;
  onClose: () => void;
  username: string | undefined;
  onDestroyed: () => Promise<void>;
}) {
  const [confirmName, setConfirmName] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const armed = username !== undefined && confirmName.trim() === username && password.length > 0;

  function reset() {
    setConfirmName("");
    setPassword("");
    setPending(false);
    setError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function onDestroy(e: React.FormEvent) {
    e.preventDefault();
    if (pending || !armed || !username) return;
    setError(null);
    setPending(true);
    try {
      const params = await authApi.kdfParams(username);
      const creds = await deriveLoginCrypto({
        password,
        kdfSalt: params.kdf_salt,
      });
      await accountApi.destroy({ current_auth_hash: creds.authHash });
    } catch (err) {
      setPending(false);
      if (err instanceof ApiError && err.status === 401) {
        setError("Password is incorrect.");
      } else {
        setError("Could not destroy the vault. Try again.");
      }
      return;
    }

    // Server committed and cleared the cookie: the vault is gone. Local cleanup
    // (OPFS wipe + DEK clear) is best-effort, since it can throw on
    // OPFS-disabled hosts; the hard reload below wipes JS memory regardless.
    await onDestroyed().catch(() => {});
    hardRedirect("/auth/login");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) handleClose();
      }}
    >
      <DialogContent aria-labelledby="destroy-title" className="border-down/40">
        <SettingsDialogHeader
          title="Destroy vault"
          titleId="destroy-title"
          onClose={handleClose}
          danger
        />
        <p className="text-sm leading-[1.6] text-dim">
          Erases every record from the server and this device. No backup, no undo. That's the point
          of Privance, so we make you type it.
        </p>

        <form onSubmit={(e) => void onDestroy(e)} noValidate>
          <div className="mt-4 flex flex-col gap-2">
            <Label htmlFor="dv-username">Type your username to arm</Label>
            <Input
              id="dv-username"
              type="text"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder={username ?? ""}
            />
          </div>
          <div className="mt-4 flex flex-col gap-2">
            <Label htmlFor="dv-password">Master password</Label>
            <Input
              id="dv-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>

          {error && (
            <p role="alert" className="mt-4 font-mono text-xs text-signal">
              {error}
            </p>
          )}

          <DialogFooter className="mt-[26px]">
            <Button type="button" variant="secondary" onClick={handleClose}>
              Keep my vault
            </Button>
            <Button type="submit" variant="danger" disabled={!armed} loading={pending}>
              {pending ? "Destroying…" : "Destroy forever"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
