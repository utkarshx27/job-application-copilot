# Phase 10: optional encrypted cloud sync

## Outcome

Phase 10 adds a controlled, self-hostable sync implementation without changing the local-first default. The extension can create or sign into a sync account, synchronize encrypted profile and application-tracker snapshots, list and revoke devices, export an encrypted backup, lock the local session, disable sync locally, and delete the cloud account.

The server stores authentication metadata, device/session records, revision numbers, and AES-GCM ciphertext. It never receives the user's passphrase or data-encryption key and cannot read the synchronized profile or tracker.

## Trust boundary

```text
passphrase
   |
   +-- PBKDF2-HMAC-SHA256 (600,000 iterations, per-account 16-byte salt)
          |
          +-- authentication secret --> HTTPS --> hashed by server
          |
          +-- AES-256-GCM key --------> browser session only

validated local dataset --> authenticated encryption --> revisioned ciphertext --> server
```

- A fresh random 96-bit IV is generated for every AES-GCM envelope.
- The dataset name and protocol version are authenticated as additional data, so ciphertext cannot be relabeled as another dataset.
- The passphrase is normalized and processed only in the extension. It is never written to `chrome.storage`.
- The data-encryption key and bearer session are held only in `chrome.storage.session` and expire with the 12-hour server session.
- The persistent extension config contains only endpoint, email, device identity, KDF parameters, revision counters, and the last successful sync time.
- Production endpoints must use HTTPS. Plain HTTP is accepted only for localhost development.
- Cloud host access remains an optional Chrome permission requested from the Sync tab when the user opts in.

The browser-compatible PBKDF2 work factor follows the current OWASP PBKDF2-HMAC-SHA256 recommendation. AES-GCM and PBKDF2 use the Web Crypto API contracts, and optional host access follows Chrome's runtime permission model:

- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [W3C Web Cryptography API](https://www.w3.org/TR/WebCryptoAPI/)
- [Chrome optional permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions)
- [Node.js cryptography guidance](https://nodejs.org/api/crypto.html)

## Components

- `packages/sync-core`: runtime schemas, KDF, authenticated encryption, envelope validation, and deterministic dataset conflict merging.
- `apps/sync-server`: Fastify API, JSON-backed atomic persistence, bearer sessions, optimistic revisions, device revocation, encrypted backup, and account deletion.
- `apps/extension/src/sync-client.ts`: permission-aware API client, initial backup/restore behavior, encryption/decryption, conflict retry, and local schema enforcement.
- `apps/extension/src/sync-storage.ts`: persistent non-secret configuration and session-only key/token storage.
- Sync side-panel tab: explicit create/sign-in, manual sync, backup, lock, local disable, device revocation, and account deletion controls.

## Sync and conflict rules

Two datasets are synchronized in this phase:

1. `PROFILE_VAULT`, which already contains profile history, sources, conflicts, and the saved-response library.
2. `APPLICATION_TRACKER`, including immutable job snapshots and application workflow history.

Writes use a server revision and `baseRevision`. A stale write receives the current encrypted record. The extension authenticates and decrypts that record, merges it with the validated local value, stores the merged local value, and retries once against the new revision.

- Profile conflicts choose the most recently updated valid vault and preserve bounded history, sources, and explicit import conflicts.
- Tracker conflicts merge independent applications by ID, choose each record's most recent update, and union immutable job snapshots.
- Signing into an existing account is intentionally a restore operation: the cloud copy replaces this browser's profile and tracker on the first sync. The UI warns users to export any local profile they need first.
- Creating a new account performs the inverse initial operation and uploads the current local profile and tracker.

## API surface

- `GET /health`
- `GET /v1/auth/parameters`
- `POST /v1/auth/register`
- `POST /v1/auth/login`
- `GET /v1/account`
- `GET /v1/devices`
- `DELETE /v1/devices/:deviceId`
- `GET /v1/sync/:dataset`
- `PUT /v1/sync/:dataset`
- `GET /v1/backup`
- `DELETE /v1/account`

## Running locally

```bash
npm run dev --workspace @copilot/sync-server
```

The default endpoint is `http://127.0.0.1:8787`, and the encrypted state file defaults to `.tmp/sync-server/state.json`. Configure production deployments with `SYNC_HOST`, `SYNC_PORT`, `SYNC_DATA_FILE`, and `SYNC_ALLOWED_ORIGINS`, terminate TLS in front of the service, protect the state file, and maintain server-side backups.

## Validation and remaining production work

The controlled Phase 10 gate covers authenticated encryption and tamper rejection, separated derived secrets, schema validation after decryption, registration/login, revision conflicts, multi-device revocation, encrypted backup, deletion, a real MV3 Chromium flow, and proof that backup ciphertext does not expose synthetic profile values.

Before treating the service as an internet-scale production offering, replace the JSON repository with a transactional database, add distributed rate limiting and verified account recovery, use managed secret/KMS infrastructure for server operational secrets, add abuse monitoring and email verification, conduct an independent cryptographic/security review, and exercise disaster recovery. Binary résumé files are still transient in the current application; their source metadata is covered inside the profile vault, but a future persistent résumé library will need a separately chunked encrypted-object protocol.

Phase 11—controlled auto-next—remains disabled and is the next roadmap phase.
