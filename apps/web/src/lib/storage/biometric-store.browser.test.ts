import { deriveBiometricKek, openProtectorKey, sealProtectorKey } from "@privance/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CADENCE_TTL_MS,
  generateProtectorKeypair,
  loadEnrollment,
  purgeEnrollment,
  reArm,
  saveEnrollment,
  unwrapItemsKeyRsa,
  wrapItemsKeyRsa,
} from "./biometric-store";
import {
  BIOMETRIC_DB,
  BIOMETRIC_OBJECT_STORE,
  BIOMETRIC_RECORD_KEY,
  buildEnrollment,
  readRawBiometricIdb,
} from "./biometric-store.test-helpers";

beforeEach(() => purgeEnrollment());
afterEach(() => purgeEnrollment());

describe("save/load round trip", () => {
  it("preserves all fields exactly", async () => {
    const e = await buildEnrollment();
    await saveEnrollment(e);
    const loaded = await loadEnrollment({ now: e.now, userId: e.userId });
    if (!loaded) throw new Error("expected a loaded record");
    expect(loaded.recordUuid).toBe(e.recordUuid);
    expect(loaded.userId).toBe(e.userId);
    expect(loaded.username).toBe(e.username);
    expect(Array.from(loaded.credentialId)).toEqual(Array.from(e.credentialId));
    expect(Array.from(loaded.salt)).toEqual(Array.from(e.salt));
    expect(Array.from(loaded.publicKeyBytes)).toEqual(Array.from(e.publicKeyBytes));
    expect(Array.from(loaded.wrappedItemsKey)).toEqual(Array.from(e.wrappedItemsKey));
    expect(loaded.lastPasswordUnlockAt).toBe(e.now);
    expect(loaded.enrolledAt).toBe(e.now);
    expect(loaded.schemaVersion).toBe(1);
  });

  it("returns null when no record has been saved", async () => {
    const result = await loadEnrollment({ now: Date.now(), userId: "any" });
    expect(result).toBeNull();
  });
});

describe("load past expiry", () => {
  it("destroys the wrapped items key but keeps the enrollment bookkeeping (R9)", async () => {
    const e = await buildEnrollment();
    await saveEnrollment(e);
    const expiredNow = e.now + CADENCE_TTL_MS + 1;
    const result = await loadEnrollment({ now: expiredNow, userId: e.userId });
    expect(result).toBeNull();
    // The at-rest items-key copy is gone; the bookkeeping survives for re-arm.
    const raw = (await readRawBiometricIdb()) as Record<string, unknown>;
    expect(raw.wrappedItemsKey).toBeNull();
    expect(raw.recordUuid).toBe(e.recordUuid);
    expect(Array.from(raw.credentialId as Uint8Array)).toEqual(Array.from(e.credentialId));
  });

  it("reArm after expiry restores a usable enrollment without re-enrollment (R9/F3)", async () => {
    const e = await buildEnrollment();
    await saveEnrollment(e);
    const expiredNow = e.now + CADENCE_TTL_MS + 1;
    await loadEnrollment({ now: expiredNow, userId: e.userId });

    await reArm({ itemsKey: e.itemsKey, userId: e.userId, now: expiredNow });

    const restored = await loadEnrollment({ now: expiredNow, userId: e.userId });
    if (!restored) throw new Error("expected a usable enrollment after re-arm");
    expect(restored.recordUuid).toBe(e.recordUuid);
    expect(restored.wrappedItemsKey).not.toBeNull();
    expect(restored.lastPasswordUnlockAt).toBe(expiredNow);
  });
});

