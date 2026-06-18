"use client";

import { countRecognizedWords, validatePhrase } from "@privance/core";
import { useState } from "react";
import { Modal } from "@/components/index";
import * as authApi from "@/lib/api/auth";
import { DecryptionError, deriveRecoveryUnwrap } from "@/lib/auth-crypto";
import { CANCEL_BTN, FIELD_INPUT, FIELD_LABEL, SAVE_BTN } from "../types";
import { DialogHeader } from "./_primitives";

export function PhraseCheckDialog({
  open,
  onClose,
  username,
}: {
  open: boolean;
  onClose: () => void;
  username: string | undefined;
}) {
  const [phrase, setPhrase] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<"ok" | "fail" | "error" | null>(null);

  const recognized = countRecognizedWords(phrase);
  const normalized = phrase.trim().toLowerCase().replace(/\s+/g, " ");

  function reset() {
    setPhrase("");
    setPending(false);
    setResult(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function onVerify(e: React.FormEvent) {
    e.preventDefault();
    if (pending || !username) return;
    setResult(null);

    if (!validatePhrase(normalized)) {
      setResult("fail");
      return;
    }

    setPending(true);
    try {
      const params = await authApi.recoveryDeriveParams(username);
      await deriveRecoveryUnwrap({
        phrase: normalized,
        recoverySalt: params.recovery_salt,
        wrappedDekRecovery: params.wrapped_dek_recovery,
        wrappedDekRecoveryIv: params.wrapped_dek_recovery_iv,
      });
      setResult("ok");
    } catch (err) {
      if (err instanceof DecryptionError) {
        setResult("fail");
      } else {
        setResult("error");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal open={open} onClose={handleClose} labelledBy="phrase-title">
      <DialogHeader title="Phrase check" titleId="phrase-title" onClose={handleClose} />
      <p className="text-[13.5px] leading-[1.6] text-dim">
        Fetch the paper and type all twelve words, in order, to confirm your spare key is intact.
        Nothing you type leaves this device.
      </p>

      <form onSubmit={(e) => void onVerify(e)} noValidate>
        <div className="mt-4">
          <label htmlFor="pc-phrase" className={FIELD_LABEL}>
            Recovery phrase (12 words)
          </label>
          <textarea
            id="pc-phrase"
            value={phrase}
            onChange={(e) => {
              setResult(null);
              setPhrase(e.target.value);
            }}
            rows={3}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="word word word ..."
            className={`${FIELD_INPUT} min-h-[84px] resize-y leading-[1.7]`}
          />
          {phrase.trim().length > 0 && result === null && (
            <p
              className={[
                "mt-[7px] font-mono text-[10px] tracking-[0.04em]",
                recognized === 12 ? "text-accent-dim" : "text-faint",
              ].join(" ")}
            >
              {recognized} of 12 words recognized
            </p>
          )}
        </div>

        {result === "ok" && (
          <p role="status" className="mt-4 font-mono text-[12px] text-accent">
            Verified, your recovery phrase still opens the vault.
          </p>
        )}
        {result === "fail" && (
          <p role="alert" className="mt-4 font-mono text-[12px] text-signal">
            That phrase doesn&rsquo;t match. Check the words and spacing.
          </p>
        )}
        {result === "error" && (
          <p role="alert" className="mt-4 font-mono text-[12px] text-signal">
            Couldn&rsquo;t run the check. Try again.
          </p>
        )}

        <div className="mt-[26px] flex gap-[10px]">
          <button type="button" onClick={handleClose} className={CANCEL_BTN}>
            {result === "ok" ? "Done" : "Later"}
          </button>
          <button type="submit" disabled={pending} aria-busy={pending} className={SAVE_BTN}>
            {pending ? "Verifying…" : "Verify"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
