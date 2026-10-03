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
          Clears this device. You&rsquo;ll need your master password or recovery phrase to get back
          in.
        </p>
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
