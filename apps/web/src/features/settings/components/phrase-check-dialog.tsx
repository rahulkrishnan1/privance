"use client";

import { countRecognizedWords, validatePhrase } from "@privance/core";
import { useState } from "react";
import { Button } from "@/components";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import * as authApi from "@/lib/api/auth";
import { DecryptionError, deriveRecoveryUnwrap } from "@/lib/auth-crypto";
import { SettingsDialogHeader } from "./_primitives";

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
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) handleClose();
      }}
    >
      <DialogContent aria-labelledby="phrase-title">
        <SettingsDialogHeader title="Phrase check" titleId="phrase-title" onClose={handleClose} />
        <p className="text-sm leading-[1.6] text-dim">
          Type all twelve words in order to confirm your spare key still works. Nothing leaves this
          device.
        </p>

        <form onSubmit={(e) => void onVerify(e)} noValidate>
          <div className="mt-4 flex flex-col gap-2">
            <Label htmlFor="pc-phrase">Recovery phrase (12 words)</Label>
            <Textarea
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
              className="min-h-[84px] resize-y leading-[1.7]"
            />
            {phrase.trim().length > 0 && result === null && (
              <p
                className={[
                  "font-mono text-xs tracking-[0.04em]",
                  recognized === 12 ? "text-accent-dim" : "text-faint",
                ].join(" ")}
              >
                {recognized} of 12 words recognized
              </p>
            )}
          </div>

          {result === "ok" && (
            <p role="status" className="mt-4 font-mono text-xs text-accent">
              Verified, your recovery phrase still opens the vault.
            </p>
          )}
          {result === "fail" && (
            <p role="alert" className="mt-4 font-mono text-xs text-signal">
              That phrase doesn&rsquo;t match. Check the words and spacing.
            </p>
          )}
          {result === "error" && (
            <p role="alert" className="mt-4 font-mono text-xs text-signal">
              Couldn&rsquo;t run the check. Try again.
            </p>
          )}

          <DialogFooter className="mt-[26px]">
            <Button type="button" variant="secondary" onClick={handleClose}>
              {result === "ok" ? "Done" : "Later"}
            </Button>
            <Button type="submit" variant="primary" loading={pending}>
              {pending ? "Verifying…" : "Verify"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
