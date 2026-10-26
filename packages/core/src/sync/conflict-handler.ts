import type { LocalStore, OutboundItem } from "../storage/types.js";
import { parseBigIntField } from "./envelope.js";
import { fetchServerObject, pushResolution } from "./reconcile.js";
import {
  type ConflictResolutionCallback,
  type SyncClientConfig,
  SyncNetworkError,
  SyncNotFoundError,
  SyncProtocolError,
} from "./types.js";

type ConflictHandlerDeps = {
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
  onConflict: ConflictResolutionCallback;
};

/** Resolve only the captured queue identity; later intent always wins locally. */
export async function handleConflict(
  item: OutboundItem,
  currentVersion: bigint,
  deps: ConflictHandlerDeps,
): Promise<{ uploaded: boolean }> {
  const { config, store, decryptEnvelope, onConflict } = deps;
  let server: Awaited<ReturnType<typeof fetchServerObject>>;
  try {
    server = await fetchServerObject(item.objectId, { config, decryptEnvelope });
  } catch (err) {
    // Older servers hide tombstones as 404. Never interpret that as consent to discard.
    if (!(err instanceof SyncNotFoundError) || currentVersion !== 0n) throw err;
    server = {
      ciphertext: new Uint8Array(0),
      nonce: new Uint8Array(0),
      plaintext: new Uint8Array(0),
      version: 0n,
      serverSeq: 0n,
      tombstone: true,
    };
  }
  const myPlaintext = item.tombstone
    ? new Uint8Array(0)
    : await decryptEnvelope({
        ciphertext: item.ciphertext,
        nonce: item.nonce,
        objectId: item.objectId,
        kind: item.kind,
      });
  const choice = await onConflict({
    queueId: item.id,
    objectId: item.objectId,
    kind: item.kind,
    myPlaintext,
    theirPlaintext: server.plaintext,
    myTombstone: item.tombstone,
    theirTombstone: server.tombstone,
    theirVersion: server.version,
  });
  if (choice.action === "defer") return { uploaded: false };
  if (choice.action === "keep-mine") {
    let pushed: { version: bigint; serverSeq: bigint };
    if (item.tombstone) {
      if (server.version === 0n) {
        await store.ackQueueItem(item.id, undefined, { ...item, serverSeq: null });
        return { uploaded: false };
      }
      // Batch delete returns the actual confirmation; direct DELETE remains 204.
      const response = await (config.fetch ?? fetch)(`${config.serverUrl}/api/sync/batch`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": config.csrfHeaderValue ?? "XMLHttpRequest",
        },
        body: JSON.stringify({
          puts: [],
          deletes: [{ object_id: item.objectId, prev_version: server.version.toString() }],
        }),
      });
      if (!response.ok)
        throw new SyncNetworkError(
          response.status,
          "Deletion resolution failed; retry the conflict choice.",
        );
      const body = (await response.json()) as {
        results?: { id: string; ok: boolean; version: string; server_seq: string }[];
      };
      const result = body.results?.[0];
      if (body.results?.length !== 1 || !result?.ok || result.id !== item.objectId)
        throw new SyncNetworkError(409, "Record changed again; retry the conflict choice.");
      pushed = {
        version: parseBigIntField(result.version, "version"),
        serverSeq: parseBigIntField(result.server_seq, "server_seq"),
      };
    } else {
      pushed = await pushResolution(
        item.objectId,
        item.kind,
        item.ciphertext,
        item.nonce,
        server.version + 1n,
        server.version === 0n ? undefined : server.version,
        { config },
      );
    }
    await store.ackQueueItem(item.id, pushed);
    config.onConfirmed?.([item.id]);
    await store.applyRemote({ ...item, ...pushed });
    return { uploaded: true };
  }
  if (choice.action === "keep-both") {
    if (item.tombstone)
      throw new SyncProtocolError(
        "A deletion cannot be duplicated. Choose this device or the server version.",
      );
    const encrypted = await deps.encryptEnvelope({
      plaintext: myPlaintext,
      objectId: choice.newObjectId,
      kind: item.kind,
    });
    const pushed = await pushResolution(
      choice.newObjectId,
      item.kind,
      encrypted.ciphertext,
      encrypted.nonce,
      1n,
      undefined,
      { config },
    );
    await store.applyRemote({
      kind: item.kind,
      objectId: choice.newObjectId,
      ...encrypted,
      ...pushed,
      tombstone: item.tombstone,
    });
  }
  await store.ackQueueItem(item.id, undefined, {
    kind: item.kind,
    objectId: item.objectId,
    ciphertext: server.ciphertext,
    nonce: server.nonce,
    version: server.version,
    serverSeq: server.serverSeq,
    tombstone: server.tombstone,
  });
  return { uploaded: false };
}
