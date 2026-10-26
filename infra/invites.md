# Invite-only signup

Use this guide to restrict registration on an existing [deployment](README.md). Run commands on the host from the directory containing `compose.prod.yaml`. Existing users can still sign in.

The gate is off by default. When enabled, signup requires a valid `invite_token`; missing, expired, or consumed tokens return HTTP 403. Tokens are single-use and stored as hashes; minting prints the plaintext once.

## 1. Enable the gate

Change the existing entry in `/etc/privance/env.d/server.env` to `INVITE_REQUIRED=true`, then recreate the API so it reads the new environment:

```sh
docker compose -f compose.prod.yaml up -d server
docker compose -f compose.prod.yaml logs --tail=20 server
```

Only the exact string `true` enables the gate. Complete this step when the API is healthy and a signup without a token is rejected. Keep any `SIGNUP_ALLOWLIST` restrictions in mind when choosing the verification username.

## 2. Mint a token

```sh
docker compose -f compose.prod.yaml exec server bun dist/mint-invite.js --created-by ops
# Optional expiry:
docker compose -f compose.prod.yaml exec server bun dist/mint-invite.js --created-by ops --expires-in 30d
```

Run one command per intended token. Expect exit 0, a pino metadata line with `tokenId` and `createdBy` (not the plaintext), and a plaintext line of 43 base64url characters without padding. Expiring tokens also log `expiresAt`; supported duration suffixes are `d`, `h`, and `m`.

Record the token ID for verification. If signup fails after claiming the token (for example, a username race or Argon2id failure), the token remains consumed; mint a replacement.

## 3. Hand off the plaintext safely

Use a single-use encrypted channel or an in-person transfer. Avoid shell/session recording, shared terminals, and copying the token into logs or tracked files. Clear terminal scrollback and the clipboard after handoff; clearing the visible screen alone does not erase recorded output. The server cannot recover plaintext from the stored hash.

## 4. Verify claim and replay rejection

Open a database session:

```sh
docker compose -f compose.prod.yaml exec postgres psql -U privance -d privance
```

Query the specific token ID from mint output, not whichever token happens to be newest:

```sql
SELECT token_id, created_by, expires_at, used_at, used_by_user_id
FROM invite_tokens WHERE token_id = '<token-id-from-mint>';
-- Before signup: created_by = 'ops', used_at and used_by_user_id are NULL.
-- expires_at is NULL or in the future.
```

Sign up at the browser-facing HTTPS URL with that token, save and verify the recovery phrase, then confirm:

- The account reaches the Investments overview and can sign out/in.
- The same token row now has `used_at` and the new user's `used_by_user_id`.
- `audit_events` contains `signup_succeeded` for that user.
- A second signup attempt with the consumed token and a different permitted username is rejected.

These outcomes, together with the no-token rejection in step 1, complete verification.
