/**
 * Local storage types for the ciphertext envelope layer.
 *
 * The storage layer is deliberately opaque: it stores and retrieves
 * raw bytes without inspecting ciphertext or nonces. All crypto is
 * handled by calling code.
 */

export type StoredObject = {
  kind: string;
  objectId: string;
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  version: bigint;
  /** null until the server has confirmed the write. */
  serverSeq: bigint | null;
  tombstone: boolean;
  /** Unix epoch milliseconds. */
  updatedAt: number;
};

export type PutObjectInput = {
  kind: string;
  objectId: string;
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  version: bigint;
  serverSeq?: bigint | null;
  tombstone?: boolean;
  updatedAt?: number;
};

/** An item in the outbound sync queue, not yet confirmed by the server. */
export type OutboundItem = {
  /** Stable local ID for this queue entry (used by ackQueueItem). */
  id: string;
  kind: string;
  objectId: string;
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  /**
   * The new version the client is asserting for this write.
   * For a create this is 1n; for an update this is the previous confirmed
   * version plus one.
   */
  version: bigint;
  /**
   * The version the client believes the server currently holds.
   * Undefined for a brand-new object (server has no prior version).
   * Sent as `prev_version` in the batch PUT wire body so the server can
   * detect concurrent modifications and return 409.
   */
  prevVersion: bigint | undefined;
  tombstone: boolean;
  enqueuedAt: number;
};

export type EnqueueInput = Omit<OutboundItem, "id" | "enqueuedAt"> & {
  id?: string;
};

/** Metadata returned by the server for one exact queued revision. */
export type QueueConfirmation = { version: bigint; serverSeq: bigint };

export type StorageMode = "opfs" | "memory";

/**
 * Thin adapter interface that abstracts local SQLite access.
 * Web implementation uses SAHPool VFS; native is a stub for v1.
 */
export interface LocalStore {
  /** Initialized backing mode. Throws before init or after close/destroy. */
  readonly mode: StorageMode;

  /** Run DDL and prepare the database for use. Idempotent. */
  init(): Promise<void>;

  /** Upsert a ciphertext envelope. */
  put(input: PutObjectInput): Promise<void>;

  /** Atomically store an unconfirmed envelope and its exact outbound entry. */
  putAndEnqueue(input: EnqueueInput): Promise<string>;

  /** Apply remote data only if no intent for this server objectId is queued, atomically. */
  applyRemote(input: PutObjectInput): Promise<boolean>;

  /** Retrieve a single object, or null if absent. */
  get(input: { kind: string; objectId: string }): Promise<StoredObject | null>;

  /** List all objects of a given kind, ordered by objectId. */
  list(input: { kind: string }): Promise<StoredObject[]>;

  /** Hard-delete a local record (does not create a tombstone). */
  delete(input: { kind: string; objectId: string }): Promise<void>;

  /** Get the last server_seq watermark, or null if never synced. */
  getCursor(): Promise<bigint | null>;

  /** Persist a new server_seq watermark. */
  setCursor(seq: bigint): Promise<void>;

  /** Add an item to the outbound sync queue. */
  enqueue(item: EnqueueInput): Promise<void>;

  /** Return all pending queue items (not yet acked), oldest first. */
  drainQueue(): Promise<OutboundItem[]>;

  /**
   * Atomically remove this exact queue ID and optionally confirm its stored metadata.
   * Confirmation never replaces ciphertext, and updates metadata only if the entry
   * still matches the current unconfirmed envelope and no later intent for its objectId exists.
   * A replacement must match the captured entry's kind and objectId. In the same
   * transaction, apply it only if no intent remains for that objectId. If the ID
   * is already absent, do nothing; a failed replacement retains the entry and object.
   * Without confirmation or replacement, only removes the queue item.
   */
  ackQueueItem(
    id: string,
    confirmed?: QueueConfirmation,
    replacement?: PutObjectInput,
  ): Promise<void>;

  /** Close the underlying database handle. */
  close(): Promise<void>;

  /**
   * Wipe the entire local database.
   * Used on logout or when re-authenticating from another device.
   */
  destroy(): Promise<void>;
}

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageError";
  }
}

export class StorageNotInitializedError extends StorageError {
  constructor() {
    super("LocalStore.init() must be called before use");
    this.name = "StorageNotInitializedError";
  }
}
