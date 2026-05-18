import type { LocalStore } from "../storage/types.js";
import { fromBase64, parseBigIntField, parseBoolField, parseStringField } from "./envelope.js";
import type { PullChangeRecord, PullResult, SyncClientConfig } from "./types.js";
import { SyncNetworkError, SyncProtocolError } from "./types.js";

// Hoisted BigInt constants so @vercel/nft's static analyzer doesn't trip on
// inline literals in expressions like `seq - 1n` during build traces.
const BIGINT_ONE = BigInt(1);
const BIGINT_ZERO = BigInt(0);

type PullDeps = {
  config: SyncClientConfig;
  store: LocalStore;
  decryptEnvelope: (input: {
    ciphertext: Uint8Array;
    nonce: Uint8Array;
    objectId: string;
    kind: string;
  }) => Promise<Uint8Array>;
};

function parseChangeRecord(raw: unknown): PullChangeRecord {
  if (typeof raw !== "object" || raw === null) {
    throw new SyncProtocolError("change record is not an object");
  }
  const r = raw as Record<string, unknown>;
  return {
    id: parseStringField(r.id, "id"),
    kind: parseStringField(r.kind, "kind"),
    version: parseBigIntField(r.version, "version"),
    serverSeq: parseBigIntField(r.server_seq, "server_seq"),
    ciphertext: fromBase64(parseStringField(r.ciphertext, "ciphertext")),
    nonce: fromBase64(parseStringField(r.nonce, "nonce")),
    tombstone: parseBoolField(r.tombstone, "tombstone"),
  };
}

/**
 * Fetch changes from the server since the local cursor and apply them to
 * the local store. Skips tombstoned objects by marking them deleted locally.
 * Advances the cursor to the last server_seq seen.
 */
export async function pullChanges(deps: PullDeps): Promise<PullResult> {
  const { config, store, decryptEnvelope } = deps;
  const fetchFn = config.fetch ?? fetch;

  const cursor = await store.getCursor();
  const since = cursor ?? 0n;
  const limit = 100;

  const url = `${config.serverUrl}/api/sync/changes?since=${since.toString()}&limit=${limit}`;
  const response = await fetchFn(url, {
    method: "GET",
    credentials: "include",
  });

  if (!response.ok) {
    throw new SyncNetworkError(response.status, `pull failed: ${response.status}`);
  }

  const body = (await response.json()) as Record<string, unknown>;

  const rawChanges = body.changes;
  if (!Array.isArray(rawChanges)) {
    throw new SyncProtocolError("response missing changes array");
  }

  const changes = rawChanges.map(parseChangeRecord);
  let applied = 0;
  // The cursor only advances over records that were either applied locally OR
  // safely skipped because the local copy already supersedes the server's. A
  // decrypt failure must NOT advance the cursor, otherwise the failing record
  // is never retried and the user permanently loses it.
  let safeMaxSeq: bigint | null = null;
  let earliestSkippedSeq: bigint | null = null;

  for (const change of changes) {
    // Don't clobber a newer local revision (including an unacked tombstone
    // that hasn't been pushed yet). Push will reconcile when it drains.
    const existing = await store.get({ kind: change.kind, objectId: change.id });
    if (existing !== null && existing.version > change.version) {
      applied++;
      if (safeMaxSeq === null || change.serverSeq > safeMaxSeq) {
        safeMaxSeq = change.serverSeq;
      }
      continue;
    }

    if (change.tombstone) {
      // Discard the server's ciphertext on tombstones. Local code never reads
      // a tombstoned row's ciphertext (it's a deletion marker), and a hostile
      // or buggy server otherwise has a free injection vector here under cover
      // of the tombstone flag (the AAD tag isn't checked on this path).
      await store.put({
        kind: change.kind,
        objectId: change.id,
        ciphertext: new Uint8Array(0),
        nonce: new Uint8Array(0),
        version: change.version,
        serverSeq: change.serverSeq,
        tombstone: true,
      });
    } else {
      try {
        await decryptEnvelope({
          ciphertext: change.ciphertext,
          nonce: change.nonce,
          objectId: change.id,
          kind: change.kind,
        });
      } catch (err) {
        config.onDecryptError?.(change.id, err);
        // Track the earliest unprocessed seq so the cursor stalls before it
        // and the next pull re-fetches.
        if (earliestSkippedSeq === null || change.serverSeq < earliestSkippedSeq) {
          earliestSkippedSeq = change.serverSeq;
        }
        continue;
      }

      await store.put({
        kind: change.kind,
        objectId: change.id,
        ciphertext: change.ciphertext,
        nonce: change.nonce,
        version: change.version,
        serverSeq: change.serverSeq,
        tombstone: false,
      });
    }

    applied++;
    if (safeMaxSeq === null || change.serverSeq > safeMaxSeq) {
      safeMaxSeq = change.serverSeq;
    }
  }

  const nextRaw = body.next;
  const nextCursor =
    nextRaw !== null && nextRaw !== undefined ? parseBigIntField(nextRaw, "next") : null;

  // If anything was skipped, cap the cursor just before the earliest skipped
  // seq so the next pull retries it. Otherwise advance to the max safely-seen
  // seq. Subtract one because cursor semantics are "last seq successfully
  // observed", and the next pull uses `since=cursor` to fetch strictly after.
  if (earliestSkippedSeq !== null) {
    const target = earliestSkippedSeq - BIGINT_ONE;
    if (target >= BIGINT_ZERO) {
      await store.setCursor(target);
    }
  } else if (safeMaxSeq !== null) {
    await store.setCursor(safeMaxSeq);
  }

  return { applied, nextCursor };
}
