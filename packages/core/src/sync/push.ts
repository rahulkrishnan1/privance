import type { LocalStore, OutboundItem } from "../storage/types.js";
import { parseBigIntField, parseStringField, toBase64 } from "./envelope.js";
import { handleConflict } from "./reconcile.js";
import type {
  ConflictResolutionCallback,
  PushItemResult,
  PushResult,
  SyncClientConfig,
} from "./types.js";
import { SyncNetworkError, SyncProtocolError } from "./types.js";

const CSRF_HEADER = "X-Requested-With";

// Hoisted so the bundler's static analyzer does not trip on an inline 1n literal.
const BIGINT_ONE = BigInt(1);

type PushDeps = {
  config: SyncClientConfig;
  store: LocalStore;
  encryptEnvelope: (input: {
    plaintext: Uint8Array;
    objectId: string;
    kind: string;
  }) => Promise<{ ciphertext: Uint8Array; nonce: Uint8Array }>;
  decryptEnvelope: (input: {
    ciphertext: Uint8Array;
    nonce: Uint8Array;
    objectId: string;
    kind: string;
  }) => Promise<Uint8Array>;
  onConflict: ConflictResolutionCallback | null;
};

type BatchPutWire = {
  object_id: string;
  kind: string;
  ciphertext: string;
  nonce: string;
  version: string;
  prev_version?: string;
};

type BatchDeleteWire = {
  object_id: string;
  prev_version: string;
};

type BatchResponseItem = {
  id: string;
  ok: boolean;
  server_seq?: string;
  version?: string;
  conflict?: { current_version: string };
  error?: string;
};

function parseBatchResult(raw: unknown): PushItemResult[] {
  if (
    typeof raw !== "object" ||
    raw === null ||
    !Array.isArray((raw as Record<string, unknown>).results)
  ) {
    throw new SyncProtocolError("batch response missing results array");
  }
  const items = (raw as Record<string, unknown[]>).results ?? [];
  return items.map((item) => {
    const r = item as BatchResponseItem;
    if (r.ok) {
      return {
        id: parseStringField(r.id, "id"),
        ok: true as const,
        serverSeq: parseBigIntField(r.server_seq, "server_seq"),
        version: parseBigIntField(r.version, "version"),
      };
    }
    if (r.conflict !== undefined) {
      return {
        id: parseStringField(r.id, "id"),
        ok: false as const,
        conflict: {
          currentVersion: parseBigIntField(r.conflict.current_version, "conflict.current_version"),
        },
      };
    }
    return {
      id: parseStringField(r.id, "id"),
      ok: false as const,
      error: r.error ?? "unknown server error",
    };
  });
}

function buildPutWire(item: OutboundItem): BatchPutWire {
  const wire: BatchPutWire = {
    object_id: item.objectId,
    kind: item.kind,
    ciphertext: toBase64(item.ciphertext),
    nonce: toBase64(item.nonce),
    version: item.version.toString(),
  };
  if (item.prevVersion !== undefined) {
    wire.prev_version = item.prevVersion.toString();
  }
  return wire;
}

async function postBatch(
  config: SyncClientConfig,
  puts: BatchPutWire[],
  deletes: BatchDeleteWire[],
): Promise<PushItemResult[]> {
  const fetchFn = config.fetch ?? fetch;
  const csrfValue = config.csrfHeaderValue ?? "XMLHttpRequest";

  const response = await fetchFn(`${config.serverUrl}/api/sync/batch`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      [CSRF_HEADER]: csrfValue,
    },
    body: JSON.stringify({ puts, deletes }),
  });

  if (!response.ok) {
    throw new SyncNetworkError(response.status, `batch push failed: ${response.status}`);
  }

  const body = await response.json();
  return parseBatchResult(body);
}

/**
 * Drain the outbound queue and push all pending items to the server via
 * the batch endpoint. Conflicts are routed to onConflict if registered;
 * otherwise they are surfaced as conflict results in the return value.
 */
export async function pushPending(deps: PushDeps): Promise<PushResult> {
  const { config, store, encryptEnvelope, decryptEnvelope, onConflict } = deps;

  const items = await store.drainQueue();
  if (items.length === 0) {
    return { results: [] };
  }

  const putItems = items.filter((i) => !i.tombstone);
  const deleteItems = items.filter((i) => i.tombstone);

  const puts: BatchPutWire[] = putItems.map(buildPutWire);
  // prev_version is the version the server currently holds, not the new tombstone
  // version. Sending i.version here sends V+1 and the server's CAS check rejects
  // every delete with 409, so the row is never tombstoned server-side.
  const deletes: BatchDeleteWire[] = deleteItems.map((i) => ({
    object_id: i.objectId,
    prev_version: (i.prevVersion ?? i.version - BIGINT_ONE).toString(),
  }));

  const results = await postBatch(config, puts, deletes);

  const finalResults: PushItemResult[] = [];

  for (const result of results) {
    const item = items.find((i) => i.objectId === result.id);

    if (result.ok) {
      if (item !== undefined) {
        await store.put({
          kind: item.kind,
          objectId: result.id,
          ciphertext: item.ciphertext,
          nonce: item.nonce,
          version: result.version,
          serverSeq: result.serverSeq,
          tombstone: item.tombstone,
        });
        await store.ackQueueItem(item.id);
      }

      finalResults.push(result);
    } else if ("error" in result) {
      // Server reported a per-item failure that isn't a conflict. Surface it
      // without acking so the next push retries. If it's a permanent failure
      // (e.g. bad data) we'd loop forever; for now lean on the operator to
      // notice via logs rather than silently dropping the user's write.
      finalResults.push(result);
    } else {
      if (onConflict !== null && item !== undefined) {
        await handleConflict(item, result.conflict.currentVersion, {
          config,
          store,
          encryptEnvelope,
          decryptEnvelope,
          onConflict,
        });
        await store.ackQueueItem(item.id);
        finalResults.push(result);
      } else if (item !== undefined) {
        // No conflict handler registered. Acking prevents the queue from growing
        // unbounded on every poll tick. The next pull pulls the server's newer
        // version into the local store; if the user had local intent that needs
        // preserving, they should register an onConflict handler.
        await store.ackQueueItem(item.id);
        finalResults.push(result);
      } else {
        finalResults.push(result);
      }
    }
  }

  return { results: finalResults };
}
