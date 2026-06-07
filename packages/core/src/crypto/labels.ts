export const LABEL_VERSION = 1 as const;

export const LABELS = {
  AUTH: "finance/auth-v1",
  KEK: "finance/kek-v1",
  RECOVERY: "finance/recovery-v1",
  BIOMETRIC: "finance/biometric-v1",
} as const;

export type LabelKey = keyof typeof LABELS;