describe("reArm", () => {
  it("replaces the wrapped blob bytes and updates lastPasswordUnlockAt", async () => {
    const e = await buildEnrollment();
    await saveEnrollment(e);
    const originalWrapped = Array.from(e.wrappedItemsKey);
    const laterNow = e.now + 1000;
    await reArm({ itemsKey: e.itemsKey, userId: e.userId, now: laterNow });
    const loaded = await loadEnrollment({ now: laterNow, userId: e.userId });
    if (!loaded) throw new Error("expected a loaded record after reArm");
    // RSA-OAEP is randomised so a fresh wrap produces different ciphertext
    expect(Array.from(loaded.wrappedItemsKey)).not.toEqual(originalWrapped);
    expect(loaded.lastPasswordUnlockAt).toBe(laterNow);
  });

  it("is a no-op when no record exists (no resurrection)", async () => {
    const itemsKey = crypto.getRandomValues(new Uint8Array(32));
    // Should not throw and should not create a record
    await reArm({ itemsKey, userId: "any", now: Date.now() });
    const raw = await readRawBiometricIdb();
    expect(raw).toBeUndefined();
  });

  it("purges instead of wrapping when the record belongs to another user", async () => {
    const e = await buildEnrollment({ userId: "alice-id" });
    await saveEnrollment(e);
    const bobItemsKey = crypto.getRandomValues(new Uint8Array(32));
    await reArm({ itemsKey: bobItemsKey, userId: "bob-id", now: e.now + 1000 });
    // The stale record must not survive holding bob's key under alice's protector
    const raw = await readRawBiometricIdb();
    expect(raw).toBeUndefined();
  });
});

describe("full crypto round trip", () => {
  it("generateProtectorKeypair -> seal -> save -> load -> openProtectorKey -> unwrapItemsKeyRsa recovers the original items key", async () => {
    const { publicKeyBytes, pkcs8 } = await generateProtectorKeypair();
    const recordUuid = crypto.randomUUID();
    const userId = "user-xyz";
    const credentialId = crypto.getRandomValues(new Uint8Array(16));
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const prfOutput = crypto.getRandomValues(new Uint8Array(32));
    const kek = deriveBiometricKek({ prfOutput, salt });
    const sealedPrivateKey = sealProtectorKey({
      pkcs8,
      kek,
      pubKeyBytes: publicKeyBytes,
      recordUuid,
    });
    const originalItemsKey = crypto.getRandomValues(new Uint8Array(32));
    const wrappedItemsKey = await wrapItemsKeyRsa({
      itemsKey: originalItemsKey,
      publicKeyBytes,
      recordUuid,
    });
    const now = Date.now();
    await saveEnrollment({
      recordUuid,
      userId,
      username: "alice",
      credentialId,
      salt,
      publicKeyBytes,
      sealedPrivateKey,
      wrappedItemsKey,
      now,
    });

    const loaded = await loadEnrollment({ now, userId });
    if (!loaded) throw new Error("expected a loaded record for full round-trip");

    // Recover pkcs8 via openProtectorKey
    const recoveredPkcs8 = openProtectorKey({
      sealed: loaded.sealedPrivateKey,
      kek,
      pubKeyBytes: loaded.publicKeyBytes,
      recordUuid: loaded.recordUuid,
    });

    // Unwrap the items key
    const recoveredKey = await unwrapItemsKeyRsa({
      wrappedItemsKey: loaded.wrappedItemsKey,
      pkcs8: recoveredPkcs8,
      expectedRecordUuid: loaded.recordUuid,
    });
    recoveredPkcs8.fill(0);

    expect(Array.from(recoveredKey)).toEqual(Array.from(originalItemsKey));
  });

  it("unwrapItemsKeyRsa throws on recordUuid mismatch", async () => {
    const { publicKeyBytes, pkcs8 } = await generateProtectorKeypair();
    const recordUuid = crypto.randomUUID();
    const itemsKey = crypto.getRandomValues(new Uint8Array(32));
    const wrapped = await wrapItemsKeyRsa({ itemsKey, publicKeyBytes, recordUuid });
    await expect(
      unwrapItemsKeyRsa({
        wrappedItemsKey: wrapped,
        pkcs8,
        expectedRecordUuid: crypto.randomUUID(), // wrong uuid
      }),
    ).rejects.toThrow("recordUuid mismatch");
  });
});

describe("purgeEnrollment", () => {
  it("removes the stored record", async () => {
    const e = await buildEnrollment();
    await saveEnrollment(e);
    await purgeEnrollment();
    const raw = await readRawBiometricIdb();
    expect(raw).toBeUndefined();
  });
});

