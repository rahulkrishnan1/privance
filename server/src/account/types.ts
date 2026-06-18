export class AccountError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AccountError";
    this.code = code;
  }
}

export class InvalidPasswordError extends AccountError {
  constructor(message = "invalid credentials") {
    super("invalid_credentials", message);
    this.name = "InvalidPasswordError";
  }
}

export type DestroyResult = {
  userId: string;
};
