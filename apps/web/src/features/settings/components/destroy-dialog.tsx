"use client";

import { useState } from "react";
import { Modal } from "@/components/index";
import * as accountApi from "@/lib/api/account";
import * as authApi from "@/lib/api/auth";
import { ApiError } from "@/lib/api/client";
import { deriveLoginCrypto } from "@/lib/auth-crypto";
import { hardRedirect } from "@/lib/navigate";
import { CANCEL_BTN, FIELD_INPUT, FIELD_LABEL, SAVE_BTN_RED } from "../types";
import { DialogHeader } from "./_primitives";

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
    hardRedirect("/auth/login/");
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      labelledBy="destroy-title"
      className="border-[rgba(208,133,98,0.4)]"
    >
      <DialogHeader title="Destroy vault" titleId="destroy-title" onClose={handleClose} danger />
      <p className="text-[13.5px] leading-[1.6] text-cream-soft">
        Every ciphertext record is erased from the server and this device. There is no backup, no
        grace period, no undo. This is the whole point of Privance, which is why we make you type
        it.
      </p>

      <form onSubmit={(e) => void onDestroy(e)} noValidate>
        <div className="mt-4">
          <label htmlFor="dv-username" className={FIELD_LABEL}>
            Type your username to arm
          </label>
          <input
            id="dv-username"
            type="text"
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder={username ?? ""}
            className={FIELD_INPUT}
          />
        </div>
        <div className="mt-4">
          <label htmlFor="dv-password" className={FIELD_LABEL}>
            Master password
          </label>
          <input
            id="dv-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className={FIELD_INPUT}
          />
        </div>

        {error && (
          <p role="alert" className="mt-4 font-mono text-[12px] text-signal">
            {error}
          </p>
        )}

        <div className="mt-[26px] flex gap-[10px]">
          <button type="button" onClick={handleClose} className={CANCEL_BTN}>
            Keep my vault
          </button>
          <button
            type="submit"
            disabled={!armed || pending}
            aria-busy={pending}
            className={SAVE_BTN_RED}
          >
            {pending ? "Destroying…" : "Destroy forever"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
