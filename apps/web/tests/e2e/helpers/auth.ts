import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";

export type SignupResult = {
  phrase: string;
};

export type SessionSnapshot = {
  cookies: Awaited<ReturnType<BrowserContext["cookies"]>>;
  dekArray: number[];
};

/**
 * Installs a one-time DEK interceptor in the browser context. This must be
 * called before page.goto so the addInitScript is in place before the login
 * page loads.
 *
 * When the app's setDekStore is called (during login/signup crypto), the
 * exposed function fires and resolves the returned Promise with the DEK bytes.
 *
 * Why this is needed: Next.js 16 with output:"export" triggers a hard page
 * reload when router.replace("/app/") crosses layout-group boundaries (auth/ →
 * (app)/). The hard reload clears globalThis, so the DEK is gone before any
 * post-navigation page.evaluate could read it. exposeFunction survives the
 * hard reload and fires in the page context BEFORE the reload, giving us the
 * bytes we need.
 */
async function installDekCapture(page: Page): Promise<() => Promise<number[]>> {
  let resolve!: (arr: number[]) => void;
  const captured = new Promise<number[]>((res) => {
    resolve = res;
  });

  await page.exposeFunction("__e2e_capture_dek__", (arr: number[]) => {
    resolve(arr);
  });

  await page.addInitScript(() => {
    const sym = Symbol.for("privance.dekStore.v1");
    let _store: { itemsKey: Uint8Array } | undefined;

    Object.defineProperty(globalThis, sym, {
      get() {
        return _store;
      },
      set(v: { itemsKey: Uint8Array } | undefined) {
        _store = v;
        if (v?.itemsKey) {
          const capturer = (
            globalThis as unknown as { __e2e_capture_dek__: (arr: number[]) => Promise<void> }
          ).__e2e_capture_dek__;
          void capturer(Array.from(v.itemsKey));
        }
      },
      configurable: true,
    });
  });

  return () => captured;
}

/**
 * Logs in with an existing account and captures the DEK bytes before the hard
 * page navigation clears globalThis.
 *
 * Returns a SessionSnapshot (cookies + DEK bytes) that can be injected into
 * subsequent pages via restoreSession.
 *
 * Why loginAndCapture instead of plain login:
 *   Next.js 16 output:"export" crosses layout-group boundaries (auth/ → app/)
 *   via a hard page reload. That clears globalThis, destroying the in-memory
 *   DEK. We capture the DEK via page.exposeFunction before the reload fires.
 */
