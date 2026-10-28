import {
  Decimal,
  encryptAead,
  type ItemsKey,
  KDF_PARAM_VERSION,
  KIND_ACCOUNT,
  KIND_HOLDING,
  KIND_HOLDING_GROUP,
  KIND_PLAN,
  KIND_SNAPSHOT,
  LABEL_VERSION,
  PlanPayloadSchema,
  SCALE_CENTS,
} from "@privance/core";
import { toBase64 } from "@privance/core/sync";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import "@/app/globals.css";
import { SyncStatus } from "@/components/SyncStatus";
import { AccountForm } from "@/features/accounts/components/account-form";
import {
  useCreateAccount,
  useDeleteAccount,
  useUpdateAccount,
} from "@/features/accounts/mutations";
import { useAccountsQuery } from "@/features/accounts/queries";
import { useDashboardData } from "@/features/dashboard/queries";
import { useGroupMutations, useHoldingMutations } from "@/features/holdings/mutations";
import { AccountDetailSheet } from "@/features/invest/components/account-detail-sheet";
import { useSavePlan } from "@/features/plan/mutations";
import { SpendScreen } from "@/features/spend/components/spend-screen";
import { useSpendMutations } from "@/features/spend/mutations";
import { SyncProvider, useSync } from "./sync-context";

const fixture = vi.hoisted(() => ({
  key: new Uint8Array(32).fill(7),
  userId: "",
  cleanup: null as null | (() => Promise<void>),
}));
vi.mock("./auth-context", () => ({
  readItemsKey: () => fixture.key,
  USER_ID_KEY: "test-user-id",
  useAuth: () => ({
    state: "unlocked",
    user: { userId: fixture.userId },
    lock: vi.fn(),
    registerLogoutCleanup: (cleanup: () => Promise<void>) => {
      fixture.cleanup = cleanup;
      return () => {};
    },
  }),
}));
const prices = new Map<string, Decimal>();
const profilesByTicker = new Map<string, import("@/lib/api/symbol-profiles").SymbolProfileEntry>();
vi.mock("@/lib/queries/prices", () => ({
  usePricesQuery: () => ({ prices, previousPrices: prices, isLoading: false }),
}));
vi.mock("@/lib/queries/profiles", () => ({
  useSymbolProfilesQuery: () => ({ profilesByTicker }),
}));

let api: ReturnType<typeof useSync>;
let create: ReturnType<typeof useCreateAccount>;
let update: ReturnType<typeof useUpdateAccount>;
let remove: ReturnType<typeof useDeleteAccount>;
let holdings: ReturnType<typeof useHoldingMutations>;
let groups: ReturnType<typeof useGroupMutations>;
let spend: ReturnType<typeof useSpendMutations>;
let plan: ReturnType<typeof useSavePlan>;
let accounts: ReturnType<typeof useAccountsQuery>;
let screen: Awaited<ReturnType<typeof render>>;
let mode: "opfs" | "memory";
let offline: boolean;
let conflict: boolean;
let sequence: number;
let serverRecords: Map<string, Record<string, unknown>>;
let workerUrls: string[];
let posts: number;

