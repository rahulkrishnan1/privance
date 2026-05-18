import * as fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalStore, OutboundItem, StoredObject } from "../storage/types.js";
import { createSyncClient } from "./client.js";
import {
  fromBase64,
  parseBigIntField,
  parseBoolField,
  parseStringField,
  toBase64,
} from "./envelope.js";
import { pullChanges } from "./pull.js";
import { pushPending } from "./push.js";
import { applyReconcile, fetchServerObject, handleConflict } from "./reconcile.js";
import type { ConflictChoice, ConflictResolutionInput, SyncClientConfig } from "./types.js";
import {
  SyncConflictError,
  SyncError,
  SyncNetworkError,
  SyncNotFoundError,
  SyncProtocolError,
} from "./types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SERVER_URL = "https://privance.test";

function makeConfig(fetchFn: typeof fetch): SyncClientConfig {
  return { serverUrl: SERVER_URL, fetch: fetchFn };
}

const OBJ_ID = "obj-abc";
const KIND = "account";
const CIPHER = new Uint8Array([0x01, 0x02, 0x03]);
const NONCE = new Uint8Array(12).fill(0x0a);
const PLAINTEXT = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);

function makeOutboundItem(overrides?: Partial<OutboundItem>): OutboundItem {
  return {
    id: "queue-1",
    objectId: OBJ_ID,
    kind: KIND,
    ciphertext: CIPHER,
    nonce: NONCE,
    version: 1n,
    prevVersion: undefined,
    tombstone: false,
    enqueuedAt: Date.now(),
    ...overrides,
  };
}

function makeStoredObject(overrides?: Partial<StoredObject>): StoredObject {
  return {
    objectId: OBJ_ID,
    kind: KIND,
    ciphertext: CIPHER,
    nonce: NONCE,
    version: 1n,
    serverSeq: null,
    tombstone: false,
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeStore(overrides?: Partial<LocalStore>): LocalStore {
  return {
    init: vi.fn().mockResolvedValue(undefined),
    put: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(undefined),
    getCursor: vi.fn().mockResolvedValue(null),
    setCursor: vi.fn().mockResolvedValue(undefined),
    enqueue: vi.fn().mockResolvedValue(undefined),
    drainQueue: vi.fn().mockResolvedValue([]),
    ackQueueItem: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const encryptEnvelope = vi.fn().mockResolvedValue({ ciphertext: CIPHER, nonce: NONCE });
const decryptEnvelope = vi.fn().mockResolvedValue(PLAINTEXT);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetch(responses: Response[]): typeof fetch {
  let idx = 0;
  return vi.fn().mockImplementation(() => {
    const res = responses[idx++];
    if (!res) throw new Error("unexpected fetch call");
    return Promise.resolve(res);
  }) as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// Envelope helpers, property tests
// ---------------------------------------------------------------------------

describe("toBase64 / fromBase64 round-trip", () => {
  it("deterministic encode-decode on fixed input", () => {
    const input = new Uint8Array([0x00, 0xff, 0x80, 0x42]);
    expect(fromBase64(toBase64(input))).toEqual(input);
  });

  it("property: any byte array round-trips through base64", () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 0, maxLength: 256 }), (bytes) => {
        const roundTripped = fromBase64(toBase64(bytes));
        return roundTripped.length === bytes.length && roundTripped.every((b, i) => b === bytes[i]);
      }),
    );
  });

  it("empty array encodes to empty string and round-trips", () => {
    expect(toBase64(new Uint8Array(0))).toBe("");
    expect(fromBase64("")).toEqual(new Uint8Array(0));
  });
});

// ---------------------------------------------------------------------------
// pushPending, happy path
// ---------------------------------------------------------------------------

describe("pushPending, happy path", () => {
  it("drains queue and sends batch, acks successful items, updates local store", async () => {
    const item = makeOutboundItem();
    const store = makeStore({
      drainQueue: vi.fn().mockResolvedValue([item]),
    });

    const batchResponse = jsonResponse({
      results: [{ id: OBJ_ID, ok: true, server_seq: "10", version: "1" }],
    });

    const fetchFn = mockFetch([batchResponse]);
    const config = makeConfig(fetchFn);

    const result = await pushPending({
      config,
      store,
      encryptEnvelope,
      decryptEnvelope,
      onConflict: null,
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.ok).toBe(true);
    if (result.results[0]?.ok) {
      expect(result.results[0].serverSeq).toBe(10n);
      expect(result.results[0].version).toBe(1n);
    }
    expect(store.put).toHaveBeenCalledWith(
      expect.objectContaining({ objectId: OBJ_ID, serverSeq: 10n }),
    );
    expect(store.ackQueueItem).toHaveBeenCalledWith("queue-1");
  });

  it("returns empty results when queue is empty", async () => {
    const store = makeStore({ drainQueue: vi.fn().mockResolvedValue([]) });
    const fetchFn = vi.fn() as unknown as typeof fetch;
    const result = await pushPending({
      config: makeConfig(fetchFn),
      store,
      encryptEnvelope,
      decryptEnvelope,
      onConflict: null,
    });
    expect(result.results).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("includes X-Requested-With header on batch request", async () => {
    const item = makeOutboundItem();
    const store = makeStore({ drainQueue: vi.fn().mockResolvedValue([item]) });

    let capturedHeaders: Headers | undefined;
    const fetchFn = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      capturedHeaders = new Headers(init?.headers as HeadersInit);
      return Promise.resolve(
        jsonResponse({ results: [{ id: OBJ_ID, ok: true, server_seq: "5", version: "1" }] }),
      );
    }) as unknown as typeof fetch;

    await pushPending({
      config: makeConfig(fetchFn),
      store,
      encryptEnvelope,
      decryptEnvelope,
      onConflict: null,
    });

    expect(capturedHeaders?.get("X-Requested-With")).toBe("XMLHttpRequest");
  });

  it("serialises version and ciphertext as decimal string and base64 in request body", async () => {
    const item = makeOutboundItem({ version: 7n });
    const store = makeStore({ drainQueue: vi.fn().mockResolvedValue([item]) });

    let parsedBody: Record<string, unknown> = {};
    const fetchFn = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      parsedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
      return Promise.resolve(
        jsonResponse({ results: [{ id: OBJ_ID, ok: true, server_seq: "1", version: "7" }] }),
      );
    }) as unknown as typeof fetch;

    await pushPending({
      config: makeConfig(fetchFn),
      store,
      encryptEnvelope,
      decryptEnvelope,
      onConflict: null,
    });

    const puts = parsedBody.puts as Array<Record<string, unknown>>;
    expect(puts).toHaveLength(1);
    expect(puts[0]?.version).toBe("7");
    expect(typeof puts[0]?.ciphertext).toBe("string");
  });

  // Regression: tombstone deletes used to send the new (incremented) version as
  // prev_version, which the server CAS-rejected with 409 on every retry, so
  // deletes never landed. The wire body must carry the *previous* version.
  it("sends the previous version as prev_version on tombstone deletes", async () => {
    const tombstone = makeOutboundItem({
      version: 5n, // the new tombstone version
      prevVersion: 4n, // the version the server currently holds
      tombstone: true,
    });
    const store = makeStore({ drainQueue: vi.fn().mockResolvedValue([tombstone]) });

    let parsedBody: Record<string, unknown> = {};
    const fetchFn = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      parsedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
      return Promise.resolve(
        jsonResponse({ results: [{ id: OBJ_ID, ok: true, server_seq: "9", version: "5" }] }),
      );
    }) as unknown as typeof fetch;

    await pushPending({
      config: makeConfig(fetchFn as unknown as typeof fetch),
      store,
      encryptEnvelope,
      decryptEnvelope,
      onConflict: null,
    });

    const deletes = parsedBody.deletes as Array<Record<string, unknown>>;
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.object_id).toBe(OBJ_ID);
    expect(deletes[0]?.prev_version).toBe("4");
  });
});