describe("cross-user guard", () => {
  it("purges and returns null when userId does not match", async () => {
    const e = await buildEnrollment({ userId: "alice-id" });
    await saveEnrollment(e);
    const result = await loadEnrollment({ now: e.now, userId: "bob-id" });
    expect(result).toBeNull();
    // Confirm purge happened
    const raw = await readRawBiometricIdb();
    expect(raw).toBeUndefined();
  });
});

describe("structural tamper guard", () => {
  it("purges and returns null when a required field is missing", async () => {
    const e = await buildEnrollment();
    await saveEnrollment(e);
    // Inject a tampered record directly into IDB (missing sealedPrivateKey)
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(BIOMETRIC_DB, 1);
      req.onsuccess = () => {
        const db = req.result;
        const tampered = {
          recordUuid: e.recordUuid,
          userId: e.userId,
          username: e.username,
          credentialId: e.credentialId,
          salt: e.salt,
          publicKeyBytes: e.publicKeyBytes,
          // sealedPrivateKey intentionally omitted
          wrappedItemsKey: e.wrappedItemsKey,
          lastPasswordUnlockAt: e.now,
          enrolledAt: e.now,
          schemaVersion: 1,
        };
        const tx = db.transaction(BIOMETRIC_OBJECT_STORE, "readwrite");
        const put = tx.objectStore(BIOMETRIC_OBJECT_STORE).put(tampered, BIOMETRIC_RECORD_KEY);
        put.onsuccess = () => {
          db.close();
          resolve();
        };
        put.onerror = () => {
          db.close();
          reject(put.error);
        };
      };
      req.onerror = () => reject(req.error);
    });

    const result = await loadEnrollment({ now: e.now, userId: e.userId });
    expect(result).toBeNull();
    const raw = await readRawBiometricIdb();
    expect(raw).toBeUndefined();
  });
});

describe("at-rest posture", () => {
  it("raw IDB record contains no plaintext items-key bytes and private key appears only as ciphertext", async () => {
    const e = await buildEnrollment();
    await saveEnrollment(e);
    const raw = await readRawBiometricIdb();
    expect(raw).not.toBeUndefined();
    const rec = raw as Record<string, unknown>;
    const sealed = rec.sealedPrivateKey as { ciphertext: Uint8Array; nonce: Uint8Array };
    // Compare byte sequences in one representation: a decimal join, so a
    // verbatim plaintext copy anywhere in the stored binary fields would match.
    const flat = (u8: Uint8Array) => Array.from(u8).join(",");
    const itemsKeyFlat = flat(e.itemsKey);
    const pkcs8Flat = flat(e.pkcs8Bytes);
    const storedFields = [
      rec.credentialId as Uint8Array,
      rec.salt as Uint8Array,
      rec.publicKeyBytes as Uint8Array,
      rec.wrappedItemsKey as Uint8Array,
      sealed.ciphertext,
      sealed.nonce,
    ];
    for (const field of storedFields) {
      expect(flat(field)).not.toContain(itemsKeyFlat);
      expect(flat(field)).not.toContain(pkcs8Flat);
    }

    // The sealedPrivateKey ciphertext field must be present (private key is ciphertext)
    expect(sealed.ciphertext.length).toBeGreaterThan(0);
  });
});

describe("storage fault tolerance", () => {
  it("loadEnrollment returns null instead of throwing when IDB open fails", async () => {
    const spy = vi.spyOn(indexedDB, "open").mockImplementationOnce(() => {
      const fakeReq = {
        result: undefined,
        error: new DOMException("quota exceeded", "QuotaExceededError"),
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null as ((ev: Event) => void) | null,
        readyState: "pending",
        source: null,
        transaction: null,
        addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
          if (_type === "error" && typeof listener === "function") {
            setTimeout(() => (listener as EventListener)(new Event("error")), 0);
          }
        },
        removeEventListener: () => {},
        dispatchEvent: () => false,
      } as unknown as IDBOpenDBRequest;
      // Fire the onerror handler asynchronously so withStore rejects
      setTimeout(() => {
        if (fakeReq.onerror) fakeReq.onerror(new Event("error"));
      }, 0);
      return fakeReq;
    });

    const result = await loadEnrollment({ now: Date.now(), userId: "any" });
    expect(result).toBeNull();
    spy.mockRestore();
  });
});
