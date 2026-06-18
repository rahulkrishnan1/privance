export class SyncError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SyncError";
    this.code = code;
  }
}

export class ConflictError extends SyncError {
  constructor(
    public readonly objectId: string,
    public readonly currentVersion: bigint,
  ) {
    super("conflict", `Conflict on object ${objectId}: current version is ${currentVersion}`);
    this.name = "ConflictError";
  }
}

export class NotFoundError extends SyncError {
  constructor(public readonly objectId: string) {
    super("not_found", `Object not found: ${objectId}`);
    this.name = "NotFoundError";
  }
}

export type SyncObject = {
  userId: string;
  objectId: string;
  kind: string;
  ciphertext: Buffer;
  nonce: Buffer;
  version: bigint;
  serverSeq: bigint;
  updatedAt: Date;
  tombstone: boolean;
};

export type PutInput = {
  userId: string;
  objectId: string;
  kind: string;
  ciphertext: Buffer;
  nonce: Buffer;
  version: bigint;
  prevVersion?: bigint;
};

export type PutResult = {
  serverSeq: bigint;
  version: bigint;
};

export type GetResult = {
  objectId: string;
  kind: string;
  ciphertext: Buffer;
  nonce: Buffer;
  version: bigint;
  serverSeq: bigint;
  tombstone: boolean;
};

export type ChangesQuery = {
  userId: string;
  since: bigint;
  limit: number;
};

export type ChangeRecord = {
  id: string;
  kind: string;
  version: bigint;
  serverSeq: bigint;
  ciphertext: Buffer;
  nonce: Buffer;
  tombstone: boolean;
};

export type ChangesResult = {
  changes: ChangeRecord[];
  next: bigint | null;
};

export type DeleteInput = {
  userId: string;
  objectId: string;
  prevVersion: bigint;
};

export type BatchPutItem = {
  objectId: string;
  kind: string;
  ciphertext: Buffer;
  nonce: Buffer;
  version: bigint;
  prevVersion?: bigint;
};

export type BatchDeleteItem = {
  objectId: string;
  prevVersion: bigint;
};

export type BatchInput = {
  userId: string;
  puts: BatchPutItem[];
  deletes: BatchDeleteItem[];
};

export type BatchResultItem =
  | { id: string; ok: true; serverSeq: bigint; version: bigint }
  | { id: string; ok: false; conflict: { currentVersion: bigint } }
  | { id: string; ok: false; error: string };

export type BatchResult = {
  results: BatchResultItem[];
};
