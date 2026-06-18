import { z } from "zod";
import { apiFetch, parseJson } from "./client";

// Wire schemas -- mirror server/src/auth/wire.ts exactly.

const KdfParamsSchema = z.object({
  memoryCost: z.number(),
  timeCost: z.number(),
  parallelism: z.number(),
  hashLength: z.number(),
});
export type KdfParams = z.infer<typeof KdfParamsSchema>;

const KdfParamsResponseSchema = z.object({
  kdf_algo: z.literal("argon2id"),
  kdf_params: KdfParamsSchema,
  kdf_salt: z.string(),
});
export type KdfParamsResponse = z.infer<typeof KdfParamsResponseSchema>;

export type SignupRequest = {
  username: string;
  auth_hash: string;
  kdf_salt: string;
  kdf_params: KdfParams;
  recovery_blob: string;
  recovery_salt: string;
  recovery_params: KdfParams;
  wrapped_dek: string;
  wrapped_dek_iv: string;
  wrapped_dek_recovery: string;
  wrapped_dek_recovery_iv: string;
  invite_token?: string;
};

const SignupResponseSchema = z.object({
  user_id: z.string(),
});
export type SignupResponse = z.infer<typeof SignupResponseSchema>;

export type LoginRequest = {
  username: string;
  auth_hash: string;
};

const LoginResponseSchema = z.object({
  user_id: z.string(),
  wrapped_dek: z.string(),
  wrapped_dek_iv: z.string(),
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

const LogoutResponseSchema = z.object({
  status: z.literal("ok"),
});
export type LogoutResponse = z.infer<typeof LogoutResponseSchema>;

const SessionResponseSchema = z.object({
  user_id: z.string(),
  expires_at: z.string(),
});
export type SessionResponse = z.infer<typeof SessionResponseSchema>;

export type RecoveryDeriveParamsRequest = {
  username: string;
};

const RecoveryDeriveParamsResponseSchema = z.object({
  kdf_algo: z.literal("argon2id"),
  kdf_params: KdfParamsSchema,
  kdf_salt: z.string(),
  recovery_blob: z.string(),
  recovery_salt: z.string(),
  recovery_params: KdfParamsSchema,
  wrapped_dek_recovery: z.string(),
  wrapped_dek_recovery_iv: z.string(),
});
export type RecoveryDeriveParamsResponse = z.infer<typeof RecoveryDeriveParamsResponseSchema>;

export type RecoveryResetRequest = {
  username: string;
  recovery_proof: string;
  new_auth_hash: string;
  new_kdf_salt: string;
  new_kdf_params: KdfParams;
  new_recovery_blob: string;
  new_recovery_salt: string;
  new_recovery_params: KdfParams;
  new_wrapped_dek: string;
  new_wrapped_dek_iv: string;
  new_wrapped_dek_recovery: string;
  new_wrapped_dek_recovery_iv: string;
};

const RecoveryResetResponseSchema = z.object({
  user_id: z.string(),
});
export type RecoveryResetResponse = z.infer<typeof RecoveryResetResponseSchema>;

export type PasswordChangeRequest = {
  current_auth_hash: string;
  new_auth_hash: string;
  new_kdf_salt: string;
  new_kdf_params: KdfParams;
  new_recovery_blob: string;
  new_recovery_salt: string;
  new_recovery_params: KdfParams;
  new_wrapped_dek: string;
  new_wrapped_dek_iv: string;
  new_wrapped_dek_recovery: string;
  new_wrapped_dek_recovery_iv: string;
};

export async function kdfParams(username: string): Promise<KdfParamsResponse> {
  const res = await apiFetch("/api/auth/kdf-params", {
    method: "POST",
    body: JSON.stringify({ username }),
  });
  return parseJson(res, KdfParamsResponseSchema);
}

export async function signup(payload: SignupRequest): Promise<SignupResponse> {
  const res = await apiFetch("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return parseJson(res, SignupResponseSchema);
}

export async function login(payload: LoginRequest): Promise<LoginResponse> {
  const res = await apiFetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return parseJson(res, LoginResponseSchema);
}

export async function logout(): Promise<LogoutResponse> {
  const res = await apiFetch("/api/auth/logout", { method: "POST" });
  return parseJson(res, LogoutResponseSchema);
}

export async function session(): Promise<SessionResponse> {
  const res = await apiFetch("/api/auth/session");
  return parseJson(res, SessionResponseSchema);
}

export async function recoveryDeriveParams(
  username: string,
): Promise<RecoveryDeriveParamsResponse> {
  const res = await apiFetch("/api/auth/recovery/derive-params", {
    method: "POST",
    body: JSON.stringify({ username } satisfies RecoveryDeriveParamsRequest),
  });
  return parseJson(res, RecoveryDeriveParamsResponseSchema);
}

export async function recoveryReset(payload: RecoveryResetRequest): Promise<RecoveryResetResponse> {
  const res = await apiFetch("/api/auth/recovery/reset", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return parseJson(res, RecoveryResetResponseSchema);
}

export async function passwordChange(payload: PasswordChangeRequest): Promise<void> {
  await apiFetch("/api/auth/password/change", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