function Snapshot() {
  const data = useDashboardData();
  return <output aria-label="Dashboard status">{data.status}</output>;
}
function Harness({
  detail = false,
  snapshot = false,
  spendScreen = false,
}: {
  detail?: boolean;
  snapshot?: boolean;
  spendScreen?: boolean;
}) {
  api = useSync();
  create = useCreateAccount();
  update = useUpdateAccount();
  remove = useDeleteAccount();
  holdings = useHoldingMutations();
  groups = useGroupMutations();
  spend = useSpendMutations();
  plan = useSavePlan();
  accounts = useAccountsQuery();
  const [formOpen, setFormOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(true);
  const account = accounts.status === "success" ? (accounts.data[0] ?? null) : null;
  return (
    <>
      <SyncStatus />
      <output aria-label="Accounts">
        {accounts.status === "success"
          ? accounts.data.map((a) => a.payload.name).join(", ") || "No accounts"
          : accounts.status}
      </output>
      <button type="button" onClick={() => setFormOpen(true)}>
        New account
      </button>
      <AccountForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSubmit={async (values, id) => {
          await create.create({
            id,
            name: values.name,
            kind: values.kind,
            currency: values.currency,
            balanceString: values.balance,
          });
          setFormOpen(false);
        }}
      />
      {detail && (
        <AccountDetailSheet
          open={detailOpen && account !== null}
          account={account}
          totalValue={Decimal.zero(SCALE_CENTS)}
          holdingValuations={[]}
          holdingsByAccount={[]}
          onClose={() => setDetailOpen(false)}
          onEdit={() => {}}
          onDelete={remove.deleteAccount}
        />
      )}
      {snapshot && <Snapshot />}
      {spendScreen && <SpendScreen />}
    </>
  );
}
async function mount(props: { detail?: boolean; snapshot?: boolean; spendScreen?: boolean } = {}) {
  screen = await render(
    <SyncProvider>
      <Harness {...props} />
    </SyncProvider>,
  );
  await vi.waitFor(() => expect(api.store).not.toBeNull());
  if (!api.store || !api.client) throw new Error("Sync not initialized");
  expect(api.store.mode).toBe(mode);
  await vi.waitFor(() => expect(accounts.status).toBe("success"));
}
async function reload(props: { detail?: boolean; snapshot?: boolean; spendScreen?: boolean } = {}) {
  api.client?.stop();
  await api.store?.close();
  await screen.unmount();
  await mount(props);
}
const cashInput = (id = "saved-account") => ({
  id,
  name: "Saved cash",
  kind: "cash" as const,
  currency: "USD",
  balanceString: "100.00",
});
function currentAccount() {
  if (accounts.status !== "success" || !accounts.data[0]) throw new Error("Account missing");
  return accounts.data[0];
}
async function queued(
  objectId: string,
  kind = KIND_ACCOUNT,
  payload: unknown = {
    kind: "cash",
    subKind: "checking",
    name: "Queued cash",
    currency: "USD",
    balanceCents: "10000",
  },
) {
  const encrypted = encryptAead({
    plaintext: new TextEncoder().encode(JSON.stringify(payload)),
    key: fixture.key as ItemsKey,
    aad: {
      recordUuid: objectId,
      kind,
      labelVersion: LABEL_VERSION,
      kdfParamVersion: KDF_PARAM_VERSION,
    },
  });
  return { kind, objectId, ...encrypted, version: 1n, prevVersion: undefined, tombstone: false };
}
beforeEach(() => {
  mode = "memory";
  offline = false;
  conflict = false;
  sequence = 0;
  posts = 0;
  workerUrls = [];
  serverRecords = new Map();
  fixture.userId = crypto.randomUUID();
  fixture.cleanup = null;
  const OriginalWorker = globalThis.Worker;
  vi.stubGlobal(
    "Worker",
    class extends OriginalWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        if (mode === "memory" && String(url).includes("privance-worker.mjs")) {
          const workerUrl = new URL(String(url), location.href).href;
          url = URL.createObjectURL(
            new Blob(
              [
                `Object.defineProperty(navigator.storage, "getDirectory", { value: async () => { throw new Error("OPFS disabled for save regression"); } }); await import(${JSON.stringify(workerUrl)});`,
              ],
              { type: "text/javascript" },
            ),
          );
          workerUrls.push(String(url));
        }
        super(url, options);
      }
    },
  );
  const originalFetch = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (!String(url).includes("/api/sync/")) return originalFetch(url, init);
      if (offline) throw new TypeError("Network unavailable");
      if (String(url).includes("/changes")) {
        const after = BigInt(new URL(String(url), location.href).searchParams.get("after") ?? "0");
        return Response.json({
          changes: [...serverRecords.values()].filter(
            (row) => BigInt(String(row.server_seq)) > after,
          ),
          next: null,
        });
      }
      if (init?.method === "POST") {
        posts++;
        const body = JSON.parse(String(init.body));
        const results = [...body.puts, ...body.deletes].map((row: Record<string, string>) => {
          const existing = serverRecords.get(String(row.object_id));
          if (
            conflict ||
            (existing ? row.prev_version !== existing.version : row.prev_version !== undefined)
          )
            return {
              id: row.object_id,
              ok: false,
              conflict: { current_version: String(existing?.version ?? "5") },
            };
          const tombstone = body.deletes.includes(row);
          const version = tombstone ? String(BigInt(row.prev_version ?? "0") + 1n) : row.version;
          const stored = {
            ...existing,
            ...row,
            id: row.object_id,
            version,
            server_seq: String(++sequence),
            tombstone,
          };
          serverRecords.set(String(row.object_id), stored);
          return { id: row.object_id, ok: true, version, server_seq: stored.server_seq };
        });
        return Response.json({ results });
      }
      const id = decodeURIComponent(
        new URL(String(url), location.href).pathname.split("/").at(-1) ?? "",
      );
      return Response.json(serverRecords.get(id) ?? {}, {
        status: serverRecords.has(id) ? 200 : 404,
      });
    }),
  );
});
afterEach(async () => {
  api?.client?.stop();
  await fixture.cleanup?.();
  await screen?.unmount();
  for (const url of workerUrls) URL.revokeObjectURL(url);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("keeps the Spend draft and retry identity through a delayed failed memory-mode upload", async () => {
  await mount({ spendScreen: true });
  const store = api.store;
  if (!store) throw new Error("Store missing");
  api.client?.stop();
  const fetcher = globalThis.fetch;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let failNextPost = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST" && failNextPost) {
        failNextPost = false;
        await gate;
        throw new TypeError("Network unavailable after local save");
      }
      return fetcher(url, init);
    }),
  );
  await screen.getByRole("button", { name: "Add a recurring expense" }).click();
  await screen.getByRole("textbox", { name: "Name", exact: true }).fill("Rent draft");
  await screen.getByRole("textbox", { name: "Amount", exact: true }).fill("1000");
  await screen.getByRole("combobox", { name: "Interval unit" }).selectOptions("month");
  await screen.getByRole("combobox", { name: "Category" }).selectOptions("housing");
  await screen.getByRole("button", { name: "Add expense", exact: true }).click();
  try {
    await expect.element(screen.getByTestId("spend-monthly-total")).toMatchTextContent("$1,000");
  } finally {
    release();
  }
  const dialog = screen.getByRole("dialog", { name: "Add expense" });
  await expect.element(dialog.getByRole("alert")).toMatchTextContent("Not saved to the server");
  await expect
    .element(dialog.getByRole("textbox", { name: "Name", exact: true }))
    .toHaveValue("Rent draft");
  await expect
    .element(dialog.getByRole("textbox", { name: "Amount", exact: true }))
    .toHaveValue("1000");
  const pending = await store.drainQueue();
  expect(pending).toHaveLength(1);
  expect(serverRecords.size).toBe(0);

  await dialog.getByRole("textbox", { name: "Amount", exact: true }).fill("1200");
  await dialog.getByRole("button", { name: "Add expense", exact: true }).click();
  await expect.element(dialog).not.toBeInTheDocument();
  expect([...serverRecords.keys()]).toEqual([pending[0]?.objectId]);
  expect(await store.drainQueue()).toEqual([]);
  await reload({ spendScreen: true });
  await expect.element(screen.getByTestId("spend-monthly-total")).toMatchTextContent("$1,200");
  expect(await api.store?.list({ kind: "spend_item" })).toHaveLength(1);
});

