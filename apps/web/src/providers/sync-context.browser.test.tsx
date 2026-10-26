import { encryptAead, type ItemsKey, KDF_PARAM_VERSION, LABEL_VERSION } from "@privance/core";
import type { LocalStore } from "@privance/core/storage";
import type { SyncClient } from "@privance/core/sync";
import { toBase64 } from "@privance/core/sync";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import "@/app/globals.css";
import { SyncStatus } from "@/components/SyncStatus";
import { useAccountsQuery } from "@/features/accounts/queries";
import { SyncProvider, useSync } from "./sync-context";

const fixture = vi.hoisted(() => ({
  key: new Uint8Array(32).fill(7),
  userId: "",
  lock: vi.fn(),
  cleanup: null as null | (() => Promise<void>),
}));
vi.mock("./auth-context", () => ({
  readItemsKey: () => fixture.key,
  USER_ID_KEY: "test-user-id",
  useAuth: () => ({
    state: "unlocked",
    user: { userId: fixture.userId },
    lock: fixture.lock,
    registerLogoutCleanup: (cleanup: () => Promise<void>) => {
      fixture.cleanup = cleanup;
      return () => {};
    },
  }),
}));

let api: ReturnType<typeof useSync>;
let screen: Awaited<ReturnType<typeof render>>;
let store: LocalStore;
let syncClient: SyncClient;
let changes: Record<string, unknown>[] = [];
let serverObject: Record<string, unknown>;
let failResolution = false;
let requests: RequestInit[];
const objectId = "remote-account";
const payload = (balanceCents: string) => ({
  name: "Cash",
  kind: "cash",
  currency: "USD",
  subKind: "checking",
  balanceCents,
});
async function envelope(balance: string, version: number, tombstone = false) {
  const encrypted = encryptAead({
    plaintext: new TextEncoder().encode(JSON.stringify(payload(balance))),
    key: fixture.key as ItemsKey,
    aad: {
      recordUuid: objectId,
      kind: "account",
      labelVersion: LABEL_VERSION,
      kdfParamVersion: KDF_PARAM_VERSION,
    },
  });
  return {
    id: objectId,
    object_id: objectId,
    kind: "account",
    version: String(version),
    server_seq: String(version),
    ciphertext: toBase64(encrypted.ciphertext),
    nonce: toBase64(encrypted.nonce),
    tombstone,
  };
}
function Harness() {
  api = useSync();
  const accounts = useAccountsQuery();
  return (
    <>
      <SyncStatus />
      <output aria-label="Store clock">{api.storeClock}</output>
      <output aria-label="Accounts">
        {accounts.status === "success"
          ? accounts.data
              .map((account) =>
                account.payload.kind === "cash"
                  ? `${account.payload.name}: ${account.payload.balanceCents}`
                  : "other",
              )
              .join(", ") || "No accounts"
          : accounts.status}
      </output>
    </>
  );
}
beforeEach(async () => {
  fixture.userId = crypto.randomUUID();
  fixture.cleanup = null;
  changes = [];
  requests = [];
  failResolution = false;
  serverObject = await envelope("900", 5);
  const originalFetch = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (!String(url).includes("/api/sync/")) return originalFetch(url, init);
      requests.push(init ?? {});
      if (String(url).includes("/changes")) {
        const page = changes;
        changes = [];
        return Response.json({ changes: page, next: null });
      }
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        return Response.json({
          results: [...body.puts, ...body.deletes].map((row: { object_id: string }) => ({
            id: row.object_id,
            ok: false,
            conflict: { current_version: "5" },
          })),
        });
      }
      if (init?.method === "PUT")
        return failResolution
          ? Response.json({}, { status: 409 })
          : Response.json({ version: "6", server_seq: "6" });
      return Response.json(serverObject);
    }),
  );
  screen = await render(
    <SyncProvider>
      <Harness />
    </SyncProvider>,
  );
  await expect
    .element(screen.getByRole("status", { name: "Sync status: synced" }))
    .toHaveTextContent("synced");
  await vi.waitFor(() => expect(api.store).not.toBeNull());
  if (!api.store || !api.client) throw new Error("Sync did not initialize");
  store = api.store;
  syncClient = api.client;
});
afterEach(async () => {
  api.client?.stop();
  await fixture.cleanup?.();
  await screen?.unmount();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("refreshes a remote edited balance and deletion in the mounted query; empty pulls do not tick", async () => {
  const initialClock = api.storeClock;
  changes = [await envelope("100", 1)];
  await api.client?.pullChanges();
  await expect
    .element(screen.getByRole("status", { name: "Sync status: synced" }))
    .toHaveTextContent("synced");
  await expect.element(screen.getByLabelText("Accounts")).toHaveTextContent("Cash: 100");
  expect(api.storeClock).toBe(initialClock + 1);
  changes = [await envelope("250", 2)];
  await api.client?.pullChanges();
  await expect.element(screen.getByLabelText("Accounts")).toHaveTextContent("Cash: 250");
  const clock = api.storeClock;
  await api.client?.pullChanges();
  expect(api.storeClock).toBe(clock);
  changes = [await envelope("250", 3, true)];
  await api.client?.pullChanges();
  await expect.element(screen.getByLabelText("Accounts")).toHaveTextContent("No accounts");
  expect(api.storeClock).toBe(clock + 1);
});

async function conflict(tombstone = false) {
  const mine = await envelope("100", 1, tombstone);
  const id = await store.putAndEnqueue({
    kind: "account",
    objectId,
    ciphertext: Uint8Array.from(atob(String(mine.ciphertext)), (c) => c.charCodeAt(0)),
    nonce: Uint8Array.from(atob(String(mine.nonce)), (c) => c.charCodeAt(0)),
    version: 1n,
    prevVersion: undefined,
    tombstone,
  });
  api.tick();
  await syncClient.pushPending();
  await screen.getByRole("button", { name: "Review conflict" }).click();
  await expect.element(screen.getByRole("dialog")).toHaveTextContent("Resolve sync conflict");
  return id;
}

it("offers explicit Use server version and updates the query without treating it as upload", async () => {
  await conflict();
  await screen.getByRole("button", { name: "Use server version" }).click();
  await expect.element(screen.getByLabelText("Accounts")).toHaveTextContent("Cash: 900");
  await vi.waitFor(() => expect(api.conflicts).toHaveLength(0));
  expect(await store.drainQueue()).toEqual([]);
  expect(requests.some((request) => request.method === "PUT")).toBe(false);
});

it("visibly dismisses and reopens a conflict without resolving, discarding, or uploading intent", async () => {
  const id = await conflict();
  const pending = await store.drainQueue();
  const local = await store.get({ kind: "account", objectId });
  const requestCount = requests.length;
  const resolve = vi.spyOn(syncClient, "resolveConflict");
  await screen.getByRole("button", { name: "Close", exact: true }).click();
  await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
  await expect.element(screen.getByLabelText("Accounts")).toHaveTextContent("Cash: 100");
  expect(await store.drainQueue()).toEqual(pending);
  expect(await store.get({ kind: "account", objectId })).toEqual(local);
  expect(api.conflicts.map((entry) => entry.queueId)).toEqual([id]);
  await screen.getByRole("button", { name: "Review conflict" }).click();
  await expect.element(screen.getByRole("dialog")).toHaveTextContent("This device: saved record");
  expect(await store.drainQueue()).toEqual(pending);
  expect(await store.get({ kind: "account", objectId })).toEqual(local);
  expect(resolve).not.toHaveBeenCalled();
  expect(requests).toHaveLength(requestCount);
});

it("shows tombstone choices and preserves a later local edit when accepting server deletion", async () => {
  serverObject = await envelope("900", 5, true);
  const first = await conflict();
  await expect.element(screen.getByRole("dialog")).toHaveTextContent("Server: deleted");
  const next = await envelope("275", 2);
  const nextId = await store.putAndEnqueue({
    kind: "account",
    objectId,
    ciphertext: Uint8Array.from(atob(String(next.ciphertext)), (c) => c.charCodeAt(0)),
    nonce: Uint8Array.from(atob(String(next.nonce)), (c) => c.charCodeAt(0)),
    version: 2n,
    prevVersion: 1n,
    tombstone: false,
  });
  api.tick();
  await screen.getByRole("button", { name: "Use server version" }).click();
  await expect.element(screen.getByLabelText("Accounts")).toHaveTextContent("Cash: 275");
  await vi.waitFor(() =>
    expect(api.conflicts.some((entry) => entry.queueId === first)).toBe(false),
  );
  expect((await store.drainQueue()).map((entry) => entry.id)).toEqual([nextId]);
});

it("Keep this device reports a failed CAS without losing intent, then retries successfully", async () => {
  const id = await conflict();
  failResolution = true;
  await screen.getByRole("button", { name: "Keep this device" }).click();
  await expect
    .element(screen.getByRole("dialog"))
    .toHaveTextContent("Your device's changes are still pending");
  expect((await store.drainQueue()).map((entry) => entry.id)).toEqual([id]);
  failResolution = false;
  await screen.getByRole("button", { name: "Keep this device" }).click();
  await vi.waitFor(() => expect(api.conflicts).toHaveLength(0));
  await expect.element(screen.getByLabelText("Accounts")).toHaveTextContent("Cash: 100");
  expect(await store.drainQueue()).toEqual([]);
  expect((await store.get({ kind: "account", objectId }))?.serverSeq).toBe(6n);
});
