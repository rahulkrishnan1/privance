import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { BASE_URL } from "../../../playwright/ports";

export type SignupResult = {
  phrase: string;
};

/**
 * Fills the signup form so the values survive late hydration. On a cold
 * dev server compile, React can hydrate between fills and reset controlled
 * inputs to empty (observed as "Username is required" with passwords intact).
 * Re-fill any wiped field and only return once every value sticks across a
 * short settle.
 */
async function fillSignupForm(
  page: Page,
  opts: { username: string; password: string },
): Promise<void> {
  const username = page.getByLabel("Username");
  const password = page.getByLabel("Master password", { exact: true });
  const confirm = page.getByLabel("Confirm master password");
  await expect(async () => {
    if ((await username.inputValue()) !== opts.username) await username.fill(opts.username);
    if ((await password.inputValue()) !== opts.password) await password.fill(opts.password);
    if ((await confirm.inputValue()) !== opts.password) await confirm.fill(opts.password);
    await page.waitForTimeout(150);
    expect(await username.inputValue()).toBe(opts.username);
    expect(await password.inputValue()).toBe(opts.password);
    expect(await confirm.inputValue()).toBe(opts.password);
  }).toPass({ timeout: 15_000 });
}

/**
 * Clicks Create account and waits for the recovery-phrase screen, retrying
 * through the signup rate limit (3 per IP per minute by design; parallel
 * browser projects can race past the budget at run start and surface the
 * generic signup alert). Bounded retries keep genuine failures visible.
 */
async function submitSignup(page: Page): Promise<void> {
  // Redesigned signup shows the "Your recovery phrase." heading; the pre-redesign
  // copy was "Write down your recovery phrase". Accept either so the helper works
  // across both UIs.
  const phrase = page
    .getByRole("heading", { name: /recovery phrase/i })
    .or(page.getByText("Write down your recovery phrase"));
  const failed = page.getByText("Signup failed. Try again.");
  // 12 attempts spans ~4 minutes of windows: a full five-project run queues
  // ~12 signups against the 3-per-minute budget, and the last in line waits.
  for (let attempt = 0; attempt < 12; attempt++) {
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(phrase.or(failed).first()).toBeVisible({ timeout: 30_000 });
    if (await phrase.isVisible()) return;
    await page.waitForTimeout(21_000);
  }
  await expect(phrase).toBeVisible({ timeout: 1_000 });
}

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
 * Logs in with an existing account and captures the DEK bytes.
 *
 * Returns a SessionSnapshot (cookies + DEK bytes) that can be injected into
 * subsequent pages via restoreSession.
 *
 * Use loginAndCapture instead of plain login when you need the DEK for
 * later restoreSession calls.
 */
