import type { LocalStore, OutboundItem } from "../storage/types.js";
import { fetchServerObject, pushResolution } from "./reconcile.js";
import {
  type ConflictResolutionCallback,
  type SyncClientConfig,
  SyncNotFoundError,
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

/**
 * Handle a conflict for a queued item by calling the registered callback,
 * applying the user's choice, and updating the local store.
 */
export async function handleConflict(
  item: OutboundItem,
  currentVersion: bigint,
  deps: ConflictHandlerDeps,
): Promise<void> {
  const { config, store, encryptEnvelope, decryptEnvelope, onConflict } = deps;

  let server: Awaited<ReturnType<typeof fetchServerObject>>;
  try {
    server = await fetchServerObject(item.objectId, { config, decryptEnvelope });
  } catch (err) {
    // Server has no record for this object (deleted on another device, account
    // wiped, or never successfully created). Treat as "already gone": tombstone
    // locally and let the caller ack the queue entry. Throwing here would abort
    // the rest of the batch and leave queued items unacked.
    if (err instanceof SyncNotFoundError) {
      await store.put({
        kind: item.kind,
        objectId: item.objectId,
        ciphertext: item.ciphertext,
        nonce: item.nonce,
        version: item.version,
        serverSeq: null,
        tombstone: true,
      });
      return;
    }
    throw err;
  }

  const myPlaintext = await decryptEnvelope({
    ciphertext: item.ciphertext,
    nonce: item.nonce,
    objectId: item.objectId,
    kind: item.kind,
  });

  const choice = await onConflict({
    objectId: item.objectId,
    kind: item.kind,
    myPlaintext,
    theirPlaintext: server.plaintext,
  });

  if (choice.action === "keep-mine") {
    // TOCTOU window: server can advance between the 409 we received and this
    // resolution push. A second 409 here surfaces as a SyncNetworkError to the
    // caller, which will retry on the next poll tick after a fresh pull. The
    // tradeoff: occasional user-visible "save again" instead of an unbounded
    // retry loop that could mask divergence between devices.
    const encrypted = await encryptEnvelope({
      plaintext: myPlaintext,
      objectId: item.objectId,
      kind: item.kind,
    });
    const nextVersion = currentVersion + 1n;
    const pushed = await pushResolution(
      item.objectId,
      item.kind,
      encrypted.ciphertext,
      encrypted.nonce,
      nextVersion,
      currentVersion,
      { config },
    );
    await store.put({
      kind: item.kind,
      objectId: item.objectId,
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      version: pushed.version,
      serverSeq: pushed.serverSeq,
      tombstone: false,
    });
  } else if (choice.action === "keep-theirs") {
    await store.put({
      kind: item.kind,
      objectId: item.objectId,
      ciphertext: server.ciphertext,
      nonce: server.nonce,
      version: server.version,
      serverSeq: server.serverSeq,
      tombstone: false,
    });
  } else {
    const newId = choice.newObjectId;
    const encrypted = await encryptEnvelope({
      plaintext: myPlaintext,
      objectId: newId,
      kind: item.kind,
    });
    const pushed = await pushResolution(
      newId,
      item.kind,
      encrypted.ciphertext,
      encrypted.nonce,
      1n,
      undefined,
      { config },
    );
    await store.put({
      kind: item.kind,
      objectId: newId,
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      version: pushed.version,
      serverSeq: pushed.serverSeq,
      tombstone: false,
    });
    await store.put({
      kind: item.kind,
      objectId: item.objectId,
      ciphertext: server.ciphertext,
      nonce: server.nonce,
      version: server.version,
      serverSeq: server.serverSeq,
      tombstone: false,
    });
  }
}
