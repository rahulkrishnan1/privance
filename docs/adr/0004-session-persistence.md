# ADR-0004: Session persistence and auto-lock

- **Status:** Accepted
- **Date:** 2026-05-31
- **Clarification:** The TTL limits application restoration, not physical storage lifetime. [ADR-0005](0005-biometric-unlock.md) later adds an optional biometric unlock path.

## Context

Before this decision, the DEK (items key) lived only in JavaScript memory, in a Symbol-keyed slot on `globalThis`, and was never written to any storage. A page refresh tears down that memory, so every refresh forced a full re-authentication: master password entry plus an Argon2id derivation (64 MB, 3 iterations). On the browser and the installed PWA, which is the whole client surface, this turned an accidental reload into a logout. Users frequently run Privance in private browsing on both phones and laptops, so the design has to behave correctly there, and it must work on every browser engine, not just Chromium.

Two user-facing goals: a refresh should not log you out, and closing the app should lock it. These are the same underlying problem (where the DEK lives between page loads), and solving it relaxes a previously frozen invariant ("DEK in memory only; refresh = re-auth"), so it is recorded here rather than treated as an implementation detail.

The platform constrains the solution. On the unload side there is no event that distinguishes a refresh from a close (`pagehide` fires for both), and `sessionStorage` cannot anchor a "locked on close" guarantee because session restore resurrects it (always in Firefox, on "continue where you left off" in Chrome, via macOS Resume in Safari). On the load side, though, the Navigation Timing API does distinguish the two: a same-tab reload reports `type === "reload"`, while a cold app launch (reopening a closed tab or installed app) reports `"navigate"`. IndexedDB can persist across a same-tab reload, and WebCrypto non-extractability prevents exporting the wrapping key through the API. Navigation type and elapsed time guide restoration; a backwards clock change is treated as stale. Storage failures must fall back to password unlock.

Storage lifetime also differs by surface. Private-session storage can be cleared earlier than ordinary browsing storage, but its lifetime is browser-controlled rather than a dependable per-tab close signal. An installed standalone PWA keeps its own durable storage across a close, so the 15-minute window alone would auto-unlock a reopen rather than lock it; the navigation type closes that gap, since a cold launch is a fresh navigation, not a reload.

## Decision

Persist the DEK in wrapped form and allow application restoration within a 15-minute activity window.

On unlock, generate a non-extractable AES-GCM wrapping key (`crypto.subtle.generateKey` with `extractable: false`), wrap the in-memory items key with it, and store the wrapped bytes, the wrapping-key handle, and a `lastActiveAt` timestamp in IndexedDB. The items key itself stays in the `globalThis` Symbol slot as before.

On a same-tab reload (`navigation.type === "reload"`) within the window, read the non-extractable key and unwrap the items key back into memory: no password, no username, no server round-trip. This is the survive-refresh path. In an installed standalone PWA a non-reload boot is treated as a cold launch, so the app attempts to purge the session entry and requires unlock rather than restoring it automatically. A browser tab uses the activity-window check regardless of navigation type; browser storage clearing can end restoration earlier.

A single 15-minute window governs idle-while-open and time-since-last-seen. On load, reject an entry older than the window (or with a future timestamp), attempt to purge it, and require unlock. The running app's idle timer, explicit "Lock now", and logout also attempt to purge the entry. No timer runs after the app closes; expired bytes can remain in IndexedDB until the next check, and deletion is best-effort if storage fails. Logout additionally clears the in-memory key, destroys the local encrypted database, and revokes the server session. The 15-minute default and the lock-versus-logout split follow established credential-manager practice.

Store the username (non-secret) in `localStorage` so the unlock screen is pre-filled after a full lock.

Use platform primitives rather than an engine-specific key store. In private browsing, storage lasts only as long as the browser's private session; closing one tab is not a universal guarantee that the session ended. When storage is unavailable or cleared, restoration fails closed to the password path.

This decision originally shipped password-only unlock. [ADR-0005](0005-biometric-unlock.md) adds biometric unlock without changing the session vault's restore window.

## Consequences

- A refresh can restore without password entry when storage is available and the activity window is fresh. Installed-PWA cold launches skip session restoration; ordinary tabs use the timer-only policy. Ending a private session clears storage according to the browser's lifecycle.
- The previous memory-only invariant is relaxed: a wrapped DEK and its non-extractable wrapping key can persist on disk. The 15-minute timestamp is an application check, not cryptographic expiry or a disk-erasure deadline. See [the DEK threat analysis](../../THREAT_MODEL.md#32-dek-items-key).
- Non-extractability is a WebCrypto API restriction, not hardware backing. It does not prevent same-origin code from using the stored key as a decrypt oracle, nor protect against OS-level access to browser storage. These risks can outlast the application restore window if the entry has not been deleted.
- XSS can use the stored wrapping key to recover the DEK even though the wrapping key itself cannot be exported. The mutable timestamp is not a security boundary against malicious same-origin code; persistence extends exposure beyond the lifetime of the original page.
- In normal browsing, same-origin tabs share the persisted wrapped DEK, so a second tab opened within the window is also unlocked. Where private browsing isolates tab storage, each tab unlocks independently. Explicit lock and logout broadcast across open tabs through a `localStorage` event, so locking or signing out in one tab scrubs the in-memory DEK in the others; idle auto-lock stays per-tab so an actively used tab is not locked because a background one went idle.
- Storing the username in `localStorage` leaves an account identifier on the device in normal browsing. Accepted for unlock-screen convenience; private browsing wipes it on close.
- Reversal: delete the IndexedDB persistence and the timestamp check, and the client returns to memory-only, re-auth-on-refresh behavior with no data migration.

## Alternatives considered

**SharedWorker holding the key in memory.** Keeps the key out of storage entirely, survives a refresh because the worker outlives page navigation, and dies when all tabs close. Rejected because SharedWorker support is absent or unreliable in Safari on iOS, which fails the requirement to work on every browser and device.

**Raw DEK in `sessionStorage`.** Simplest possible survive-refresh. Rejected: raw key bytes in a script-readable store are a one-line XSS exfiltration, and `sessionStorage` is not a dependable close boundary because session restore resurrects it.

**`sessionStorage` sentinel to detect close versus refresh.** Rejected for the same session-restore reason: a value that survives a quit-and-restore cannot signal that the tab was closed, so it cannot guarantee lock-on-close.

**Biometric (WebAuthn PRF) unlock now.** Deferred. PRF support is uneven across OS, browser, and version, and its behavior inside an installed iOS PWA is unverified against primary sources. It must always fall back to password unlock, so it is an enhancement layered on this phase, not part of it.