it.each(["memory", "opfs"] as const)(
  "preserves an unsaved Spend draft through an unrelated remote pull in %s mode",
  async (storageMode) => {
    mode = storageMode;
    await mount({ spendScreen: true });
    const store = api.store;
    const client = api.client;
    if (!store || !client) throw new Error("Sync missing");
    client.stop();
    await screen.getByRole("button", { name: "Add a recurring expense" }).click();
    await screen.getByRole("textbox", { name: "Name", exact: true }).fill("Unsaved draft");
    await screen.getByRole("textbox", { name: "Amount", exact: true }).fill("125");
    const list = vi.spyOn(store, "list");
    const remote = await queued("unrelated-account");
    serverRecords.set(remote.objectId, {
      ...remote,
      id: remote.objectId,
      object_id: remote.objectId,
      ciphertext: toBase64(remote.ciphertext),
      nonce: toBase64(remote.nonce),
      version: "1",
      server_seq: String(++sequence),
    });
    expect((await client.pullChanges()).applied).toBe(1);
    await vi.waitFor(() => expect(list).toHaveBeenCalledWith({ kind: "spend_item" }));
    await screen.rerender(
      <SyncProvider>
        <Harness spendScreen />
      </SyncProvider>,
    );
    await expect
      .element(screen.getByRole("textbox", { name: "Name", exact: true }))
      .toHaveValue("Unsaved draft");
    await expect
      .element(screen.getByRole("textbox", { name: "Amount", exact: true }))
      .toHaveValue("125");
    expect(await store.drainQueue()).toEqual([]);
  },
);