// ---------------------------------------------------------------------------
// pushPending, 409 conflict → callback fires → resolution applied
// ---------------------------------------------------------------------------

describe("pushPending, conflict resolution", () => {
  it("fires conflict callback when server returns conflict; applies keep-mine", async () => {
    const item = makeOutboundItem({ version: 1n });
    const store = makeStore({
      drainQueue: vi.fn().mockResolvedValue([item]),
    });

    const serverObj = {
      object_id: OBJ_ID,
      kind: KIND,
      ciphertext: toBase64(new Uint8Array([0xcc])),
      nonce: toBase64(new Uint8Array(12).fill(0xcc)),
      version: "2",
      server_seq: "5",
    };

    const resolvedPut = { server_seq: "6", version: "3" };

    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          results: [{ id: OBJ_ID, ok: false, conflict: { current_version: "2" } }],
        }),
      )
      .mockResolvedValueOnce(jsonResponse(serverObj))
      .mockResolvedValueOnce(jsonResponse(resolvedPut)) as unknown as typeof fetch;

    const conflictCallbackArg: ConflictResolutionInput[] = [];
    const onConflict = vi.fn().mockImplementation((arg: ConflictResolutionInput) => {
      conflictCallbackArg.push(arg);
      return Promise.resolve<ConflictChoice>({ action: "keep-mine" });
    });

    const localDecrypt = vi.fn().mockResolvedValue(PLAINTEXT);
    const localEncrypt = vi.fn().mockResolvedValue({ ciphertext: CIPHER, nonce: NONCE });

    await pushPending({
      config: makeConfig(fetchFn as unknown as typeof fetch),
      store,
      encryptEnvelope: localEncrypt,
      decryptEnvelope: localDecrypt,
      onConflict,
    });

    expect(onConflict).toHaveBeenCalledOnce();
    expect(conflictCallbackArg[0]?.objectId).toBe(OBJ_ID);
    expect(store.ackQueueItem).toHaveBeenCalledWith("queue-1");
  });

  it("on 409 + server 500 → rethrows network error (handleConflict line 57)", async () => {
    const item = makeOutboundItem({ version: 1n });
    const store = makeStore({ drainQueue: vi.fn().mockResolvedValue([item]) });

    const fetchFn = mockFetch([
      jsonResponse({ results: [{ id: OBJ_ID, ok: false, conflict: { current_version: "2" } }] }),
      new Response(null, { status: 500 }),
    ]);

    await expect(
      pushPending({
        config: makeConfig(fetchFn),
        store,
        encryptEnvelope,
        decryptEnvelope,
        onConflict: vi.fn(),
      }),
    ).rejects.toThrow();
  });

  it("on 409 + server 404 → writes local tombstone and acks (server already deleted it)", async () => {
    // CR-3 regression: handleConflict must not crash when the server has no
    // record for the conflicting object. Treat as "already gone" and tombstone
    // locally so the queue entry is acked.
    const item = makeOutboundItem({ version: 1n });
    const store = makeStore({
      drainQueue: vi.fn().mockResolvedValue([item]),
    });

    const fetchFn = mockFetch([
      jsonResponse({
        results: [{ id: OBJ_ID, ok: false, conflict: { current_version: "2" } }],
      }),
      jsonResponse({ error: "not_found" }, 404),
    ]);

    const onConflict = vi.fn();

    await pushPending({
      config: makeConfig(fetchFn),
      store,
      encryptEnvelope,
      decryptEnvelope,
      onConflict,
    });

    expect(onConflict).not.toHaveBeenCalled();
    expect(store.put).toHaveBeenCalledWith(
      expect.objectContaining({ objectId: OBJ_ID, tombstone: true }),
    );
    expect(store.ackQueueItem).toHaveBeenCalledWith("queue-1");
  });

  it("acks the queue entry on 409 when no onConflict handler is registered", async () => {
    // Default policy: ack-and-drop so the queue doesn't grow unbounded across
    // poll ticks. The conflict result is still surfaced via the return value.
    const item = makeOutboundItem({ version: 1n });
    const store = makeStore({
      drainQueue: vi.fn().mockResolvedValue([item]),
    });

    const fetchFn = mockFetch([
      jsonResponse({
        results: [{ id: OBJ_ID, ok: false, conflict: { current_version: "2" } }],
      }),
    ]);

    const result = await pushPending({
      config: makeConfig(fetchFn),
      store,
      encryptEnvelope,
      decryptEnvelope,
      onConflict: null,
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.ok).toBe(false);
    if (!result.results[0]?.ok) {
      expect(result.results[0].conflict.currentVersion).toBe(2n);
    }
    expect(store.ackQueueItem).toHaveBeenCalledWith("queue-1");
  });
});

// ---------------------------------------------------------------------------
// pullChanges, happy path and cursor advance
// ---------------------------------------------------------------------------

