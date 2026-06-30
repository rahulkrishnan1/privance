/**
 * Shared input-validation rules used across auth screens.
 *
 * Username and password limits are client-side; the server is permissive
 * (non-empty string) by design so we control UX here.
 */

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 32;
const USERNAME_CHARSET = /^[a-z0-9._-]+$/;

export const PASSWORD_MIN = 12;
// 256 bytes is well above any human-typed password and well below the argon2id
// pathological-input range. Anything longer is either abuse or a paste error.
export const PASSWORD_MAX = 256;

export function validateUsername(raw: string): string | undefined {
  const v = raw.trim().toLowerCase();
  if (v.length === 0) return "Username is required.";
  if (v.length < USERNAME_MIN) return `Username must be at least ${USERNAME_MIN} characters.`;
  if (v.length > USERNAME_MAX) return `Username must be ${USERNAME_MAX} characters or fewer.`;
  if (!USERNAME_CHARSET.test(v))
    return "Username may only contain letters, digits, dots, underscores, or dashes.";
  return undefined;
}

export function validatePassword(raw: string): string | undefined {
  if (raw.length < PASSWORD_MIN)
    return `Master password must be at least ${PASSWORD_MIN} characters.`;
  if (raw.length > PASSWORD_MAX)
    return `Master password must be ${PASSWORD_MAX} characters or fewer.`;
  return undefined;
}