it("requires exact online memory-mode confirmation and restores the record from server after worker recreation", async () => {
  await mount();
  await expect
    .element(screen.getByText("Temporary storage:", { exact: false }))
    .toMatchTextContent("saves require server confirmation");
  await create.create(cashInput());
  expect(await api.store?.drainQueue()).toEqual([]);
  expect(serverRecords.get("saved-account")?.ciphertext).toBeTruthy();
  await reload();
  await expect.element(screen.getByLabelText("Accounts")).toMatchTextContent("Saved cash");
  expect((await api.store?.get({ kind: KIND_ACCOUNT, objectId: "saved-account" }))?.serverSeq).toBe(
    1n,
  );
});

it("shows unconfirmed memory-mode saves in the actual form, not success, even when navigator reports online", async () => {
  await mount();
  expect(navigator.onLine).toBe(true);
  offline = true;
  await screen.getByRole("button", { name: "New account" }).click();
  await screen.getByRole("textbox", { name: "Name" }).fill("Unsaved cash");
  await screen.getByRole("combobox", { name: "Account type" }).selectOptions("checking");
  await screen.getByRole("textbox", { name: "Current balance" }).fill("10.00");
  await screen.getByRole("button", { name: "Add account" }).click();
  await expect.element(screen.getByRole("dialog")).toMatchTextContent("Not saved to the server");
  await expect
    .element(screen.getByRole("dialog"))
    .toMatchTextContent("Reloading can lose these changes");
  expect(await api.store?.drainQueue()).toHaveLength(1);
  expect(serverRecords.size).toBe(0);
  offline = false;
  // No pending push on reload: memory data truly disappears.
  await reload();
  await vi.waitFor(() => expect(accounts.status).toBe("success"));
});

it("does not count a conflict or another revision's acknowledgement as a saved mutation", async () => {
  await mount();
  const remote = await queued("saved-account");
  serverRecords.set(remote.objectId, {
    ...remote,
    id: remote.objectId,
    object_id: remote.objectId,
    ciphertext: toBase64(remote.ciphertext),
    nonce: toBase64(remote.nonce),
    version: "5",
    server_seq: "5",
  });
  conflict = true;
  await expect(create.create(cashInput())).rejects.toThrow("Not saved to the server");
  expect(await api.store?.drainQueue()).toHaveLength(1);
  expect(api.conflicts).toHaveLength(1);
  const client = api.client;
  if (!client) throw new Error("Client missing");
  vi.spyOn(client, "pushPending").mockResolvedValue({
    results: [],
    confirmedQueueIds: ["another-revision"],
  });
  await expect(create.create(cashInput("another-account"))).rejects.toThrow(
    "Not saved to the server",
  );
  expect(await api.store?.drainQueue()).toHaveLength(2);
});