export async function loginAndCapture(
  browser: Browser,
  opts: { username: string; password: string },
): Promise<SessionSnapshot> {
  const ctx = await browser.newContext({ baseURL: "http://localhost:8081" });
  const page = await ctx.newPage();

  const waitForDek = await installDekCapture(page);

  await page.goto("/auth/login/");
  await page.getByLabel("Username").fill(opts.username);
  await page.getByLabel("Master password").fill(opts.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Capture DEK bytes before the hard navigation wipes globalThis
  const dekArray = await waitForDek();

  // Wait for navigation to complete (may redirect to /auth/login/ since DEK is
  // gone from globalThis on the new page — that's expected and fine here)
  await page.waitForURL(/\//, { timeout: 15_000 });

  const cookies = await ctx.cookies();
  await ctx.close();

  return { cookies, dekArray };
}

/**
 * Injects a previously captured DEK and session cookies into a page BEFORE
 * any navigation, so AuthProvider initialises as "unlocked" on first render.
 *
 * Call in beforeEach, before page.goto.
 */
export async function restoreSession(page: Page, snapshot: SessionSnapshot): Promise<void> {
  // addInitScript runs before each navigation in this page context.
  await page.addInitScript((arr: number[]) => {
    const sym = Symbol.for("privance.dekStore.v1");
    (globalThis as Record<symbol, unknown>)[sym] = { itemsKey: new Uint8Array(arr) };
  }, snapshot.dekArray);

  await page.context().addCookies(snapshot.cookies);
}

/**
 * Full signup flow: fills the form, submits, captures the recovery phrase,
 * acknowledges it, and lands on the dashboard.
 *
 * Returns the 12-word phrase so tests can use it for recovery flows.
 * Argon2 KDF derivation takes 3–8 s; caller must use a 60 s test timeout.
 *
 * Note: after signup the hard nav to "/" clears the DEK and the app redirects
 * back to login. For tests that need to verify the dashboard after signup,
 * use loginAndCapture + restoreSession to re-authenticate after signup
 * completes.
 */
export async function signup(
  page: Page,
  opts: { username: string; password: string },
): Promise<SignupResult> {
  await page.goto("/auth/signup/");

  await page.getByLabel("Username").fill(opts.username);
  await page.getByLabel("Master password", { exact: true }).fill(opts.password);
  await page.getByLabel("Confirm master password").fill(opts.password);
  await page.getByRole("button", { name: "Create account" }).click();

  // Wait for the phrase screen — argon2 derivation can take several seconds
  await expect(page.getByText("Write down your recovery phrase")).toBeVisible({
    timeout: 30_000,
  });

  const phrase = await capturePhrase(page);
  await acknowledgePhrase(page);

  // Wait for the navigation to complete. The hard reload to "/" wipes the DEK,
  // so the app will redirect to /auth/login/. Wait for either destination.
  await page.waitForURL(/\/(auth\/login\/)?/, { timeout: 15_000 });

  return { phrase };
}

/**
 * Signs up and immediately logs back in, returning a SessionSnapshot so the
 * caller can restore the authenticated state on subsequent pages.
 */
export async function signupAndLogin(
  browser: Browser,
  opts: { username: string; password: string },
): Promise<{ phrase: string; session: SessionSnapshot }> {
  // Step 1: Signup to create the account (phrase only, no session needed)
  const signupCtx = await browser.newContext({ baseURL: "http://localhost:8081" });
  const signupPage = await signupCtx.newPage();

  await signupPage.goto("/auth/signup/");
  await signupPage.getByLabel("Username").fill(opts.username);
  await signupPage.getByLabel("Master password", { exact: true }).fill(opts.password);
  await signupPage.getByLabel("Confirm master password").fill(opts.password);
  await signupPage.getByRole("button", { name: "Create account" }).click();

  await expect(signupPage.getByText("Write down your recovery phrase")).toBeVisible({
    timeout: 30_000,
  });
  const phrase = await capturePhrase(signupPage);
  await acknowledgePhrase(signupPage);
  await signupPage.waitForURL(/\//, { timeout: 15_000 });
  await signupCtx.close();

  // Step 2: Login to get a proper session snapshot with DEK captured
  const session = await loginAndCapture(browser, opts);

  return { phrase, session };
}

/**
 * Reads the 12 recovery words from the numbered grid and returns them as a
 * single space-separated string. Relies on the fieldset/legend structure
 * used in signup/page.tsx and recovery/page.tsx.
 */
export async function capturePhrase(page: Page): Promise<string> {
  // The phrase grid is inside a <fieldset> with a sr-only legend
  // "Recovery phrase words". Each word cell has two <span>s: the number
  // (mono, text-[10px]) and the word (mono, text-sm). We grab all
  // word cells in DOM order by selecting the larger mono spans inside the grid.
  const fieldset = page.locator("fieldset").filter({
    has: page.locator("legend", { hasText: "Recovery phrase words" }),
  });

  // Each word lives in a <div class="flex flex-col gap-0.5"> with two spans.
  // The second span carries the word text. There are exactly 12.
  const wordCells = fieldset.locator("div.flex.flex-col.gap-0\\.5");
  await expect(wordCells).toHaveCount(12, { timeout: 5_000 });

  const words: string[] = [];
  for (let i = 0; i < 12; i++) {
    const cell = wordCells.nth(i);
    // Second span = the word (first span = the number)
    const word = await cell.locator("span").nth(1).innerText();
    words.push(word.trim());
  }

  return words.join(" ");
}

/**
 * Checks the "I have written down my recovery phrase" checkbox and clicks
 * Continue. Assumes the phrase acknowledgement screen is already visible.
 */
export async function acknowledgePhrase(page: Page): Promise<void> {
  await page.getByLabel("I have written down my recovery phrase in a safe place.").check();
  await page.getByRole("button", { name: "Continue" }).click();
}

/**
 * Logs in with an existing account and waits for the URL to change.
 * Argon2 derivation takes 3–8 s; caller must use a 60 s test timeout.
 *
 * Note: after the DEK is set and router.replace("/app/") fires, Next.js does
 * a hard navigation that clears globalThis. The resulting page at "/app/"
 * will redirect to /auth/login/ because the DEK is gone. Use loginAndCapture
 * + restoreSession when you need the dashboard to actually render.
 */
export async function login(
  page: Page,
  opts: { username: string; password: string },
): Promise<void> {
  await page.goto("/auth/login/");

  await page.getByLabel("Username").fill(opts.username);
  await page.getByLabel("Master password").fill(opts.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Wait for navigation to complete (may go to "/" or back to "/auth/login/")
  await page.waitForURL(/\//, { timeout: 30_000 });
}

/**
 * Clicks the Sign out button in the top bar.
 */
export async function logout(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/auth/login/", { timeout: 10_000 });
}

/**
 * Full account recovery flow: navigate to /auth/recovery/, enter credentials
 * + phrase, complete the new-phrase acknowledgement.
 *
 * Returns the new phrase issued after recovery.
 * Note: same hard-nav caveat as login — the caller must use loginAndCapture
 * + restoreSession if the dashboard needs to be reachable after recovery.
 */
export async function recover(
  page: Page,
  opts: { username: string; phrase: string; newPassword: string },
): Promise<{ newPhrase: string }> {
  await page.goto("/auth/recovery/");

  await page.getByLabel("Username").fill(opts.username);
  await page.getByLabel("Recovery phrase (12 words)").fill(opts.phrase);
  await page.getByLabel("New master password", { exact: true }).fill(opts.newPassword);
  await page.getByLabel("Confirm new master password").fill(opts.newPassword);
  await page.getByRole("button", { name: "Recover account" }).click();

  // Argon2 × 2 derivations — allow 45 s
  await expect(page.getByText("Save your new recovery phrase")).toBeVisible({
    timeout: 45_000,
  });

  const newPhrase = await capturePhrase(page);

  // Acknowledge the new phrase (label is slightly different on recovery screen)
  await page.getByLabel("I have written down my new recovery phrase in a safe place.").check();
  await page.getByRole("button", { name: "Continue" }).click();

  await page.waitForURL(/\//, { timeout: 15_000 });

  return { newPhrase };
}