export async function loginAndCapture(
  browser: Browser,
  opts: { username: string; password: string },
): Promise<SessionSnapshot> {
  const ctx = await browser.newContext({ baseURL: BASE_URL });
  const page = await ctx.newPage();

  const waitForDek = await installDekCapture(page);

  await page.goto("/auth/login");
  // Vite client-side render: wait for React hydration before filling.
  await page.waitForTimeout(800);
  await expect(page.getByLabel("Username")).toBeVisible({ timeout: 15_000 });
  const usernameEl = page.getByLabel("Username");
  await usernameEl.click();
  await usernameEl.pressSequentially(opts.username);
  await page.getByLabel("Master password").fill(opts.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Capture DEK bytes set by the crypto layer during login
  const dekArray = await waitForDek();

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
 * Waits for the initial sync to fully drain. The top-bar sync pill reads "synced"
 * only once the sync context's `initialising` flips false, which happens after
 * drainAllChanges() has populated the local store. Until then an Invest/app
 * screen can flip from its empty to its populated state, and a flip landing
 * mid-interaction races form fills (firefox's slower pull makes this reliable to
 * hit). Call after navigating into the app, before interacting with the screen.
 */
export async function waitForSynced(page: Page): Promise<void> {
  await expect(page.getByRole("status", { name: "Sync status: synced" })).toBeVisible({
    timeout: 20_000,
  });
}

/**
 * Full signup flow: fills the form, submits, captures the recovery phrase,
 * acknowledges it, and lands on the dashboard.
 *
 * Returns the 12-word phrase so tests can use it for recovery flows.
 * Argon2 KDF derivation takes 3 to 8 s; caller must use a 60 s test timeout.
 */
export async function signup(
  page: Page,
  opts: { username: string; password: string },
): Promise<SignupResult> {
  await page.goto("/auth/signup");

  await fillSignupForm(page, opts);
  await submitSignup(page);

  const phrase = await capturePhrase(page);
  await acknowledgePhrase(page);
  await verifyPhrase(page, phrase);

  await page.waitForURL(/\/(auth\/login\/?)?/, { timeout: 15_000 });

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
  const signupCtx = await browser.newContext({ baseURL: BASE_URL });
  const signupPage = await signupCtx.newPage();

  await signupPage.goto("/auth/signup");
  await fillSignupForm(signupPage, opts);
  await submitSignup(signupPage);

  const phrase = await capturePhrase(signupPage);
  await acknowledgePhrase(signupPage);
  await verifyPhrase(signupPage, phrase);
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
  // "Recovery phrase words". Each cell: <div><span>{num}</span>{word}</div>.
  // The grid div is the direct child of the fieldset; word cells are its children.
  const fieldset = page.locator("fieldset").filter({
    has: page.locator("legend", { hasText: "Recovery phrase words" }),
  });

  const gridDiv = fieldset.locator("div").first();
  const wordCells = gridDiv.locator("> div");
  await wordCells.first().waitFor({ state: "visible", timeout: 5_000 });
  const count = await wordCells.count();

  const words: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = (await wordCells.nth(i).innerText()).trim();
    // Strip leading number (e.g. "1 word" -> "word")
    words.push(raw.replace(/^\d+\s*/, "").trim());
  }

  return words.join(" ");
}

/**
 * Checks the "I have written down my recovery phrase" checkbox and clicks
 * Continue. Assumes the phrase acknowledgement screen is already visible.
 */
export async function acknowledgePhrase(page: Page): Promise<void> {
  // The checkbox label changed to "I wrote the phrase down, on paper, somewhere safe."
  // Fall back to the old label if the new one is not found (for compatibility).
  const newLabel = page.getByLabel("I wrote the phrase down, on paper, somewhere safe.");
  const oldLabel = page.getByLabel("I have written down my recovery phrase in a safe place.");
  const checkbox = (await newLabel.count()) > 0 ? newLabel : oldLabel;
  await checkbox.check();
  // Button says "I have it. Continue" (new UI) or "Continue" (old UI).
  const newBtn = page.getByRole("button", { name: "I have it. Continue" });
  const oldBtn = page.getByRole("button", { name: "Continue" });
  const btn = (await newBtn.count()) > 0 ? newBtn : oldBtn;
  await btn.click();
}

/**
 * Completes the signup verify step ("Prove it."), which asks for words 3, 7,
 * and 12 of the just-issued phrase. No-op on the pre-redesign UI, where this
 * step does not exist. `phrase` is the space-separated phrase from capturePhrase.
 */
export async function verifyPhrase(page: Page, phrase: string): Promise<void> {
  const heading = page.getByRole("heading", { name: /prove/i });
  if (!(await heading.isVisible().catch(() => false))) return;
  const words = phrase.split(" ");
  for (const wordNumber of [3, 7, 12]) {
    await page.getByLabel(`Word ${wordNumber}`).fill(words[wordNumber - 1]);
  }
  await page.getByRole("button", { name: "Seal the vault" }).click();
}

/**
 * Logs in with an existing account and waits for the URL to change.
 * Argon2 derivation takes 3 to 8 s; caller must use a 60 s test timeout.
 *
 * Use loginAndCapture + restoreSession when you need the dashboard to
 * actually render rather than bouncing to /unlock.
 */
export async function login(
  page: Page,
  opts: { username: string; password: string },
): Promise<void> {
  await page.goto("/auth/login");
  await expect(page.getByLabel("Username")).toBeVisible({ timeout: 15_000 });

  await page.getByLabel("Username").fill(opts.username);
  await page.getByLabel("Master password").fill(opts.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Wait for navigation to complete (may go to "/" or back to "/auth/login")
  await page.waitForURL(/\//, { timeout: 30_000 });
}

/**
 * Signs out via the redesigned flow: Sign out now lives in Settings behind a
 * confirmation dialog. Navigate through the in-app nav link (a client-side
 * transition that preserves the in-memory DEK; a hard goto would wipe it and
 * bounce to /unlock), open the confirm dialog, and confirm.
 */
export async function logout(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL("/app/settings", { timeout: 10_000 });
  await page.getByRole("button", { name: "Sign out" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  await dialog.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/auth/login", { timeout: 10_000 });
}

/**
 * Full account recovery flow: navigate to /auth/recovery, enter credentials
 * + phrase, complete the new-phrase acknowledgement.
 *
 * Returns the new phrase issued after recovery.
 * Use loginAndCapture + restoreSession if the dashboard needs to be
 * reachable after recovery.
 */
export async function recover(
  page: Page,
  opts: { username: string; phrase: string; newPassword: string },
): Promise<{ newPhrase: string }> {
  await page.goto("/auth/recovery");
  await expect(page.getByLabel("Username")).toBeVisible({ timeout: 15_000 });

  await page.getByLabel("Username").fill(opts.username);
  await page.getByLabel("Recovery phrase (12 words)").fill(opts.phrase);
  await page.getByLabel("New master password", { exact: true }).fill(opts.newPassword);
  await page.getByLabel("Confirm new master password").fill(opts.newPassword);
  // Button label changed to "Derive new keys & continue" in new UI
  const newRecoverBtn = page.getByRole("button", { name: /Derive new keys/i });
  const oldRecoverBtn = page.getByRole("button", { name: "Recover account" });
  const recoverBtn = (await newRecoverBtn.count()) > 0 ? newRecoverBtn : oldRecoverBtn;
  await recoverBtn.click();

  // Argon2 × 2 derivations; allow 45 s. The new UI heading is "Recovery worked..."
  const fieldset = page.locator("fieldset").filter({
    has: page.locator("legend", { hasText: "Recovery phrase words" }),
  });
  await fieldset.waitFor({ state: "visible", timeout: 45_000 });

  const newPhrase = await capturePhrase(page);

  // Acknowledge the new phrase (label changed in new UI)
  const newCheckbox = page.getByLabel("I replaced the paper. The old phrase is in the shredder.");
  const oldCheckbox = page.getByLabel(
    "I have written down my new recovery phrase in a safe place.",
  );
  const checkbox = (await newCheckbox.count()) > 0 ? newCheckbox : oldCheckbox;
  await checkbox.check();
  // Button says "Enter the vault" (new UI) or "Continue" (old UI)
  const newBtn = page.getByRole("button", { name: "Enter the vault" });
  const oldBtn = page.getByRole("button", { name: "Continue" });
  const btn = (await newBtn.count()) > 0 ? newBtn : oldBtn;
  await btn.click();

  await page.waitForURL(/\//, { timeout: 15_000 });

  return { newPhrase };
}