it("accepts an exact acknowledgement from a background push that wins the enqueue race", async () => {
  await mount();
  const store = api.store;
  const client = api.client;
  if (!store || !client) throw new Error("Sync missing");
  const put = store.putAndEnqueue.bind(store);
  vi.spyOn(store, "putAndEnqueue").mockImplementation(async (input) => {
    const id = await put(input);
    // This push completes before save() receives the queue ID back.
    await client.pushPending();
    return id;
  });
  await create.create(cashInput());
  expect(posts).toBe(1);
  expect(await store.drainQueue()).toEqual([]);
  expect(api.saveError).toBeNull();
});

it("accepts this save's committed early batch even if later queued work fails", async () => {
  await mount();
  const store = api.store;
  if (!store) throw new Error("Store missing");
  const put = store.putAndEnqueue.bind(store);
  vi.spyOn(store, "putAndEnqueue").mockImplementation(async (input) => {
    const id = await put(input);
    for (let i = 0; i < 500; i++) await put({ ...input, id: `later-${i}`, objectId: `later-${i}` });
    return id;
  });
  const fetcher = globalThis.fetch;
  let batches = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST" && ++batches === 2)
        throw new TypeError("later batch unavailable");
      return fetcher(url, init);
    }),
  );
  await create.create(cashInput());
  expect(await store.drainQueue()).toHaveLength(1);
  expect(serverRecords.has("saved-account")).toBe(true);
  expect(api.saveError).toBeNull();
});

it("retains durable OPFS offline local-first saves across worker recreation without an unhandled push rejection", async () => {
  mode = "opfs";
  await mount();
  offline = true;
  await create.create(cashInput());
  expect(await api.store?.drainQueue()).toHaveLength(1);
  await reload();
  await expect.element(screen.getByLabelText("Accounts")).toMatchTextContent("Saved cash");
  expect(await api.store?.drainQueue()).toHaveLength(1);
  expect(api.saveError).toBeNull();
});

it("rejects deleting an account with live encrypted holdings visibly in its actual sheet, with no side effects; allows it after holding tombstone", async () => {
  await mount({ detail: true });
  await create.create({ ...cashInput(), kind: "investment" });
  await vi.waitFor(() => expect(accounts.status).toBe("success"));
  const holdingId = await holdings.createHolding({
    accountId: "saved-account",
    groupId: null,
    ticker: "AAPL",
    assetType: "stock",
    proxyTicker: null,
    sharesMajor: "1",
    sharesScale: 4,
    costBasisCents: "10000",
  });
  const before = await api.store?.get({ kind: KIND_ACCOUNT, objectId: "saved-account" });
  const queue = await api.store?.drainQueue();
  const writes = posts;
  await screen.getByRole("button", { name: "Delete", exact: true }).click();
  await screen.getByRole("button", { name: "Tap again to delete" }).click();
  await expect
    .element(screen.getByRole("dialog"))
    .toMatchTextContent("Move or delete holdings first");
  expect(await api.store?.get({ kind: KIND_ACCOUNT, objectId: "saved-account" })).toEqual(before);
  expect(await api.store?.drainQueue()).toEqual(queue);
  expect(posts).toBe(writes);
  await holdings.deleteHolding(holdingId);
  expect((await api.store?.get({ kind: KIND_HOLDING, objectId: holdingId }))?.tombstone).toBe(true);
  await screen.getByRole("button", { name: "Delete", exact: true }).click();
  await screen.getByRole("button", { name: "Tap again to delete" }).click();
  await vi.waitFor(async () =>
    expect(
      (await api.store?.get({ kind: KIND_ACCOUNT, objectId: "saved-account" }))?.tombstone,
    ).toBe(true),
  );
  await vi.waitFor(() => expect(accounts.status).toBe("success"));
});

