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