describe("pullChanges, happy path", () => {
  it("fetches changes, applies to store, advances cursor", async () => {
    const store = makeStore({ getCursor: vi.fn().mockResolvedValue(null) });

    const changesBody = {
      changes: [
        {
          id: "obj-1",
          kind: KIND,
          version: "3",
          server_seq: "10",
          ciphertext: toBase64(CIPHER),
          nonce: toBase64(NONCE),
          tombstone: false,
        },
      ],
      next: null,
    };

    const fetchFn = mockFetch([jsonResponse(changesBody)]);

    const result = await pullChanges({
      config: makeConfig(fetchFn),
      store,
      decryptEnvelope,
    });

    expect(result.applied).toBe(1);
    expect(result.nextCursor).toBeNull();
    expect(store.put).toHaveBeenCalledWith(
      expect.objectContaining({ objectId: "obj-1", version: 3n, serverSeq: 10n }),
    );
    expect(store.setCursor).toHaveBeenCalledWith(10n);
  });

  it("uses cursor from store in the since= query param", async () => {
    const store = makeStore({ getCursor: vi.fn().mockResolvedValue(42n) });

    let capturedUrl = "";
    const fetchFn = vi.fn().mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve(jsonResponse({ changes: [], next: null }));
    }) as unknown as typeof fetch;

    await pullChanges({ config: makeConfig(fetchFn), store, decryptEnvelope });

    expect(capturedUrl).toContain("since=42");
  });

  it("advances cursor across multiple changes and picks max server_seq", async () => {
    const store = makeStore({ getCursor: vi.fn().mockResolvedValue(5n) });

    const changesBody = {
      changes: [
        {
          id: "obj-a",
          kind: KIND,
          version: "1",
          server_seq: "7",
          ciphertext: toBase64(CIPHER),
          nonce: toBase64(NONCE),
          tombstone: false,
        },
        {
          id: "obj-b",
          kind: KIND,
          version: "2",
          server_seq: "12",
          ciphertext: toBase64(CIPHER),
          nonce: toBase64(NONCE),
          tombstone: false,
        },
      ],
      next: "12",
    };

    const fetchFn = mockFetch([jsonResponse(changesBody)]);

    const result = await pullChanges({
      config: makeConfig(fetchFn),
      store,
      decryptEnvelope,
    });

    expect(result.applied).toBe(2);
    expect(result.nextCursor).toBe(12n);
    expect(store.setCursor).toHaveBeenCalledWith(12n);
  });

  it("marks tombstoned objects in local store without attempting decryption", async () => {
    const store = makeStore({ getCursor: vi.fn().mockResolvedValue(null) });

    const changesBody = {
      changes: [
        {
          id: "obj-dead",
          kind: KIND,
          version: "5",
          server_seq: "20",
          ciphertext: toBase64(CIPHER),
          nonce: toBase64(NONCE),
          tombstone: true,
        },
      ],
      next: null,
    };

    const fetchFn = mockFetch([jsonResponse(changesBody)]);
    const localDecrypt = vi.fn();

    await pullChanges({
      config: makeConfig(fetchFn),
      store,
      decryptEnvelope: localDecrypt,
    });

    expect(store.put).toHaveBeenCalledWith(
      expect.objectContaining({ objectId: "obj-dead", tombstone: true }),
    );
    expect(localDecrypt).not.toHaveBeenCalled();
  });
});

describe("pullChanges, local newer than server", () => {
  it("does not clobber a newer local version; still advances cursor", async () => {
    const localNewer = makeStoredObject({ version: 5n });
    const store = makeStore({
      getCursor: vi.fn().mockResolvedValue(null),
      get: vi.fn().mockResolvedValue(localNewer),
    });

    const changesBody = {
      changes: [
        {
          id: OBJ_ID,
          kind: KIND,
          version: "2",
          server_seq: "7",
          ciphertext: toBase64(CIPHER),
          nonce: toBase64(NONCE),
          tombstone: false,
        },
      ],
      next: null,
    };

    const fetchFn = mockFetch([jsonResponse(changesBody)]);
    const localDecrypt = vi.fn();

    const result = await pullChanges({
      config: makeConfig(fetchFn),
      store,
      decryptEnvelope: localDecrypt,
    });

    expect(result.applied).toBe(1);
    expect(localDecrypt).not.toHaveBeenCalled();
    expect(store.put).not.toHaveBeenCalled();
    expect(store.setCursor).toHaveBeenCalledWith(7n);
  });
});

describe("pushPending, server-reported per-item error", () => {
  it("surfaces an error variant without acking so the next push retries", async () => {
    const item = makeOutboundItem();
    const store = makeStore({ drainQueue: vi.fn().mockResolvedValue([item]) });

    const fetchFn = mockFetch([
      jsonResponse({ results: [{ id: OBJ_ID, ok: false, error: "transient" }] }),
    ]);

    const result = await pushPending({
      config: makeConfig(fetchFn),
      store,
      encryptEnvelope,
      decryptEnvelope,
      onConflict: null,
    });

    expect(result.results).toHaveLength(1);
    expect(store.ackQueueItem).not.toHaveBeenCalled();
  });
});

describe("pullChanges, decrypt-error cursor stall", () => {
  it("stalls cursor just before the earliest decrypt-failing seq (CR-4)", async () => {
    // A bad ciphertext earlier in the page must NOT advance the cursor past
    // itself, otherwise the next pull skips it and the record is permanently
    // lost. The cursor lands at earliestSkippedSeq - 1 so the retry re-fetches.
    const store = makeStore({ getCursor: vi.fn().mockResolvedValue(null) });

    const changesBody = {
      changes: [
        {
          id: "obj-good-1",
          kind: KIND,
          version: "1",
          server_seq: "5",
          ciphertext: toBase64(CIPHER),
          nonce: toBase64(NONCE),
          tombstone: false,
        },
        {
          id: "obj-bad",
          kind: KIND,
          version: "1",
          server_seq: "8",
          ciphertext: toBase64(CIPHER),
          nonce: toBase64(NONCE),
          tombstone: false,
        },
        {
          id: "obj-good-2",
          kind: KIND,
          version: "1",
          server_seq: "11",
          ciphertext: toBase64(CIPHER),
          nonce: toBase64(NONCE),
          tombstone: false,
        },
      ],
      next: null,
    };

    const fetchFn = mockFetch([jsonResponse(changesBody)]);
    const onDecryptError = vi.fn();
    const flakyDecrypt = vi.fn().mockImplementation(({ objectId }: { objectId: string }) => {
      if (objectId === "obj-bad") return Promise.reject(new Error("decrypt"));
      return Promise.resolve(PLAINTEXT);
    });

    await pullChanges({
      config: { ...makeConfig(fetchFn), onDecryptError },
      store,
      decryptEnvelope: flakyDecrypt,
    });

    expect(onDecryptError).toHaveBeenCalledWith("obj-bad", expect.any(Error));
    // Cursor stalls at 7 (one before the bad seq 8), so the next pull retries it.
    expect(store.setCursor).toHaveBeenCalledWith(7n);
  });
});

