import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import type { Fixtures } from "../../playwright/global-setup";
import { BASE_URL } from "../../playwright/ports";

function loadFixtures(): Fixtures {
  const p = path.join(__dirname, "../../.playwright-fixtures.json");
  return JSON.parse(fs.readFileSync(p, "utf8")) as Fixtures;
}

// Two Argon2id derivations (login + unlock) dominate wall-clock.
test.setTimeout(90_000);

/** Backdates the persisted session window so the next boot sees it as expired,
 *  exercising the real lastActiveAt check rather than waiting 15 real minutes. */
async function backdateVault(page: Page, ageMs: number): Promise<void> {
  await page.evaluate(
    (age) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("privance.session", 1);
        open.onsuccess = () => {
          const db = open.result;
          const store = db.transaction("vault", "readwrite").objectStore("vault");
          const get = store.get("current");
          get.onsuccess = () => {
            const record = get.result;
            record.lastActiveAt = Date.now() - age;
            const put = store.put(record, "current");
            put.onsuccess = () => {
              db.close();
              resolve();
            };
            put.onerror = () => {
              db.close();
              reject(put.error);
            };
          };
          get.onerror = () => {
            db.close();
            reject(get.error);
          };
        };
        open.onerror = () => reject(open.error);
      }),
    ageMs,
  );
}

/** Emulates an installed standalone PWA by forcing the display-mode media query
 *  isStandalonePwa() reads, so a fresh navigation counts as a cold launch. */
async function emulateStandalonePwa(ctx: BrowserContext): Promise<void> {
  await ctx.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query: string) =>
      query.includes("display-mode: standalone")
        ? ({
            matches: true,
            media: query,
            onchange: null,
            addEventListener() {},
            removeEventListener() {},
            addListener() {},
            removeListener() {},
            dispatchEvent: () => false,
          } as MediaQueryList)
        : original(query);
  });
}

