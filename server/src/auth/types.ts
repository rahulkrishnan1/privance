export class AuthError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}

export class InvalidCredentialsError extends AuthError {
  constructor(message = "invalid credentials") {
    super("invalid_credentials", message);
    this.name = "InvalidCredentialsError";
  }
}

export class UnauthenticatedError extends AuthError {
  constructor(message = "unauthenticated") {
    super("unauthenticated", message);
    this.name = "UnauthenticatedError";
  }
}

export class UsernameTakenError extends AuthError {
  constructor(message = "username already in use") {
    super("username_taken", message);
    this.name = "UsernameTakenError";
  }
}

export class AllowlistDeniedError extends AuthError {
  constructor(message = "signup not allowed") {
    super("signup_not_allowed", message);
    this.name = "AllowlistDeniedError";
  }
}

export class InvalidInviteError extends AuthError {
  constructor(message = "invite required or invalid") {
    super("invalid_invite", message);
    this.name = "InvalidInviteError";
  }
}

export class RateLimitedError extends AuthError {
  constructor(message = "too many attempts") {
    super("rate_limited", message);
    this.name = "RateLimitedError";
  }
}

export class SessionExpiredError extends AuthError {
  constructor(message = "session expired") {
    super("session_expired", message);
    this.name = "SessionExpiredError";
  }
}

export class RecoveryFailedError extends AuthError {
  constructor(message = "recovery proof invalid") {
    super("recovery_invalid", message);
    this.name = "RecoveryFailedError";
  }
}

export const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export type KdfParamsJson = {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
  hashLength: number;
};

export type SignupResult = {
  userId: string;
  token: string;
  expiresAt: Date;
};

export type LoginResult = {
  userId: string;
  token: string;
  expiresAt: Date;
  wrappedDek: Buffer;
  wrappedDekIv: Buffer;
};

export type RecoveryResult = {
  userId: string;
  token: string;
  expiresAt: Date;
};

export type PasswordChangeResult = {
  token: string;
  expiresAt: Date;
};

export type AuthenticatedSession = {
  userId: string;
  sessionId: string;
  expiresAt: Date;
};