it("migrates account, holding, group, spend and plan create/update/delete callers to the atomic public save API", async () => {
  await mount();
  const store = api.store;
  if (!store) throw new Error("Store missing");
  const put = vi.spyOn(store, "put");
  const enqueue = vi.spyOn(store, "enqueue");
  const atomic = vi.spyOn(store, "putAndEnqueue");
  await create.create({ ...cashInput(), kind: "investment" });
  await expect.element(screen.getByLabelText("Accounts")).toMatchTextContent("Saved cash");
  await update.update({
    account: currentAccount(),
    name: "Updated",
    currency: "USD",
    balanceString: "200",
  });
  const groupId = await groups.createGroup({ name: "Group" });
  await groups.updateGroup({ id: groupId, name: "Renamed" });
  await groups.deleteGroup(groupId);
  const holdingId = await holdings.createHolding({
    accountId: "saved-account",
    groupId: null,
    ticker: "AAPL",
    assetType: "stock",
    proxyTicker: null,
    sharesMajor: "1",
    sharesScale: 4,
    costBasisCents: "10000",
  });
  await holdings.updateHolding({ id: holdingId, sharesMajor: "2" });
  await holdings.deleteHolding(holdingId);
  const values = {
    name: "Expense",
    amount: "12.00",
    intervalCount: "1",
    intervalUnit: "month" as const,
    category: "other" as const,
    group: "essentials" as const,
    status: "active" as const,
    nextRenewalAt: "",
  };
  const spendId = await spend.createItem(values);
  await spend.updateItem(spendId, { ...values, amount: "15.00" });
  await spend.deleteItem(spendId);
  await plan.savePlan(
    PlanPayloadSchema.parse({
      schemaVersion: 1,
      preset: "balanced",
      currentAge: 35,
      planUntilAge: 90,
      monthlyContributionCents: "500000",
      annualSpendCents: "4000000",
      swrBps: 400,
      seed: "12345",
    }),
  );
  await remove.deleteAccount(currentAccount());
  expect(put).not.toHaveBeenCalled();
  expect(enqueue).not.toHaveBeenCalled();
  expect(atomic.mock.calls.map(([input]) => input.kind)).toEqual([
    KIND_ACCOUNT,
    KIND_ACCOUNT,
    KIND_HOLDING_GROUP,
    KIND_HOLDING_GROUP,
    KIND_HOLDING_GROUP,
    KIND_HOLDING,
    KIND_HOLDING,
    KIND_HOLDING,
    "spend_item",
    "spend_item",
    "spend_item",
    KIND_PLAN,
    KIND_ACCOUNT,
  ]);
  expect(atomic.mock.calls.every(([input]) => typeof input.id === "string")).toBe(true);
  expect(await store.drainQueue()).toEqual([]);
  expect((await store.get({ kind: KIND_ACCOUNT, objectId: "saved-account" }))?.tombstone).toBe(
    true,
  );
});

it("uses exact acknowledged atomic background snapshots, restoring them from server on reload", async () => {
  await mount();
  await create.create(cashInput());
  const store = api.store;
  if (!store) throw new Error("Store missing");
  const put = vi.spyOn(store, "put");
  const enqueue = vi.spyOn(store, "enqueue");
  const atomic = vi.spyOn(store, "putAndEnqueue");
  await screen.rerender(
    <SyncProvider>
      <Harness snapshot />
    </SyncProvider>,
  );
  await vi.waitFor(() =>
    expect([...serverRecords.values()].some((record) => record.kind === KIND_SNAPSHOT)).toBe(true),
  );
  expect(await api.store?.drainQueue()).toEqual([]);
  expect(put).not.toHaveBeenCalled();
  expect(enqueue).not.toHaveBeenCalled();
  expect(atomic.mock.calls.map(([input]) => input.kind)).toEqual([KIND_SNAPSHOT]);
  await reload({ snapshot: true });
  await expect.element(screen.getByLabelText("Dashboard status")).toMatchTextContent("ready");
  expect(await api.store?.list({ kind: KIND_SNAPSHOT })).toHaveLength(1);
});

it("surfaces unconfirmed memory-mode background snapshots instead of silent success", async () => {
  await mount();
  await create.create(cashInput());
  offline = true;
  await screen.rerender(
    <SyncProvider>
      <Harness snapshot />
    </SyncProvider>,
  );
  await vi.waitFor(() => expect(api.saveError).toContain("A save could not be confirmed"));
  await expect
    .element(screen.getByRole("alert"))
    .toMatchTextContent("Reloading can lose unconfirmed changes");
  expect((await api.store?.drainQueue())?.map((row) => row.kind)).toEqual([KIND_SNAPSHOT]);
  expect([...serverRecords.values()].some((record) => record.kind === KIND_SNAPSHOT)).toBe(false);
});

