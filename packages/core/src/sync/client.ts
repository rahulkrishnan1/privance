import type { LocalStore } from "../storage/types.js";
import { pullChanges } from "./pull.js";
import { pushPending } from "./push.js";
import { applyReconcile } from "./reconcile.js";
import {
  type ConflictResolutionCallback,
  type PullResult,
  type PushResult,
  type ReconcileInput,
  type SyncClientConfig,
  SyncNetworkError,
} from "./types.js";

type EncryptFn = (input: {
  plaintext: Uint8Array;
  objectId: string;
  kind: string;
}) => Promise<{ ciphertext: Uint8Array; nonce: Uint8Array }>;

type DecryptFn = (input: {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  objectId: string;
  kind: string;
}) => Promise<Uint8Array>;

export interface SyncClient {
  pushPending(): Promise<PushResult>;
  /** Fetch one page of changes (up to 100 records) from the server. */
  pullChanges(): Promise<PullResult>;
  /**
   * Drain all pages of changes from the server, following `nextCursor` until
   * the server signals there are no more records. Use this for the initial
   * pull on session start to avoid missing high-seq objects when many records
   * have accumulated.
   */
  drainAllChanges(opts?: { maxPages?: number }): Promise<{ totalApplied: number }>;
  reconcile(input: ReconcileInput): Promise<void>;
  onConflict(handler: ConflictResolutionCallback): void;
  start(opts?: { pollIntervalMs?: number }): void;
  stop(): void;
}

const DEFAULT_POLL_INTERVAL_MS = 30_000;

class SyncClientImpl implements SyncClient {
  private conflictHandler: ConflictResolutionCallback | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private tickInProgress = false;

  constructor(
    private readonly config: SyncClientConfig,
    private readonly store: LocalStore,
    private readonly encryptEnvelope: EncryptFn,
    private readonly decryptEnvelope: DecryptFn,
  ) {}

  onConflict(handler: ConflictResolutionCallback): void {
    this.conflictHandler = handler;
  }

  async pushPending(): Promise<PushResult> {
    return pushPending({
      config: this.config,
      store: this.store,
      encryptEnvelope: this.encryptEnvelope,
      decryptEnvelope: this.decryptEnvelope,
      onConflict: this.conflictHandler,
    });
  }

  async pullChanges(): Promise<PullResult> {
    return pullChanges({
      config: this.config,
      store: this.store,
      decryptEnvelope: this.decryptEnvelope,
    });
  }

  async drainAllChanges(opts?: { maxPages?: number }): Promise<{ totalApplied: number }> {
    let totalApplied = 0;
    let result: PullResult;
    let pages = 0;
    // Hard cap so a buggy or hostile server can't pin the network + SQLite
    // worker forever. At limit=100 changes per page this still covers ~100k
    // records in a single drain.
    const maxPages = opts?.maxPages ?? 1000;
    do {
      result = await pullChanges({
        config: this.config,
        store: this.store,
        decryptEnvelope: this.decryptEnvelope,
      });
      totalApplied += result.applied;
      pages++;
      if (pages >= maxPages) break;
    } while (result.nextCursor !== null);
    return { totalApplied };
  }

  async reconcile(input: ReconcileInput): Promise<void> {
    return applyReconcile(input, {
      config: this.config,
      store: this.store,
      encryptEnvelope: this.encryptEnvelope,
    });
  }

  start(opts?: { pollIntervalMs?: number }): void {
    if (this.running) return;
    this.running = true;
    const interval = opts?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

    const tick = async (): Promise<void> => {
      if (this.tickInProgress) return;
      this.tickInProgress = true;
      try {
        await this.pushPending();
        await this.pullChanges();
      } catch (err) {
        // 401 from any background call means the session is gone. Surface to
        // the host so it can stop the client and transition to the lock screen
        // instead of hammering the server with dead credentials.
        if (
          err instanceof SyncNetworkError &&
          (err.status === 401 || err.status === 403) &&
          this.config.onAuthError !== undefined
        ) {
          this.config.onAuthError(err.status);
          this.stop();
        }
        // Other background sync errors are silenced; callers use pushPending /
        // pullChanges directly for error surfacing. Retries on the next tick.
      } finally {
        this.tickInProgress = false;
      }
    };

    void tick();
    this.pollTimer = setInterval(() => void tick(), interval);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}

export function createSyncClient(opts: {
  config: SyncClientConfig;
  store: LocalStore;
  encryptEnvelope: EncryptFn;
  decryptEnvelope: DecryptFn;
}): SyncClient {
  return new SyncClientImpl(opts.config, opts.store, opts.encryptEnvelope, opts.decryptEnvelope);
}
