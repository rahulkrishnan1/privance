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
    if (
      typeof item !== "object" ||
      item === null ||
      typeof (item as BatchResponseItem).ok !== "boolean"
    ) {
      throw new SyncProtocolError("invalid batch result");
    }
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
      if (typeof r.conflict !== "object" || r.conflict === null)
        throw new SyncProtocolError("invalid conflict result");
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
      error: r.error === undefined ? "unknown server error" : parseStringField(r.error, "error"),
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

// A store is the serialization boundary, including the standalone public function.
const operations = new WeakMap<LocalStore, Promise<unknown>>();

export function serializeSync<T>(store: LocalStore, run: () => Promise<T>): Promise<T> {
  const pending = (operations.get(store) ?? Promise.resolve()).catch(() => {}).then(run);
  operations.set(store, pending);
  return pending;
}

export function pushPending(deps: PushDeps): Promise<PushResult> {
  return serializeSync(deps.store, () => drainPending(deps));
}

async function drainPending(deps: PushDeps): Promise<PushResult> {
  const { config, store, onConflict } = deps;
  const finalResults: PushItemResult[] = [];
  const confirmedQueueIds: string[] = [];
  const blocked = new Set<string>();
  const attempted = new Set<string>();
  const confirmedVersions = new Map<string, bigint>();
  let conflictError: unknown;

  for (;;) {
    const items = await store.drainQueue();
    const selected = new Map<string, OutboundItem>();
    const puts: BatchPutWire[] = [];
    const deletes: BatchDeleteWire[] = [];
    let bytes = new TextEncoder().encode(JSON.stringify({ puts, deletes })).length;
    for (const queued of items) {
      if (blocked.has(queued.objectId) || selected.has(queued.objectId) || attempted.has(queued.id))
        continue;
      const previous = confirmedVersions.get(queued.objectId);
      const item =
        previous === undefined
          ? queued
          : { ...queued, prevVersion: previous, version: previous + BIGINT_ONE };
      const wire = item.tombstone
        ? {
            object_id: item.objectId,
            prev_version: (item.prevVersion ?? item.version - BIGINT_ONE).toString(),
          }
        : buildPutWire(item);
      const array = item.tombstone ? deletes : puts;
      const extra =
        new TextEncoder().encode(JSON.stringify(wire)).length + (array.length > 0 ? 1 : 0);
      if (bytes + extra > 5 * 1024 * 1024) {
        if (selected.size > 0) break;
        // Leave this record queued, but do not starve smaller unrelated records.
        blocked.add(item.objectId);
        finalResults.push({
          id: item.objectId,
          ok: false,
          error: "Record exceeds the 5 MiB sync limit. Reduce its size and save again.",
        });
        continue;
      }
      if (item.tombstone) deletes.push(wire as BatchDeleteWire);
      else puts.push(wire as BatchPutWire);
      bytes += extra;
      selected.set(item.objectId, queued);
      if (selected.size === 500) break;
    }
    if (selected.size === 0) {
      if (conflictError !== undefined) throw conflictError;
      break;
    }
    const results = await postBatch(config, puts, deletes);
    const seen = new Set<string>();
    for (const result of results) {
      if (!selected.has(result.id) || seen.has(result.id))
        throw new SyncProtocolError("batch response contains unexpected or duplicate ID");
      seen.add(result.id);
    }
    if (seen.size !== selected.size)
      throw new SyncProtocolError("batch response missing selected IDs");

    // Confirm all successful entries before a conflict callback can fail.
    for (const result of results) {
      const item = selected.get(result.id) as OutboundItem;
      attempted.add(item.id);
      finalResults.push(result);
      if (result.ok) {
        await store.ackQueueItem(item.id, { version: result.version, serverSeq: result.serverSeq });
        confirmedQueueIds.push(item.id);
        config.onConfirmed?.([item.id]);
        confirmedVersions.set(item.objectId, result.version);
      } else blocked.add(item.objectId);
    }
    for (const result of results) {
      if (result.ok || !("conflict" in result) || onConflict === null) continue;
      const item = selected.get(result.id) as OutboundItem;
      try {
        const resolution = await handleConflict(item, result.conflict.currentVersion, {
          ...deps,
          onConflict,
        });
        if (resolution.uploaded) confirmedQueueIds.push(item.id);
      } catch (err) {
        conflictError ??= err;
      }
    }
  }
  return { results: finalResults, confirmedQueueIds };
}
