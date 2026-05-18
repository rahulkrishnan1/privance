import { apiFetch } from "./client";

// ---------------------------------------------------------------------------
// Wire types, mirror server/src/sync/wire.ts exactly
// ---------------------------------------------------------------------------

export type SyncPutRequest = {
  kind: string;
  ciphertext: string; // base64
  nonce: string; // base64
  version: string; // bigint as decimal string
  prev_version?: string; // bigint as decimal string
};

export type SyncPutResponse = {
  server_seq: string; // bigint as decimal string
  version: string; // bigint as decimal string
};

export type SyncGetResponse = {
  object_id: string;
  kind: string;
  ciphertext: string; // base64
  nonce: string; // base64
  version: string; // bigint as decimal string
  server_seq: string; // bigint as decimal string
};

export type SyncDeleteRequest = {
  prev_version: string; // bigint as decimal string
};

export type SyncChangeRecord = {
  id: string;
  kind: string;
  version: string; // bigint as decimal string
  server_seq: string; // bigint as decimal string
  ciphertext: string; // base64
  nonce: string; // base64
  tombstone: boolean;
};

export type SyncChangesResponse = {
  changes: SyncChangeRecord[];
  next: string | null; // bigint as decimal string, or null
};

export type BatchPutItem = {
  object_id: string;
  kind: string;
  ciphertext: string; // base64
  nonce: string; // base64
  version: string; // bigint as decimal string
  prev_version?: string; // bigint as decimal string
};

export type BatchDeleteItem = {
  object_id: string;
  prev_version: string; // bigint as decimal string
};

export type BatchRequest = {
  puts?: BatchPutItem[];
  deletes?: BatchDeleteItem[];
};

export type BatchResultItem =
  | { id: string; ok: true; server_seq: string; version: string }
  | { id: string; ok: false; conflict: { current_version: string } };

export type BatchResponse = {
  results: BatchResultItem[];
};

// ---------------------------------------------------------------------------
// Typed wrappers
// ---------------------------------------------------------------------------

export async function put(objectId: string, item: SyncPutRequest): Promise<SyncPutResponse> {
  const res = await apiFetch(`/api/sync/objects/${encodeURIComponent(objectId)}`, {
    method: "PUT",
    body: JSON.stringify(item),
  });
  return res.json() as Promise<SyncPutResponse>;
}

export async function get(objectId: string): Promise<SyncGetResponse> {
  const res = await apiFetch(`/api/sync/objects/${encodeURIComponent(objectId)}`);
  return res.json() as Promise<SyncGetResponse>;
}

export async function del(objectId: string, prevVersion: string): Promise<void> {
  await apiFetch(`/api/sync/objects/${encodeURIComponent(objectId)}`, {
    method: "DELETE",
    body: JSON.stringify({ prev_version: prevVersion } satisfies SyncDeleteRequest),
  });
}

export async function changes(sinceSeq: string, limit: number): Promise<SyncChangesResponse> {
  const params = new URLSearchParams({ since: sinceSeq, limit: String(limit) });
  const res = await apiFetch(`/api/sync/changes?${params.toString()}`);
  return res.json() as Promise<SyncChangesResponse>;
}

export async function batch(request: BatchRequest): Promise<BatchResponse> {
  const res = await apiFetch("/api/sync/batch", {
    method: "POST",
    body: JSON.stringify(request),
  });
  return res.json() as Promise<BatchResponse>;
}