test.describe("session persistence + auto-lock", () => {
  test("survives refresh, locks on expiry, unlocks, and locks on demand", async ({ page }) => {
    // Real login lands straight on the unlocked dashboard: the auth -> app
    // redirect is a soft navigation that keeps the in-memory DEK, and the wrapped
    // DEK is persisted so the reload below survives too. duplicateUser is the one
    // fixture nothing else logs in as (it exists only as a duplicate-signup
    // target), so its login rate-limit budget is free here; a fresh signup would
    // blow the 3-per-minute signup cap the suite budgets.
    const { duplicateUser } = loadFixtures();

    await page.goto("/auth/login/");
    await page.getByLabel("Username").fill(duplicateUser.username);
    await page.getByLabel("Master password").fill(duplicateUser.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/app\/?$/, { timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Lock" })).toBeVisible({ timeout: 10_000 });

    // 1) Survive refresh: a same-tab reload unwraps the DEK locally; no /unlock.
    await page.reload();
    await expect(page).toHaveURL(/\/app\/?$/, { timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Lock" })).toBeVisible({ timeout: 10_000 });

    // 2) Expiry: push last activity past the 15-minute window, reload -> locked.
    await backdateVault(page, 16 * 60 * 1000);
    await page.reload();
    await expect(page).toHaveURL(/\/unlock\/?$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: /Unlock your/ })).toBeVisible({
      timeout: 10_000,
    });
    // Username is pre-filled from localStorage so the screen names the account.
    await expect(page.getByText(duplicateUser.username)).toBeVisible();

    // 3) A wrong password is rejected, then the real one unlocks. The retry
    // also exercises the kdfParams refetch after the consumed mount prefetch.
    await page.getByLabel("Master password").fill("not-the-password");
    await page.getByRole("button", { name: "Unlock" }).click();
    await expect(page.getByText("Wrong password.")).toBeVisible({ timeout: 30_000 });
    await page.getByLabel("Master password").fill(duplicateUser.password);
    await page.getByRole("button", { name: "Unlock" }).click();
    await expect(page).toHaveURL(/\/app\/?$/, { timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Lock" })).toBeVisible({ timeout: 10_000 });

    // 4) Explicit lock -> /unlock immediately.
    await page.getByRole("button", { name: "Lock" }).click();
    await expect(page).toHaveURL(/\/unlock\/?$/, { timeout: 15_000 });

    // 4b) A network failure on the background session check must not wipe the
    // locked state (offline PWA boot); only a confirmed 401 logs out.
    await page.route("**/api/auth/session", (route) => route.abort());
    await page.reload();
    await expect(page.getByRole("heading", { name: /Unlock your/ })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page).toHaveURL(/\/unlock\/?$/);
    await page.unroute("**/api/auth/session");

    // 5) Sign out from the locked screen -> login. handleSignOut awaits a
    // best-effort destroy of the per-user OPFS store (so ciphertext is not
    // orphaned); right after a lock-reload the prior session's access handles
    // may still be releasing, so the worker retries with backoff before the
    // navigation fires. Allow for that worst case.
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/auth\/login\/?$/, { timeout: 45_000 });
  });

  test("an installed PWA locks when relaunched, but survives a refresh", async ({ browser }) => {
    const { duplicateUser } = loadFixtures();
    const ctx = await browser.newContext({ baseURL: BASE_URL });
    // In a real PWA storage persists across a close, so a cold launch must
    // re-lock rather than auto-unlock within the window.
    await emulateStandalonePwa(ctx);
    const page = await ctx.newPage();

    await page.goto("/auth/login/");
    await page.getByLabel("Username").fill(duplicateUser.username);
    await page.getByLabel("Master password").fill(duplicateUser.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/app\/?$/, { timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Lock" })).toBeVisible({ timeout: 10_000 });

    // A pull-to-refresh (a reload) within the window still survives: no /unlock.
    await page.reload();
    await expect(page).toHaveURL(/\/app\/?$/, { timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Lock" })).toBeVisible({ timeout: 10_000 });

    // A cold launch (fresh navigation, as on reopening a closed PWA) re-locks
    // even though the 15-minute window has not elapsed. The re-lock redirects to
    // /unlock mid-load, which interrupts this navigation on Firefox; that
    // redirect is the behavior under test, so tolerate the interrupt and assert.
    await page.goto("/app/").catch(() => {});
    await expect(page).toHaveURL(/\/unlock\/?$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: /Unlock your/ })).toBeVisible({
      timeout: 10_000,
    });

    await ctx.close();
  });

  test("cold PWA boot does not flash the dashboard before redirecting to /unlock", async ({
    browser,
  }) => {
    const { duplicateUser } = loadFixtures();
    const ctx = await browser.newContext({ baseURL: BASE_URL });

    // A cold launch makes auth-context clear the vault and resolve to "locked".
    await emulateStandalonePwa(ctx);
    const page = await ctx.newPage();

    // Log in to create a stored session.
    await page.goto("/auth/login/");
    await page.getByLabel("Username").fill(duplicateUser.username);
    await page.getByLabel("Master password").fill(duplicateUser.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/app\/?$/, { timeout: 30_000 });

    // Install an observer that records whether any protected app chrome (the
    // main navigation rendered by the app layout) ever attaches. The dashboard
    // page content is gated behind the sync store, so the visible flash is the
    // nav shell, not the page heading. Evidence goes to sessionStorage because
    // it must survive the redirect to /unlock (init scripts re-run per document,
    // so a window flag would be reset by a hard navigation).
    await page.addInitScript(() => {
      const check = () => {
        if (document.querySelector('[aria-label="Main navigation"]') !== null) {
          sessionStorage.setItem("e2e.sawAppShell", "1");
        }
      };

      document.addEventListener("DOMContentLoaded", check);

      const observer = new MutationObserver(() => check());
      observer.observe(document.documentElement, { childList: true, subtree: true });
    });
    await page.evaluate(() => sessionStorage.removeItem("e2e.sawAppShell"));

    // Cold launch into /app/: auth resolves to "locked" so the render gate must
    // suppress the app shell and redirect to /unlock before any chrome paints.
    await page.goto("/app/").catch(() => {});
    await expect(page).toHaveURL(/\/unlock\/?$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: /Unlock your/ })).toBeVisible({
      timeout: 10_000,
    });

    const sawAppShell = await page.evaluate(() => sessionStorage.getItem("e2e.sawAppShell"));
    expect(sawAppShell).toBeNull();

    await ctx.close();
  });

  test("locking one tab locks the others", async ({ browser }) => {
    const { duplicateUser } = loadFixtures();
    const ctx = await browser.newContext({ baseURL: BASE_URL });

    const tab1 = await ctx.newPage();
    await tab1.goto("/auth/login/");
    await tab1.getByLabel("Username").fill(duplicateUser.username);
    await tab1.getByLabel("Master password").fill(duplicateUser.password);
    await tab1.getByRole("button", { name: "Sign in" }).click();
    await expect(tab1).toHaveURL(/\/app\/?$/, { timeout: 30_000 });

    // A second tab in the same context shares the vault + localStorage, so it
    // boots straight into the unlocked app with no password.
    const tab2 = await ctx.newPage();
    await tab2.goto("/app/");
    await expect(tab2.getByRole("button", { name: "Lock" })).toBeVisible({ timeout: 15_000 });

    // Locking tab1 must lock tab2 too (storage broadcast scrubs its in-memory DEK).
    await tab1.getByRole("button", { name: "Lock" }).click();
    await expect(tab2).toHaveURL(/\/unlock\/?$/, { timeout: 15_000 });

    await ctx.close();
  });
});
