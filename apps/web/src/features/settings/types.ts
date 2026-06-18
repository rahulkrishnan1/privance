// "enrolled" = record exists and cadence is fresh (loadEnrollment returned non-null)
// "not-enrolled" = no record or cadence expired
// "enrolling" / "disabling" = operation in-flight
// "checking" = initial async check not yet complete
// "unsupported" = device cannot support biometric unlock
export type BiometricPhase =
  | "checking"
  | "unsupported"
  | "not-enrolled"
  | "enrolled"
  | "enrolling"
  | "disabling";

export type BiometricMessage =
  | { kind: "cancelled" }
  | { kind: "unsupported" }
  | { kind: "save-failed-with-orphan" }
  | { kind: "other"; text: string }
  | { kind: "os-passkey-notice" };

export type Dialog = "password" | "biometric" | "phrase" | "signout" | "destroy" | null;

export const FIELD_INPUT =
  "w-full rounded-[8px] border border-line bg-panel-2 px-[14px] py-[13px] font-mono text-[14px] text-cream outline-none transition-colors placeholder:text-faint focus:border-accent-dim";
export const FIELD_LABEL = "mb-2 block font-mono text-[9px] uppercase tracking-[0.22em] text-faint";
export const SAVE_BTN =
  "flex-1 cursor-pointer rounded-[8px] border-0 bg-accent px-[15px] py-[15px] font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-vault transition-colors hover:bg-cream disabled:cursor-not-allowed disabled:opacity-35";
export const SAVE_BTN_RED =
  "flex-1 cursor-pointer rounded-[8px] border-0 bg-down px-[15px] py-[15px] font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-vault transition-colors hover:bg-cream disabled:cursor-not-allowed disabled:opacity-35";
export const CANCEL_BTN =
  "cursor-pointer rounded-[8px] border border-line bg-transparent px-5 py-[15px] font-mono text-[11px] uppercase tracking-[0.14em] text-dim transition-colors hover:text-cream";
