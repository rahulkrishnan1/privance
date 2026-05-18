import type { LocalStore } from "../storage/types.js";
import { fromBase64, parseBigIntField, parseStringField, toBase64 } from "./envelope.js";
import type { ReconcileInput, SyncClientConfig } from "./types.js";
import { SyncNetworkError, SyncNotFoundError } from "./types.js";

export { handleConflict } from "./conflict-handler.js";

const CSRF_HEADER = "X-Requested-With";

type ReconcileDeps = {
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
};

/**
 * Fetch the server's current ciphertext for a conflicted object and
 * decrypt it, returning both the raw blob and the plaintext.
 */
export async function fetchServerObject(
  objectId: string,
  deps: Pick<ReconcileDeps, "config" | "decryptEnvelope">,
): Promise<{
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  version: bigint;
  serverSeq: bigint;
  plaintext: Uint8Array;
}> {
  const { config, decryptEnvelope } = deps;
  /* c8 ignore next -- global-fetch fallback, tests always inject config.fetch */
  const fetchFn = config.fetch ?? fetch;

  const url = `${config.serverUrl}/api/sync/objects/${encodeURIComponent(objectId)}`;
  const response = await fetchFn(url, {
    method: "GET",
    credentials: "include",
  });

  if (response.status === 404) {
    throw new SyncNotFoundError(objectId);
  }
  if (!response.ok) {
    throw new SyncNetworkError(response.status, `fetch object failed: ${response.status}`);
  }

  const body = (await response.json()) as Record<string, unknown>;
  const ciphertextB64 = parseStringField(body.ciphertext, "ciphertext");
  const nonceB64 = parseStringField(body.nonce, "nonce");
  const version = parseBigIntField(body.version, "version");
  const serverSeq = parseBigIntField(body.server_seq, "server_seq");
  const kind = parseStringField(body.kind, "kind");

  const ciphertext = fromBase64(ciphertextB64);
  const nonce = fromBase64(nonceB64);

  const plaintext = await decryptEnvelope({ ciphertext, nonce, objectId, kind });

  return { ciphertext, nonce, version, serverSeq, plaintext };
}

/**
 * Push a resolved object back to the server with the updated prev_version.
 * Exported so conflict-handler.ts can use it without duplicating the fetch logic.
 */
export async function pushResolution(
  objectId: string,
  kind: string,
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  version: bigint,
  prevVersion: bigint | undefined,
  deps: Pick<ReconcileDeps, "config">,
): Promise<{ serverSeq: bigint; version: bigint }> {
  const { config } = deps;
  /* c8 ignore next -- global-fetch fallback, tests always inject config.fetch */
  const fetchFn = config.fetch ?? fetch;
  const csrfValue = config.csrfHeaderValue ?? "XMLHttpRequest";

  const url = `${config.serverUrl}/api/sync/objects/${encodeURIComponent(objectId)}`;
  const wireBody: Record<string, string> = {
    kind,
    ciphertext: toBase64(ciphertext),
    nonce: toBase64(nonce),
    version: version.toString(),
  };
  if (prevVersion !== undefined) {
    wireBody.prev_version = prevVersion.toString();
  }

  const response = await fetchFn(url, {
    method: "PUT",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      [CSRF_HEADER]: csrfValue,
    },
    body: JSON.stringify(wireBody),
  });

  if (!response.ok) {
    throw new SyncNetworkError(response.status, `push resolution failed: ${response.status}`);
  }

  const body = (await response.json()) as Record<string, unknown>;
  return {
    serverSeq: parseBigIntField(body.server_seq, "server_seq"),
    version: parseBigIntField(body.version, "version"),
  };
}

/**
 * Apply a pre-resolved conflict decision supplied by the caller.
 * Used when the app has already presented the UI and has the user's choice.
 */
export async function applyReconcile(
  input: ReconcileInput,
  deps: Pick<ReconcileDeps, "config" | "store" | "encryptEnvelope">,
): Promise<void> {
  const { objectId, kind, choice, myPlaintext, theirPlaintext, theirVersion, theirServerSeq } =
    input;
  const { config, store, encryptEnvelope } = deps;

  if (choice.action === "keep-mine") {
    const encrypted = await encryptEnvelope({ plaintext: myPlaintext, objectId, kind });
    const nextVersion = theirVersion + 1n;
    const pushed = await pushResolution(
      objectId,
      kind,
      encrypted.ciphertext,
      encrypted.nonce,
      nextVersion,
      theirVersion,
      { config },
    );
    await store.put({
      kind,
      objectId,
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      version: pushed.version,
      serverSeq: pushed.serverSeq,
      tombstone: false,
    });
  } else if (choice.action === "keep-theirs") {
    const encrypted = await encryptEnvelope({ plaintext: theirPlaintext, objectId, kind });
    await store.put({
      kind,
      objectId,
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      version: theirVersion,
      serverSeq: theirServerSeq,
      tombstone: false,
    });
  } else {
    const newId = choice.newObjectId;
    const encrypted = await encryptEnvelope({ plaintext: myPlaintext, objectId: newId, kind });
    const pushed = await pushResolution(
      newId,
      kind,
      encrypted.ciphertext,
      encrypted.nonce,
      1n,
      undefined,
      { config },
    );
    await store.put({
      kind,
      objectId: newId,
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      version: pushed.version,
      serverSeq: pushed.serverSeq,
      tombstone: false,
    });
    const theirEncrypted = await encryptEnvelope({ plaintext: theirPlaintext, objectId, kind });
    await store.put({
      kind,
      objectId,
      ciphertext: theirEncrypted.ciphertext,
      nonce: theirEncrypted.nonce,
      version: theirVersion,
      serverSeq: theirServerSeq,
      tombstone: false,
    });
  }
}