it("keeps a memory-mode mutation pending until its exact upload is acknowledged", async () => {
  await mount();
  const fetcher = globalThis.fetch;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let waiting = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") {
        waiting = true;
        await gate;
      }
      return fetcher(url, init);
    }),
  );
  let completed = false;
  const saving = create.create(cashInput()).then(() => {
    completed = true;
  });
  await vi.waitFor(() => expect(waiting).toBe(true));
  expect(completed).toBe(false);
  expect(create.state).toBe("pending");
  expect(serverRecords.size).toBe(0);
  release();
  await saving;
  expect(completed).toBe(true);
  expect(await api.store?.drainQueue()).toEqual([]);
});

it("recognizes exact confirmations across concurrent memory-mode saves without a session-wide ID ledger", async () => {
  await mount();
  await Promise.all([create.create(cashInput("first")), create.create(cashInput("second"))]);
  expect([...serverRecords.keys()].sort()).toEqual(["first", "second"]);
  expect(await api.store?.drainQueue()).toEqual([]);
  expect(api.saveError).toBeNull();
});

it.each([KIND_ACCOUNT, KIND_HOLDING, KIND_HOLDING_GROUP, "spend_item"])(
  "retains one %s object across a lost response and edited retry, and gives fresh intent a new ID",
  async (kind) => {
    await mount();
    const objectId = crypto.randomUUID();
    const save = async (id: string, changed = false) => {
      switch (kind) {
        case KIND_ACCOUNT:
          return create.create({ ...cashInput(id), name: changed ? "Changed cash" : "Saved cash" });
        case KIND_HOLDING:
          return holdings.createHolding(
            {
              accountId: "parent",
              groupId: null,
              ticker: "AAPL",
              assetType: "stock",
              proxyTicker: null,
              sharesMajor: changed ? "2" : "1",
              sharesScale: 4,
              costBasisCents: "10000",
            },
            id,
          );
        case KIND_HOLDING_GROUP:
          return groups.createGroup({ name: changed ? "Changed group" : "Group" }, id);
        default:
          return spend.createItem(
            {
              name: changed ? "Changed expense" : "Expense",
              amount: "12.00",
              intervalCount: "1",
              intervalUnit: "month",
              category: "other",
              group: "essentials",
              status: "active",
              nextRenewalAt: "",
            },
            id,
          );
      }
    };
    const fetcher = globalThis.fetch;
    let loseResponse = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const response = await fetcher(url, init);
        if (init?.method === "POST" && loseResponse) {
          loseResponse = false;
          // The server committed, but this device never received its acknowledgement.
          throw new TypeError("Response lost after commit");
        }
        return response;
      }),
    );
    await expect(save(objectId)).rejects.toThrow("Not saved to the server");
    const first = await api.store?.drainQueue();
    expect(first).toHaveLength(1);
    expect(serverRecords.size).toBe(1);
    await expect(save(objectId, true)).rejects.toThrow("Not saved to the server");
    const retried = await api.store?.drainQueue();
    expect(retried?.map((row) => [row.objectId, row.version, row.prevVersion])).toEqual([
      [objectId, 1n, undefined],
      [objectId, 2n, 1n],
    ]);
    expect(retried?.[0]).toEqual(first?.[0]);
    expect(retried?.[1]?.ciphertext).not.toEqual(first?.[0]?.ciphertext);
    expect(serverRecords.size).toBe(1);
    expect((await api.store?.get({ kind, objectId }))?.version).toBe(2n);
    const freshId = crypto.randomUUID();
    await save(freshId);
    expect([...serverRecords.keys()].sort()).toEqual([objectId, freshId].sort());
    expect((await api.store?.drainQueue())?.map((row) => row.objectId)).toEqual([
      objectId,
      objectId,
    ]);
  },
);
