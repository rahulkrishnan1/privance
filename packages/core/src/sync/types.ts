export class SyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncError";
  }
}

export class SyncNetworkError extends SyncError {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "SyncNetworkError";
  }
}

export class SyncNotFoundError extends SyncError {
  constructor(public readonly objectId: string) {
    super(`Object not found: ${objectId}`);
    this.name = "SyncNotFoundError";
  }
}

export class SyncProtocolError extends SyncError {
  constructor(message: string) {
    super(message);
    this.name = "SyncProtocolError";
  }
}

export type SyncClientConfig = {
  serverUrl: string;
  fetch?: typeof fetch;
  csrfHeaderValue?: string;
  /**
   * Called when an individual object in a pull batch cannot be decrypted.
   * The pull cursor stalls one before the failed item so the next pull retries.
   * If omitted, decrypt failures are silently skipped.
   */
  onDecryptError?: (objectId: string, err: unknown) => void;
  /**
   * Called when a background sync tick gets a 401 from the server (session
   * expired). The host app should stop the client and transition to the lock
   * screen. Without this hook the polling loop would hammer the server with
   * dead credentials forever.
   */
  onAuthError?: (status: number) => void;
};

export type PushItemResult =
  | { id: string; ok: true; serverSeq: bigint; version: bigint }
  | { id: string; ok: false; conflict: { currentVersion: bigint } }
  | { id: string; ok: false; error: string };

export type PushResult = {
  results: PushItemResult[];
};

export type PullChangeRecord = {
  id: string;
  kind: string;
  version: bigint;
  serverSeq: bigint;
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  tombstone: boolean;
};

export type PullResult = {
  applied: number;
  nextCursor: bigint | null;
};

export type ConflictChoice =
  | { action: "keep-mine" }
  | { action: "keep-theirs" }
  | { action: "keep-both"; newObjectId: string };

export type ConflictResolutionInput = {
  objectId: string;
  kind: string;
  myPlaintext: Uint8Array;
  theirPlaintext: Uint8Array;
};

export type ConflictResolutionCallback = (
  input: ConflictResolutionInput,
) => Promise<ConflictChoice>;

export type ReconcileInput = {
  objectId: string;
  kind: string;
  choice: ConflictChoice;
  myPlaintext: Uint8Array;
  /**
   * The server's verbatim ciphertext and nonce for this object. keep-theirs and
   * keep-both store these as-is so the local copy is byte-identical to the
   * server's, matching handleConflict; re-encrypting the server's plaintext
   * would mint bytes the server never produced.
   */
  theirCiphertext: Uint8Array;
  theirNonce: Uint8Array;
  theirVersion: bigint;
  /**
   * The server_seq watermark for the server's copy of this object.
   * Required so that keep-theirs and keep-both branches write the correct
   * cursor value rather than using version as a proxy for server_seq.
   */
  theirServerSeq: bigint;
};
