/**
 * Browser tests for start-veiled re-assertion at the authentication boundary.
 * login()/unlock() must re-veil when the preference is on; the survive-refresh
 * rehydrate path must not, so an in-session reveal survives a reload.
 */

import type { ItemsKey } from "@privance/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { clearSession, persistSession } from "@/lib/storage/session-vault";
import { readVeil, writeStartVeil, writeVeil } from "@/lib/veil";
import { AuthProvider, USER_ID_KEY, USERNAME_KEY, useAuth } from "./auth-context";

const DEK_STORE_SYMBOL = Symbol.for("privance.dekStore.v1");

function makeItemsKey(): ItemsKey {
  return crypto.getRandomValues(new Uint8Array(32)) as unknown as ItemsKey;
}

function AuthHarness({ onReady }: { onReady: (api: ReturnType<typeof useAuth>) => void }) {
  const auth = useAuth();
  onReady(auth);
  return null;
}

async function renderAuth() {
  let api!: ReturnType<typeof useAuth>;
  await render(
    <AuthProvider>
      <AuthHarness
        onReady={(a) => {
          api = a;
        }}
      />
    </AuthProvider>,
  );
  return { getApi: () => api };
}

beforeEach(async () => {
  // The DEK store lives on globalThis across renders; clear it between tests.
  Reflect.deleteProperty(globalThis as Record<symbol, unknown>, DEK_STORE_SYMBOL);
  await clearSession();
  localStorage.clear();
});

afterEach(async () => {
  Reflect.deleteProperty(globalThis as Record<symbol, unknown>, DEK_STORE_SYMBOL);
  await clearSession();
  localStorage.clear();
});

describe("start-veiled at the authentication boundary", () => {
  it("re-veils on login when the preference is on", async () => {
    writeStartVeil(true);
    writeVeil(false);

    const { getApi } = await renderAuth();
    await getApi().login({
      user: { userId: "u-login", username: "alice" },
      itemsKey: makeItemsKey(),
      persistence: "session",
    });

    expect(readVeil()).toBe(true);
  });

  it("re-veils on unlock when the preference is on", async () => {
    writeStartVeil(true);
    writeVeil(false);

    const { getApi } = await renderAuth();
    await getApi().unlock({
      user: { userId: "u-unlock", username: "bob" },
      itemsKey: makeItemsKey(),
      persistence: "memory",
    });

    expect(readVeil()).toBe(true);
  });

  it("clears a stale veiled toggle on unlock when the preference is off", async () => {
    writeStartVeil(false);
    writeVeil(true);

    const { getApi } = await renderAuth();
    await getApi().unlock({
      user: { userId: "u-off", username: "carol" },
      itemsKey: makeItemsKey(),
      persistence: "memory",
    });

    expect(readVeil()).toBe(false);
  });

  it("does not re-veil on a survive-refresh rehydrate, preserving an in-session reveal", async () => {
    // Seed a live session so AuthProvider boots to "unlocked" via rehydrate, not login/unlock.
    const now = Date.now();
    await persistSession(makeItemsKey(), now);
    localStorage.setItem(USERNAME_KEY, "dave");
    localStorage.setItem(USER_ID_KEY, "u-rehydrate");
    writeStartVeil(true);
    writeVeil(false);

    const { getApi } = await renderAuth();
    await vi.waitFor(() => expect(getApi().state).toBe("unlocked"));

    expect(readVeil()).toBe(false);
  });
});
