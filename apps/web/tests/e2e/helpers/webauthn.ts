import type { Page } from "@playwright/test";

/**
 * Installs a virtual PRF-capable platform authenticator via Chrome DevTools Protocol.
 *
 * Chromium only: throws a clear error on other browsers. Gate callers with
 * `test.skip(browserName !== "chromium", "chromium-only")`.
 *
 * The authenticator is configured with:
 *  - protocol: ctap2 (required for PRF extension)
 *  - transport: internal (platform authenticator)
 *  - hasResidentKey, hasUserVerification, isUserVerified, hasPrf: true
 *  - automaticPresenceSimulation: true (auto-approves gestures)
 *
 * Returns the authenticatorId so callers can remove or reconfigure it.
 */
export async function installVirtualAuthenticator(page: Page): Promise<string> {
  const browserName = page.context().browser()?.browserType().name();
  if (browserName !== "chromium") {
    throw new Error(
      `installVirtualAuthenticator: chromium-only helper (got "${browserName}"). Gate the caller with test.skip(browserName !== "chromium", "chromium-only").`,
    );
  }

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      hasPrf: true,
      automaticPresenceSimulation: true,
    },
  });
  return authenticatorId;
}

/**
 * Removes a virtual authenticator installed by `installVirtualAuthenticator`.
 * Best-effort: swallows errors so cleanup never fails a test.
 */
export async function removeVirtualAuthenticator(
  page: Page,
  authenticatorId: string,
): Promise<void> {
  try {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
  } catch {
    // best-effort; CDP session may already be closed on page teardown
  }
}

/**
 * Flips UV success on an existing virtual authenticator to simulate biometric
 * rejection by the OS. The authenticator and its enrolled credentials stay in
 * place, so the next assertion exercises genuine UV denial rather than a
 * credential-not-found failure.
 */
export async function setUserVerified(
  page: Page,
  authenticatorId: string,
  isUserVerified: boolean,
): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.setUserVerified", { authenticatorId, isUserVerified });
}

/**
 * Reads the biometric enrollment record from IndexedDB.
 * Returns the raw record object (fields present) or null if absent.
 */
export async function readIdbEnrollment(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate(
    () =>
      new Promise<Record<string, unknown> | null>((resolve, reject) => {
        const open = indexedDB.open("privance.biometric", 1);
        open.onupgradeneeded = () => {
          // Store doesn't exist yet: a valid "absent" state.
          open.result.close();
          resolve(null);
        };
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("enrollment")) {
            db.close();
            resolve(null);
            return;
          }
          const tx = db.transaction("enrollment", "readonly");
          const req = tx.objectStore("enrollment").get("current");
          req.onsuccess = () => {
            db.close();
            resolve(req.result ?? null);
          };
          req.onerror = () => {
            db.close();
            reject(req.error);
          };
        };
        open.onerror = () => reject(open.error);
      }),
  );
}

/**
 * Backdates `lastPasswordUnlockAt` in the biometric IDB record by `ageMs`
 * milliseconds (e.g. 15 * 24 * 60 * 60 * 1000 for 15 days ago).
 */
export async function backdateBiometricRecord(page: Page, ageMs: number): Promise<void> {
  await page.evaluate(
    (age) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("privance.biometric", 1);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("enrollment", "readwrite");
          const store = tx.objectStore("enrollment");
          const get = store.get("current");
          get.onsuccess = () => {
            const record = get.result;
            if (!record) {
              db.close();
              resolve();
              return;
            }
            record.lastPasswordUnlockAt = Date.now() - age;
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