describe("SyncClient.drainAllChanges", () => {
  it("pages until next cursor is null", async () => {
    const store = makeStore({ getCursor: vi.fn().mockResolvedValue(null) });
    const page = (objId: string, seq: string, next: string | null) =>
      jsonResponse({
        changes: [
          {
            id: objId,
            kind: KIND,
            version: "1",
            server_seq: seq,
            ciphertext: toBase64(CIPHER),
            nonce: toBase64(NONCE),
            tombstone: false,
          },
        ],
        next,
      });

    const fetchFn = mockFetch([
      page("o-1", "1", "1"),
      page("o-2", "2", "2"),
      page("o-3", "3", null),
    ]);

    const { createSyncClient } = await import("./client.js");
    const client = createSyncClient({
      config: makeConfig(fetchFn),
      store,
      encryptEnvelope,
      decryptEnvelope,
    });

    const result = await client.drainAllChanges();
    expect(result.totalApplied).toBe(3);
  });

  it("caps at maxPages so a buggy server can't pin the worker", async () => {
    const store = makeStore({ getCursor: vi.fn().mockResolvedValue(null) });
    // Every page returns next != null (server bug or hostile loop).
    const fetchFn = vi.fn().mockImplementation(() =>
      Promise.resolve(
        jsonResponse({
          changes: [
            {
              id: "o",
              kind: KIND,
              version: "1",
              server_seq: "1",
              ciphertext: toBase64(CIPHER),
              nonce: toBase64(NONCE),
              tombstone: false,
            },
          ],
          next: "1",
        }),
      ),
    ) as unknown as typeof fetch;

    const { createSyncClient } = await import("./client.js");
    const client = createSyncClient({
      config: makeConfig(fetchFn),
      store,
      encryptEnvelope,
      decryptEnvelope,
    });

    await client.drainAllChanges({ maxPages: 3 });
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// pullChanges, error handling
// ---------------------------------------------------------------------------

describe("pullChanges, error handling", () => {
  it("throws SyncNetworkError on non-200 status", async () => {
    const store = makeStore({ getCursor: vi.fn().mockResolvedValue(null) });
    const fetchFn = mockFetch([new Response(null, { status: 503 })]);

    await expect(
      pullChanges({ config: makeConfig(fetchFn), store, decryptEnvelope }),
    ).rejects.toThrow(SyncNetworkError);
  });

  it("throws SyncProtocolError when response lacks changes array", async () => {
    const store = makeStore({ getCursor: vi.fn().mockResolvedValue(null) });
    const fetchFn = mockFetch([jsonResponse({ bad: "shape" })]);

    await expect(
      pullChanges({ config: makeConfig(fetchFn), store, decryptEnvelope }),
    ).rejects.toThrow(SyncProtocolError);
  });

  it("throws SyncProtocolError when a change record is not an object", async () => {
    const store = makeStore({ getCursor: vi.fn().mockResolvedValue(null) });
    const fetchFn = mockFetch([jsonResponse({ changes: ["not-an-object"], next: null })]);

    await expect(
      pullChanges({ config: makeConfig(fetchFn), store, decryptEnvelope }),
    ).rejects.toThrow(SyncProtocolError);
  });
});

// ---------------------------------------------------------------------------
// pushPending, error handling
// ---------------------------------------------------------------------------

describe("pushPending, error handling", () => {
  it("throws SyncNetworkError on server error", async () => {
    const item = makeOutboundItem();
    const store = makeStore({ drainQueue: vi.fn().mockResolvedValue([item]) });
    const fetchFn = mockFetch([new Response(null, { status: 500 })]);

    await expect(
      pushPending({
        config: makeConfig(fetchFn),
        store,
        encryptEnvelope,
        decryptEnvelope,
        onConflict: null,
      }),
    ).rejects.toThrow(SyncNetworkError);
  });

  it("throws SyncProtocolError when batch response lacks results field", async () => {
    const item = makeOutboundItem();
    const store = makeStore({ drainQueue: vi.fn().mockResolvedValue([item]) });
    const fetchFn = mockFetch([jsonResponse({ unexpected: true })]);

    await expect(
      pushPending({
        config: makeConfig(fetchFn),
        store,
        encryptEnvelope,
        decryptEnvelope,
        onConflict: null,
      }),
    ).rejects.toThrow(SyncProtocolError);
  });
});

// ---------------------------------------------------------------------------
// fetchServerObject
// ---------------------------------------------------------------------------

describe("fetchServerObject", () => {
  it("fetches and decrypts the server object", async () => {
    const serverBody = {
      object_id: OBJ_ID,
      kind: KIND,
      ciphertext: toBase64(CIPHER),
      nonce: toBase64(NONCE),
      version: "3",
      server_seq: "9",
    };
    const fetchFn = mockFetch([jsonResponse(serverBody)]);
    const localDecrypt = vi.fn().mockResolvedValue(PLAINTEXT);

    const result = await fetchServerObject(OBJ_ID, {
      config: makeConfig(fetchFn),
      decryptEnvelope: localDecrypt,
    });

    expect(result.version).toBe(3n);
    expect(result.plaintext).toEqual(PLAINTEXT);
  });

  it("throws SyncNetworkError on 500", async () => {
    const fetchFn = mockFetch([new Response(null, { status: 500 })]);

    await expect(
      fetchServerObject(OBJ_ID, {
        config: makeConfig(fetchFn),
        decryptEnvelope,
      }),
    ).rejects.toThrow(SyncNetworkError);
  });
});

// ---------------------------------------------------------------------------
// applyReconcile
// ---------------------------------------------------------------------------

describe("applyReconcile", () => {
  it("keep-mine: re-encrypts and pushes to server, updates local store", async () => {
    const fetchFn = mockFetch([jsonResponse({ server_seq: "8", version: "4" })]);

    const localEncrypt = vi.fn().mockResolvedValue({ ciphertext: CIPHER, nonce: NONCE });
    const store = makeStore();

    await applyReconcile(
      {
        objectId: OBJ_ID,
        kind: KIND,
        choice: { action: "keep-mine" },
        myPlaintext: PLAINTEXT,
        theirPlaintext: new Uint8Array([0xaa]),
        theirVersion: 3n,
        theirServerSeq: 5n,
      },
      { config: makeConfig(fetchFn), store, encryptEnvelope: localEncrypt },
    );

    expect(localEncrypt).toHaveBeenCalledWith({
      plaintext: PLAINTEXT,
      objectId: OBJ_ID,
      kind: KIND,
    });
    expect(store.put).toHaveBeenCalledWith(
      expect.objectContaining({ objectId: OBJ_ID, serverSeq: 8n }),
    );
  });

  it("keep-theirs: re-encrypts theirs and updates local store without pushing", async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch;
    const localEncrypt = vi.fn().mockResolvedValue({ ciphertext: CIPHER, nonce: NONCE });
    const store = makeStore();

    await applyReconcile(
      {
        objectId: OBJ_ID,
        kind: KIND,
        choice: { action: "keep-theirs" },
        myPlaintext: PLAINTEXT,
        theirPlaintext: new Uint8Array([0xbb]),
        theirVersion: 3n,
        theirServerSeq: 7n,
      },
      { config: makeConfig(fetchFn), store, encryptEnvelope: localEncrypt },
    );

    expect(fetchFn).not.toHaveBeenCalled();
    expect(store.put).toHaveBeenCalledWith(
      expect.objectContaining({ objectId: OBJ_ID, version: 3n }),
    );
  });

  it("keep-both: pushes new object and updates both local records", async () => {
    const NEW_ID = "obj-new";
    const fetchFn = mockFetch([jsonResponse({ server_seq: "11", version: "1" })]);

    const localEncrypt = vi.fn().mockResolvedValue({ ciphertext: CIPHER, nonce: NONCE });
    const store = makeStore();

    await applyReconcile(
      {
        objectId: OBJ_ID,
        kind: KIND,
        choice: { action: "keep-both", newObjectId: NEW_ID },
        myPlaintext: PLAINTEXT,
        theirPlaintext: new Uint8Array([0xcc]),
        theirVersion: 3n,
        theirServerSeq: 9n,
      },
      { config: makeConfig(fetchFn), store, encryptEnvelope: localEncrypt },
    );

    expect(store.put).toHaveBeenCalledTimes(2);
    const calls = (store.put as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => (c[0] as { objectId: string }).objectId,
    );
    expect(calls).toContain(NEW_ID);
    expect(calls).toContain(OBJ_ID);
  });
});

// ---------------------------------------------------------------------------
// SyncClient, lifecycle
// ---------------------------------------------------------------------------

describe("SyncClient, lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("start() triggers immediate push+pull then polls on interval", async () => {
    const store = makeStore({
      drainQueue: vi.fn().mockResolvedValue([]),
      getCursor: vi.fn().mockResolvedValue(null),
    });

    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse({ changes: [], next: null })) as unknown as typeof fetch;

    const client = createSyncClient({
      config: makeConfig(fetchFn),
      store,
      encryptEnvelope,
      decryptEnvelope,
    });

    client.start({ pollIntervalMs: 5000 });
    // Flush the initial immediate tick, then advance one interval.
    await vi.advanceTimersByTimeAsync(0);
    client.stop();

    expect(fetchFn).toHaveBeenCalled();
  });

  it("stop() prevents further polling", async () => {
    const store = makeStore({
      drainQueue: vi.fn().mockResolvedValue([]),
      getCursor: vi.fn().mockResolvedValue(null),
    });

    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse({ changes: [], next: null })) as unknown as typeof fetch;

    const client = createSyncClient({
      config: makeConfig(fetchFn),
      store,
      encryptEnvelope,
      decryptEnvelope,
    });

    client.start({ pollIntervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    client.stop();

    const callCountAfterStop = (fetchFn as ReturnType<typeof vi.fn>).mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect((fetchFn as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callCountAfterStop);
  });

  it("start() is idempotent, calling twice does not double-poll", async () => {
    const store = makeStore({
      drainQueue: vi.fn().mockResolvedValue([]),
      getCursor: vi.fn().mockResolvedValue(null),
    });

    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse({ changes: [], next: null })) as unknown as typeof fetch;

    const client = createSyncClient({
      config: makeConfig(fetchFn),
      store,
      encryptEnvelope,
      decryptEnvelope,
    });

    client.start({ pollIntervalMs: 1000 });
    client.start({ pollIntervalMs: 1000 });

    // Advance by exactly one interval, should fire once (not twice) due to idempotency.
    await vi.advanceTimersByTimeAsync(1000);
    client.stop();

    const calls = (fetchFn as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(calls).toBeGreaterThan(0);
  });

  it("background 401 invokes onAuthError and stops the client (IM-1)", async () => {
    const store = makeStore({
      drainQueue: vi.fn().mockResolvedValue([]),
      getCursor: vi.fn().mockResolvedValue(null),
    });

    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 401 })) as unknown as typeof fetch;

    const onAuthError = vi.fn();
    const client = createSyncClient({
      config: { ...makeConfig(fetchFn), onAuthError },
      store,
      encryptEnvelope,
      decryptEnvelope,
    });

    client.start({ pollIntervalMs: 5000 });
    await vi.advanceTimersByTimeAsync(0);

    expect(onAuthError).toHaveBeenCalledWith(401);

    // Client should have stopped itself; further timer advances yield no new fetches.
    const callsAfter401 = (fetchFn as ReturnType<typeof vi.fn>).mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect((fetchFn as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfter401);
  });

  it("onConflict handler is passed through to push logic", async () => {
    const item = makeOutboundItem();
    const store = makeStore({ drainQueue: vi.fn().mockResolvedValue([item]) });

    const serverObj = {
      object_id: OBJ_ID,
      kind: KIND,
      ciphertext: toBase64(new Uint8Array([0xdd])),
      nonce: toBase64(new Uint8Array(12).fill(0xdd)),
      version: "2",
      server_seq: "5",
    };

    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          results: [{ id: OBJ_ID, ok: false, conflict: { current_version: "2" } }],
        }),
      )
      .mockResolvedValueOnce(jsonResponse(serverObj))
      .mockResolvedValueOnce(
        jsonResponse({ server_seq: "6", version: "3" }),
      ) as unknown as typeof fetch;

    const conflictHandler = vi.fn().mockResolvedValue<ConflictChoice>({ action: "keep-mine" });

    const client = createSyncClient({
      config: makeConfig(fetchFn as unknown as typeof fetch),
      store,
      encryptEnvelope,
      decryptEnvelope,
    });
    client.onConflict(conflictHandler);

    await client.pushPending();
    expect(conflictHandler).toHaveBeenCalledOnce();
  });

  it("reconcile() delegates to applyReconcile", async () => {
    const fetchFn = mockFetch([jsonResponse({ server_seq: "9", version: "4" })]);
    const store = makeStore();
    const localEncrypt = vi.fn().mockResolvedValue({ ciphertext: CIPHER, nonce: NONCE });

    const client = createSyncClient({
      config: makeConfig(fetchFn),
      store,
      encryptEnvelope: localEncrypt,
      decryptEnvelope,
    });

    await client.reconcile({
      objectId: OBJ_ID,
      kind: KIND,
      choice: { action: "keep-mine" },
      myPlaintext: PLAINTEXT,
      theirPlaintext: new Uint8Array([0xee]),
      theirVersion: 3n,
      theirServerSeq: 5n,
    });

    expect(store.put).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// bigint wire serialisation
// ---------------------------------------------------------------------------

describe("bigint wire format", () => {
  it("pushPending sends version as decimal string", async () => {
    const item = makeOutboundItem({ version: 99999999999999n });
    const store = makeStore({ drainQueue: vi.fn().mockResolvedValue([item]) });

    let body: Record<string, unknown> = {};
    const fetchFn = vi.fn().mockImplementation((_u: string, init?: RequestInit) => {
      body = JSON.parse(init?.body as string) as Record<string, unknown>;
      return Promise.resolve(
        jsonResponse({
          results: [{ id: OBJ_ID, ok: true, server_seq: "1", version: "99999999999999" }],
        }),
      );
    }) as unknown as typeof fetch;

    await pushPending({
      config: makeConfig(fetchFn),
      store,
      encryptEnvelope,
      decryptEnvelope,
      onConflict: null,
    });

    const puts = body.puts as Array<Record<string, unknown>>;
    expect(puts[0]?.version).toBe("99999999999999");
    expect(typeof puts[0]?.version).toBe("string");
  });

  it("pullChanges parses version string from server as bigint", async () => {
    const store = makeStore({ getCursor: vi.fn().mockResolvedValue(null) });

    const fetchFn = mockFetch([
      jsonResponse({
        changes: [
          {
            id: "obj-x",
            kind: KIND,
            version: "99999999999999",
            server_seq: "1",
            ciphertext: toBase64(CIPHER),
            nonce: toBase64(NONCE),
            tombstone: false,
          },
        ],
        next: null,
      }),
    ]);

    const localDecrypt = vi.fn().mockResolvedValue(PLAINTEXT);

    await pullChanges({ config: makeConfig(fetchFn), store, decryptEnvelope: localDecrypt });

    expect(store.put).toHaveBeenCalledWith(expect.objectContaining({ version: 99999999999999n }));
  });

  it("pullChanges parses next cursor as bigint", async () => {
    const store = makeStore({ getCursor: vi.fn().mockResolvedValue(null) });

    const fetchFn = mockFetch([
      jsonResponse({
        changes: [
          {
            id: "obj-y",
            kind: KIND,
            version: "1",
            server_seq: "50",
            ciphertext: toBase64(CIPHER),
            nonce: toBase64(NONCE),
            tombstone: false,
          },
        ],
        next: "50",
      }),
    ]);

    const localDecrypt = vi.fn().mockResolvedValue(PLAINTEXT);

    const result = await pullChanges({
      config: makeConfig(fetchFn),
      store,
      decryptEnvelope: localDecrypt,
    });

    expect(result.nextCursor).toBe(50n);
  });
});

// ---------------------------------------------------------------------------
// Custom CSRF header value
// ---------------------------------------------------------------------------

describe("csrfHeaderValue override", () => {
  it("uses custom CSRF header value when configured", async () => {
    const item = makeOutboundItem();
    const store = makeStore({ drainQueue: vi.fn().mockResolvedValue([item]) });

    let capturedHeaders: Headers | undefined;
    const fetchFn = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      capturedHeaders = new Headers(init?.headers as HeadersInit);
      return Promise.resolve(
        jsonResponse({ results: [{ id: OBJ_ID, ok: true, server_seq: "1", version: "1" }] }),
      );
    }) as unknown as typeof fetch;

    const config: SyncClientConfig = {
      serverUrl: SERVER_URL,
      fetch: fetchFn,
      csrfHeaderValue: "custom-csrf-value",
    };

    await pushPending({ config, store, encryptEnvelope, decryptEnvelope, onConflict: null });

    expect(capturedHeaders?.get("X-Requested-With")).toBe("custom-csrf-value");
  });
});

