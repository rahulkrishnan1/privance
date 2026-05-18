import { apiFetch } from "./client";

// ---------------------------------------------------------------------------
// Wire types, mirror server/src/auth/wire.ts exactly
// ---------------------------------------------------------------------------

export type KdfParams = {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
  hashLength: number;
};

export type KdfParamsResponse = {
  kdf_algo: "argon2id";
  kdf_params: KdfParams;
  kdf_salt: string; // base64
};

export type SignupRequest = {
  username: string;
  auth_hash: string; // base64
  kdf_salt: string; // base64
  kdf_params: KdfParams;
  recovery_blob: string; // base64
  recovery_salt: string; // base64
  recovery_params: KdfParams;
  wrapped_dek: string; // base64
  wrapped_dek_iv: string; // base64
  wrapped_dek_recovery: string; // base64
  wrapped_dek_recovery_iv: string; // base64
};

export type SignupResponse = {
  user_id: string;
};

export type LoginRequest = {
  username: string;
  auth_hash: string; // base64
};

export type LoginResponse = {
  user_id: string;
  wrapped_dek: string; // base64
  wrapped_dek_iv: string; // base64
};

export type LogoutResponse = {
  status: "ok";
};

export type SessionResponse = {
  user_id: string;
  expires_at: string; // ISO-8601
};

export type RecoveryDeriveParamsRequest = {
  username: string;
};

export type RecoveryDeriveParamsResponse = {
  kdf_algo: "argon2id";
  kdf_params: KdfParams;
  kdf_salt: string; // base64
  recovery_blob: string; // base64
  recovery_salt: string; // base64
  recovery_params: KdfParams;
  wrapped_dek_recovery: string; // base64
  wrapped_dek_recovery_iv: string; // base64
};

export type RecoveryResetRequest = {
  username: string;
  recovery_proof: string; // base64
  new_auth_hash: string; // base64
  new_kdf_salt: string; // base64
  new_kdf_params: KdfParams;
  new_recovery_blob: string; // base64
  new_recovery_salt: string; // base64
  new_recovery_params: KdfParams;
  new_wrapped_dek: string; // base64
  new_wrapped_dek_iv: string; // base64
  new_wrapped_dek_recovery: string; // base64
  new_wrapped_dek_recovery_iv: string; // base64
};

export type RecoveryResetResponse = {
  user_id: string;
};

export type PasswordChangeRequest = {
  new_auth_hash: string; // base64
  new_kdf_salt: string; // base64
  new_kdf_params: KdfParams;
  new_recovery_blob: string; // base64
  new_recovery_salt: string; // base64
  new_recovery_params: KdfParams;
  new_wrapped_dek: string; // base64
  new_wrapped_dek_iv: string; // base64
  new_wrapped_dek_recovery: string; // base64
  new_wrapped_dek_recovery_iv: string; // base64
};

// ---------------------------------------------------------------------------
// Typed wrappers
// ---------------------------------------------------------------------------

export async function kdfParams(username: string): Promise<KdfParamsResponse> {
  const res = await apiFetch("/api/auth/kdf-params", {
    method: "POST",
    body: JSON.stringify({ username }),
  });
  return res.json() as Promise<KdfParamsResponse>;
}

export async function signup(payload: SignupRequest): Promise<SignupResponse> {
  const res = await apiFetch("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return res.json() as Promise<SignupResponse>;
}

export async function login(payload: LoginRequest): Promise<LoginResponse> {
  const res = await apiFetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return res.json() as Promise<LoginResponse>;
}

export async function logout(): Promise<LogoutResponse> {
  const res = await apiFetch("/api/auth/logout", { method: "POST" });
  return res.json() as Promise<LogoutResponse>;
}

export async function session(): Promise<SessionResponse> {
  const res = await apiFetch("/api/auth/session");
  return res.json() as Promise<SessionResponse>;
}

export async function recoveryDeriveParams(
  username: string,
): Promise<RecoveryDeriveParamsResponse> {
  const res = await apiFetch("/api/auth/recovery/derive-params", {
    method: "POST",
    body: JSON.stringify({ username } satisfies RecoveryDeriveParamsRequest),
  });
  return res.json() as Promise<RecoveryDeriveParamsResponse>;
}

export async function recoveryReset(payload: RecoveryResetRequest): Promise<RecoveryResetResponse> {
  const res = await apiFetch("/api/auth/recovery/reset", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return res.json() as Promise<RecoveryResetResponse>;
}

export async function passwordChange(payload: PasswordChangeRequest): Promise<void> {
  await apiFetch("/api/auth/password/change", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
