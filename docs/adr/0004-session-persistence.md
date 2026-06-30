# ADR-0004: Session persistence and auto-lock

- **Status:** Accepted
- **Date:** 2026-05-31

## Context

Until now the DEK (items key) lived only in JavaScript memory, in a Symbol-keyed slot on `globalThis`, and was never written to any storage. A page refresh tears down that memory, so every refresh forced a full re-authentication: master password entry plus an Argon2id derivation (64 MB, 3 iterations). On the browser and the installed PWA, which is the whole client surface, this turned an accidental reload into a logout. Users frequently run Privance in private browsing on both phones and laptops, so the design has to behave correctly there, and it must work on every browser engine, not just Chromium.

Two user-facing goals: a refresh should not log you out, and closing the app should lock it. These are the same underlying problem (where the DEK lives between page loads), and solving it relaxes a previously frozen invariant ("DEK in memory only; refresh = re-auth"), so it is recorded here rather than treated as an implementation detail.

The platform constrains the solution. On the unload side there is no event that distinguishes a refresh from a close (`pagehide` fires for both), and `sessionStorage` cannot anchor a "locked on close" guarantee because session restore resurrects it (always in Firefox, on "continue where you left off" in Chrome, via macOS Resume in Safari). On the load side, though, the Navigation Timing API does distinguish the two: a same-tab reload reports `type === "reload"`, while a cold app launch (reopening a closed tab or installed app) reports `"navigate"`. What is reliable everywhere: IndexedDB persists across a same-tab reload, a WebCrypto key created non-extractable cannot have its bytes read by any script or by devtools, the navigation type marks reloads, and elapsed wall-clock time is a dependable signal.

Storage lifetime also differs by surface. In private browsing all site storage is wiped when the session ends and sessions are never restored, so closing locks for free. An installed standalone PWA keeps its own durable storage across a close, so the 15-minute window alone would auto-unlock a reopen rather than lock it; the navigation type closes that gap, since a cold launch is a fresh navigation, not a reload.

## Decision

Persist the DEK in wrapped form, bounded by a 15-minute window.

On unlock, generate a non-extractable AES-GCM wrapping key (`crypto.subtle.generateKey` with `extractable: false`), wrap the in-memory items key with it, and store the wrapped bytes, the wrapping-key handle, and a `lastActiveAt` timestamp in IndexedDB. The items key itself stays in the `globalThis` Symbol slot as before.

On a same-tab reload (`navigation.type === "reload"`) within the window, read the non-extractable key and unwrap the items key back into memory: no password, no username, no server round-trip. This is the survive-refresh path. In an installed standalone PWA a boot that is not a reload is a cold launch (the app was closed and reopened), so the entry is purged and the master password is required regardless of the timer; this is the lock-on-close path. A browser tab keeps the timer-only behavior, since its storage is the close boundary (private browsing wipes it, normal browsing bounds it to the window).

A single 15-minute timer governs both idle-while-open and time-since-last-seen. On any load, if `now - lastActiveAt` exceeds 15 minutes, purge the IndexedDB entry and require the master password. Explicit "Lock now", window expiry, and logout all purge the entry. Logout additionally clears the in-memory key, destroys the local encrypted database, and revokes the server session. The 15-minute default and the lock-versus-logout split follow established credential-manager practice.

Store the username (non-secret) in `localStorage` so the unlock screen is pre-filled after a full lock.

Use only universally supported primitives (IndexedDB, non-extractable WebCrypto keys, the navigation type, and timers), so the behavior is identical on every browser engine and in the installed PWA. Private browsing needs no special code: the browser wipes storage on close (instant lock) and survive-refresh degrades to same-tab-reload only.

Biometric unlock (WebAuthn PRF) is out of scope here and is decided in ADR-0005; this phase ships master-password unlock only.

## Consequences

- A refresh no longer logs you out, on any browser or the PWA. Closing the installed PWA locks immediately on reopen (a cold launch is not a reload); a browser tab locks instantly in private browsing and within 15 minutes in normal browsing.
- The frozen "DEK in memory only" invariant is relaxed: in normal browsing a wrapped DEK lives in durable IndexedDB for up to 15 minutes after close. The wrapping key is non-extractable, so its bytes cannot be exported by script or devtools, and the entry auto-purges on expiry, explicit lock, and logout. This is a deliberate, bounded reduction in posture, recorded in `THREAT_MODEL.md`.
- Non-extractability is a JavaScript-boundary guarantee, not hardware backing. It is not encryption-at-rest against an attacker with OS-level disk access to the IndexedDB store during the live window. Accepted for a 15-minute bound.
- XSS during an active session can still use the key as an encrypt/decrypt oracle, exactly as it could read the in-memory DEK today. Persistence adds no new raw-byte exfiltration path, because the wrapping key cannot be exported.
- In normal browsing, same-origin tabs share the persisted wrapped DEK, so a second tab opened within the window is also unlocked. Safari private browsing isolates each tab, so each unlocks independently. Explicit lock and logout broadcast across open tabs through a `localStorage` event, so locking or signing out in one tab scrubs the in-memory DEK in the others; idle auto-lock stays per-tab so an actively used tab is not locked because a background one went idle.
- Storing the username in `localStorage` leaves an account identifier on the device in normal browsing. Accepted for unlock-screen convenience; private browsing wipes it on close.
- Reversal: delete the IndexedDB persistence and the timestamp check, and the client returns to memory-only, re-auth-on-refresh behavior with no data migration.

## Alternatives considered

**SharedWorker holding the key in memory.** Keeps the key out of storage entirely, survives a refresh because the worker outlives page navigation, and dies when all tabs close. Rejected because SharedWorker support is absent or unreliable in Safari on iOS, which fails the requirement to work on every browser and device.

**Raw DEK in `sessionStorage`.** Simplest possible survive-refresh. Rejected: raw key bytes in a script-readable store are a one-line XSS exfiltration, and `sessionStorage` is not a dependable close boundary because session restore resurrects it.

**`sessionStorage` sentinel to detect close versus refresh.** Rejected for the same session-restore reason: a value that survives a quit-and-restore cannot signal that the tab was closed, so it cannot guarantee lock-on-close.

**Biometric (WebAuthn PRF) unlock now.** Deferred. PRF support is uneven across OS, browser, and version, and its behavior inside an installed iOS PWA is unverified against primary sources. It must always fall back to password unlock, so it is an enhancement layered on this phase, not part of it.