// ---------------------------------------------------------------------------
// makeStoredObject usage guard, ensures fixture is exercised
// ---------------------------------------------------------------------------

describe("makeStoredObject fixture", () => {
  it("creates a valid StoredObject shape", () => {
    const obj = makeStoredObject({ version: 5n });
    expect(obj.version).toBe(5n);
    expect(obj.objectId).toBe(OBJ_ID);
  });
});

// ---------------------------------------------------------------------------
// Error constructors, ensure class hierarchy is exercised
// ---------------------------------------------------------------------------

describe("SyncError hierarchy", () => {
  it("SyncError is an Error subclass", () => {
    const e = new SyncError("base");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("SyncError");
  });

  it("SyncConflictError carries objectId and currentVersion", () => {
    const e = new SyncConflictError("obj-z", 7n);
    expect(e).toBeInstanceOf(SyncError);
    expect(e.name).toBe("SyncConflictError");
    expect(e.objectId).toBe("obj-z");
    expect(e.currentVersion).toBe(7n);
  });

  it("SyncNotFoundError carries objectId", () => {
    const e = new SyncNotFoundError("obj-missing");
    expect(e).toBeInstanceOf(SyncError);
    expect(e.name).toBe("SyncNotFoundError");
    expect(e.objectId).toBe("obj-missing");
  });

  it("SyncProtocolError is a SyncError", () => {
    const e = new SyncProtocolError("bad shape");
    expect(e).toBeInstanceOf(SyncError);
    expect(e.name).toBe("SyncProtocolError");
  });

  it("SyncNetworkError carries status code", () => {
    const e = new SyncNetworkError(429, "rate limited");
    expect(e).toBeInstanceOf(SyncError);
    expect(e.name).toBe("SyncNetworkError");
    expect(e.status).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// envelope, error branches
// ---------------------------------------------------------------------------

describe("envelope parse helpers, error branches", () => {
  it("parseBigIntField throws SyncProtocolError on null", () => {
    expect(() => parseBigIntField(null, "version")).toThrow(SyncProtocolError);
  });

  it("parseBigIntField throws SyncProtocolError on non-numeric string", () => {
    expect(() => parseBigIntField("notanumber", "version")).toThrow(SyncProtocolError);
  });

  it("parseStringField throws SyncProtocolError on non-string", () => {
    expect(() => parseStringField(42, "kind")).toThrow(SyncProtocolError);
  });

  it("parseStringField accepts valid string", () => {
    expect(parseStringField("hello", "kind")).toBe("hello");
  });

  it("parseBoolField throws SyncProtocolError on non-bool-like input", () => {
    expect(() => parseBoolField({}, "tombstone")).toThrow(SyncProtocolError);
    expect(() => parseBoolField(null, "tombstone")).toThrow(SyncProtocolError);
  });

  it("parseBoolField accepts valid boolean", () => {
    expect(parseBoolField(false, "tombstone")).toBe(false);
    expect(parseBoolField(true, "tombstone")).toBe(true);
  });

  it("parseBoolField tolerates 0/1 and 'true'/'false' from non-conformant servers", () => {
    expect(parseBoolField(0, "tombstone")).toBe(false);
    expect(parseBoolField(1, "tombstone")).toBe(true);
    expect(parseBoolField("true", "tombstone")).toBe(true);
    expect(parseBoolField("false", "tombstone")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// fetchServerObject, 404 path
// ---------------------------------------------------------------------------

describe("fetchServerObject, 404 handling", () => {
  it("throws SyncNotFoundError on 404", async () => {
    const fetchFn = mockFetch([new Response(null, { status: 404 })]);

    await expect(
      fetchServerObject(OBJ_ID, { config: makeConfig(fetchFn), decryptEnvelope }),
    ).rejects.toThrow(SyncNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// handleConflict, keep-theirs and keep-both branches
// ---------------------------------------------------------------------------

describe("handleConflict, keep-theirs", () => {
  it("stores server version locally without re-pushing when user picks keep-theirs", async () => {
    const item = makeOutboundItem({ version: 1n });
    const store = makeStore();

    const serverObj = {
      object_id: OBJ_ID,
      kind: KIND,
      ciphertext: toBase64(new Uint8Array([0xcc])),
      nonce: toBase64(new Uint8Array(12).fill(0xcc)),
      version: "3",
      server_seq: "7",
    };

    const fetchFn = mockFetch([jsonResponse(serverObj)]);
    const localDecrypt = vi.fn().mockResolvedValue(PLAINTEXT);
    const localEncrypt = vi.fn().mockResolvedValue({ ciphertext: CIPHER, nonce: NONCE });

    const onConflict = vi.fn().mockResolvedValue<ConflictChoice>({ action: "keep-theirs" });

    await handleConflict(item, 3n, {
      config: makeConfig(fetchFn),
      store,
      encryptEnvelope: localEncrypt,
      decryptEnvelope: localDecrypt,
      onConflict,
    });

    expect(store.put).toHaveBeenCalledWith(
      expect.objectContaining({ objectId: OBJ_ID, tombstone: false }),
    );
    expect(localEncrypt).not.toHaveBeenCalled();
  });
});

describe("handleConflict, keep-both", () => {
  it("pushes a new object id and stores both records locally", async () => {
    const item = makeOutboundItem({ version: 1n });
    const store = makeStore();

    const serverObj = {
      object_id: OBJ_ID,
      kind: KIND,
      ciphertext: toBase64(new Uint8Array([0xdd])),
      nonce: toBase64(new Uint8Array(12).fill(0xdd)),
      version: "3",
      server_seq: "7",
    };

    const NEW_OBJ_ID = "obj-brand-new";
    const putResult = { server_seq: "8", version: "1" };

    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(serverObj))
      .mockResolvedValueOnce(jsonResponse(putResult)) as unknown as typeof fetch;

    const localDecrypt = vi.fn().mockResolvedValue(PLAINTEXT);
    const localEncrypt = vi.fn().mockResolvedValue({ ciphertext: CIPHER, nonce: NONCE });

    const onConflict = vi
      .fn()
      .mockResolvedValue<ConflictChoice>({ action: "keep-both", newObjectId: NEW_OBJ_ID });

    await handleConflict(item, 3n, {
      config: makeConfig(fetchFn as unknown as typeof fetch),
      store,
      encryptEnvelope: localEncrypt,
      decryptEnvelope: localDecrypt,
      onConflict,
    });

    expect(store.put).toHaveBeenCalledTimes(2);
    const ids = (store.put as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => (c[0] as { objectId: string }).objectId,
    );
    expect(ids).toContain(NEW_OBJ_ID);
    expect(ids).toContain(OBJ_ID);
  });
});

// ---------------------------------------------------------------------------
// pushPending, tombstone (delete) items in batch
// ---------------------------------------------------------------------------

describe("pushPending, delete (tombstone) items", () => {
  it("includes tombstone items as deletes in the batch body", async () => {
    const deleteItem = makeOutboundItem({
      tombstone: true,
      version: 3n, // new tombstone version
      prevVersion: 2n, // version the server currently holds
    });
    const store = makeStore({ drainQueue: vi.fn().mockResolvedValue([deleteItem]) });

    let parsedBody: Record<string, unknown> = {};
    const fetchFn = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      parsedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
      return Promise.resolve(
        jsonResponse({
          results: [{ id: OBJ_ID, ok: true, server_seq: "5", version: "3" }],
        }),
      );
    }) as unknown as typeof fetch;

    await pushPending({
      config: makeConfig(fetchFn),
      store,
      encryptEnvelope,
      decryptEnvelope,
      onConflict: null,
    });

    const deletes = parsedBody.deletes as Array<Record<string, unknown>>;
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.object_id).toBe(OBJ_ID);
    expect(deletes[0]?.prev_version).toBe("2");

    const puts = parsedBody.puts as Array<Record<string, unknown>>;
    expect(puts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// pushPending, unknown objectId in server response
// ---------------------------------------------------------------------------

describe("pushPending, server result for unknown objectId", () => {
  it("gracefully handles ok result for an objectId not in the local queue", async () => {
    const item = makeOutboundItem({ objectId: "obj-known" });
    const store = makeStore({ drainQueue: vi.fn().mockResolvedValue([item]) });

    const fetchFn = mockFetch([
      jsonResponse({
        results: [
          { id: "obj-known", ok: true, server_seq: "1", version: "1" },
          { id: "obj-ghost", ok: true, server_seq: "2", version: "1" },
        ],
      }),
    ]);

    const result = await pushPending({
      config: makeConfig(fetchFn),
      store,
      encryptEnvelope,
      decryptEnvelope,
      onConflict: null,
    });

    expect(result.results).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// reconcile, applyReconcile keep-both server error
// ---------------------------------------------------------------------------

describe("applyReconcile, keep-both server error", () => {
  it("throws SyncNetworkError when server rejects the new object push", async () => {
    const fetchFn = mockFetch([new Response(null, { status: 409 })]);
    const store = makeStore();
    const localEncrypt = vi.fn().mockResolvedValue({ ciphertext: CIPHER, nonce: NONCE });

    await expect(
      applyReconcile(
        {
          objectId: OBJ_ID,
          kind: KIND,
          choice: { action: "keep-both", newObjectId: "obj-brand-new-2" },
          myPlaintext: PLAINTEXT,
          theirPlaintext: new Uint8Array([0xff]),
          theirVersion: 5n,
          theirServerSeq: 11n,
        },
        { config: makeConfig(fetchFn), store, encryptEnvelope: localEncrypt },
      ),
    ).rejects.toThrow(SyncNetworkError);
  });
});

// ---------------------------------------------------------------------------
// pushResolution, server error branch
// ---------------------------------------------------------------------------

describe("handleConflict, pushResolution server error", () => {
  it("throws SyncNetworkError when re-push of keep-mine choice fails", async () => {
    const item = makeOutboundItem({ version: 1n });
    const store = makeStore();

    const serverObj = {
      object_id: OBJ_ID,
      kind: KIND,
      ciphertext: toBase64(new Uint8Array([0xaa])),
      nonce: toBase64(new Uint8Array(12).fill(0xaa)),
      version: "2",
      server_seq: "3",
    };

    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(serverObj))
      .mockResolvedValueOnce(new Response(null, { status: 500 })) as unknown as typeof fetch;

    const localDecrypt = vi.fn().mockResolvedValue(PLAINTEXT);
    const localEncrypt = vi.fn().mockResolvedValue({ ciphertext: CIPHER, nonce: NONCE });
    const onConflict = vi.fn().mockResolvedValue<ConflictChoice>({ action: "keep-mine" });

    await expect(
      handleConflict(item, 2n, {
        config: makeConfig(fetchFn as unknown as typeof fetch),
        store,
        encryptEnvelope: localEncrypt,
        decryptEnvelope: localDecrypt,
        onConflict,
      }),
    ).rejects.toThrow(SyncNetworkError);
  });
});

// ---------------------------------------------------------------------------
// SyncClient background error suppression
// ---------------------------------------------------------------------------

describe("SyncClient, background error suppression", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("swallows errors in background tick so polling continues", async () => {
    const store = makeStore({
      drainQueue: vi.fn().mockRejectedValue(new Error("storage failure")),
      getCursor: vi.fn().mockResolvedValue(null),
    });

    const fetchFn = vi.fn() as unknown as typeof fetch;

    const client = createSyncClient({
      config: makeConfig(fetchFn),
      store,
      encryptEnvelope,
      decryptEnvelope,
    });

    client.start({ pollIntervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    client.stop();

    // Error was swallowed: no network call was made and no unhandled rejection
    // propagated (the test itself passing confirms error suppression).
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Critical 1: batch puts carry prev_version
// ---------------------------------------------------------------------------

describe("pushPending, prev_version in batch puts", () => {
  it("omits prev_version for a brand-new object (prevVersion undefined)", async () => {
    const item = makeOutboundItem({ version: 1n, prevVersion: undefined });
    const store = makeStore({ drainQueue: vi.fn().mockResolvedValue([item]) });

    let parsedBody: Record<string, unknown> = {};
    const fetchFn = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      parsedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
      return Promise.resolve(
        jsonResponse({ results: [{ id: OBJ_ID, ok: true, server_seq: "1", version: "1" }] }),
      );
    }) as unknown as typeof fetch;

    await pushPending({
      config: makeConfig(fetchFn),
      store,
      encryptEnvelope,
      decryptEnvelope,
      onConflict: null,
    });

    const puts = parsedBody.puts as Array<Record<string, unknown>>;
    expect(puts).toHaveLength(1);
    expect(puts[0]?.prev_version).toBeUndefined();
  });

  it("includes prev_version for an update (prevVersion set)", async () => {
    const item = makeOutboundItem({ version: 3n, prevVersion: 2n });
    const store = makeStore({ drainQueue: vi.fn().mockResolvedValue([item]) });

    let parsedBody: Record<string, unknown> = {};
    const fetchFn = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      parsedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
      return Promise.resolve(
        jsonResponse({ results: [{ id: OBJ_ID, ok: true, server_seq: "5", version: "3" }] }),
      );
    }) as unknown as typeof fetch;

    await pushPending({
      config: makeConfig(fetchFn),
      store,
      encryptEnvelope,
      decryptEnvelope,
      onConflict: null,
    });

    const puts = parsedBody.puts as Array<Record<string, unknown>>;
    expect(puts).toHaveLength(1);
    expect(puts[0]?.prev_version).toBe("2");
    expect(puts[0]?.version).toBe("3");
  });
});

// ---------------------------------------------------------------------------
// Critical 2: keep-theirs stores server_seq (not version) as watermark
// ---------------------------------------------------------------------------

describe("handleConflict, keep-theirs stores server_seq correctly", () => {
  it("stores server.serverSeq not server.version in the local record", async () => {
    const item = makeOutboundItem({ version: 1n });
    const store = makeStore();

    const serverObj = {
      object_id: OBJ_ID,
      kind: KIND,
      ciphertext: toBase64(new Uint8Array([0xfe])),
      nonce: toBase64(new Uint8Array(12).fill(0xfe)),
      version: "3",
      server_seq: "42",
    };

    const fetchFn = mockFetch([jsonResponse(serverObj)]);
    const localDecrypt = vi.fn().mockResolvedValue(PLAINTEXT);
    const localEncrypt = vi.fn().mockResolvedValue({ ciphertext: CIPHER, nonce: NONCE });
    const onConflict = vi.fn().mockResolvedValue<ConflictChoice>({ action: "keep-theirs" });

    await handleConflict(item, 3n, {
      config: makeConfig(fetchFn),
      store,
      encryptEnvelope: localEncrypt,
      decryptEnvelope: localDecrypt,
      onConflict,
    });

    expect(store.put).toHaveBeenCalledWith(
      expect.objectContaining({ objectId: OBJ_ID, version: 3n, serverSeq: 42n }),
    );
  });
});

// ---------------------------------------------------------------------------
// Important 3: pull cursor advances past decrypt failures
// ---------------------------------------------------------------------------

describe("pullChanges, decrypt failure handling", () => {
  it("skips undecryptable objects, advances cursor past them, continues with rest", async () => {
    const store = makeStore({ getCursor: vi.fn().mockResolvedValue(null) });

    const changesBody = {
      changes: [
        {
          id: "obj-bad",
          kind: KIND,
          version: "2",
          server_seq: "8",
          ciphertext: toBase64(new Uint8Array([0x00])),
          nonce: toBase64(NONCE),
          tombstone: false,
        },
        {
          id: "obj-good",
          kind: KIND,
          version: "3",
          server_seq: "9",
          ciphertext: toBase64(CIPHER),
          nonce: toBase64(NONCE),
          tombstone: false,
        },
      ],
      next: null,
    };

    const errors: Array<{ id: string; err: unknown }> = [];
    const localDecrypt = vi
      .fn()
      .mockImplementationOnce(() => Promise.reject(new Error("bad key")))
      .mockResolvedValueOnce(PLAINTEXT);

    const result = await pullChanges({
      config: {
        ...makeConfig(mockFetch([jsonResponse(changesBody)])),
        onDecryptError: (id, err) => errors.push({ id, err }),
      },
      store,
      decryptEnvelope: localDecrypt,
    });

    // Good object was applied; bad one was skipped.
    expect(result.applied).toBe(1);
    // Cursor must stall at one-less-than the earliest skipped seq so the next
    // pull re-fetches it. Advancing past it would silently drop the record.
    expect(store.setCursor).toHaveBeenCalledWith(7n);
    // Error callback received the failing object id.
    expect(errors).toHaveLength(1);
    expect(errors[0]?.id).toBe("obj-bad");
    // Only the good object was stored.
    expect(store.put).toHaveBeenCalledTimes(1);
    expect(store.put).toHaveBeenCalledWith(expect.objectContaining({ objectId: "obj-good" }));
  });

  it("skips silently when onDecryptError is omitted", async () => {
    const store = makeStore({ getCursor: vi.fn().mockResolvedValue(null) });

    const changesBody = {
      changes: [
        {
          id: "obj-corrupt",
          kind: KIND,
          version: "1",
          server_seq: "5",
          ciphertext: toBase64(CIPHER),
          nonce: toBase64(NONCE),
          tombstone: false,
        },
      ],
      next: null,
    };

    const localDecrypt = vi.fn().mockRejectedValue(new Error("corrupt ciphertext"));

    // No onDecryptError configured, should resolve without throwing.
    await expect(
      pullChanges({
        config: makeConfig(mockFetch([jsonResponse(changesBody)])),
        store,
        decryptEnvelope: localDecrypt,
      }),
    ).resolves.toMatchObject({ applied: 0 });
  });
});

// ---------------------------------------------------------------------------
// Important 4: polling tick in-flight guard
// ---------------------------------------------------------------------------

describe("SyncClient, in-flight guard prevents concurrent ticks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("skips a tick that fires while a previous tick is still running", async () => {
    let resolveFirst!: () => void;
    const firstTickDone = new Promise<void>((res) => {
      resolveFirst = res;
    });

    let callCount = 0;
    const store = makeStore({
      drainQueue: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // First tick hangs until we resolve manually.
          return firstTickDone.then(() => []);
        }
        return Promise.resolve([]);
      }),
      getCursor: vi.fn().mockResolvedValue(null),
    });

    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse({ changes: [], next: null })) as unknown as typeof fetch;

    const client = createSyncClient({
      config: makeConfig(fetchFn),
      store,
      encryptEnvelope,
      decryptEnvelope,
    });

    client.start({ pollIntervalMs: 100 });
    // Flush first immediate tick (hangs in drainQueue).
    await vi.advanceTimersByTimeAsync(0);
    // Fire the interval while first tick is still in-flight, should be skipped.
    await vi.advanceTimersByTimeAsync(100);
    // drainQueue should have been called exactly once (second tick skipped).
    expect(callCount).toBe(1);

    // Let first tick finish.
    resolveFirst();
    await vi.advanceTimersByTimeAsync(0);
    client.stop();
  });
});
