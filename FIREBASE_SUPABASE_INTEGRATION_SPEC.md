# DawaSnap AI: Firebase & Supabase Integration Specification

> **Classification**: Internal System Architecture & Data Contract  
> **Source Grounding**: Derived directly from codebase files (`server/supabaseBackup.ts`, `server/twoWaySync.ts`, `server/expiryCron.ts`, `server.ts`, `firestore.rules`, `src/types.ts`, `src/services/supabaseSyncService.ts`, `src/services/nativeNotificationService.ts`, `src/services/localImageStorage.ts`).  
> **Last Updated**: 2026-10-13

---

## 1. System Role & Architecture

```text
 ┌──────────────────────────────────────────────────────────────┐
 │                    CLIENT APPLICATIONS                       │
 │        (React Web SPA / PWA & Capacitor Android APK)        │
 └──────────────┬───────────────────────────────▲───────────────┘
                │ Real-Time (onSnapshot)         │
                │ Direct mutations (auth.uid)   │
                ▼                               │
 ┌───────────────────────────────┐              │
 │      FIREBASE FIRESTORE       │              │
 │     (Live Primary Store)      │              │
 └──────────────┬────────────────┘              │
                │                               │
                │ Two-Way Sync Engine           │
                │ (server/twoWaySync.ts)        │
                ▼                               │
 ┌───────────────────────────────┐              │
 │     SUPABASE POSTGRESQL       │──────────────┘
 │    (Relational SQL Mirror)    │ (Pulls back via /api/backup/pull-from-supabase)
 └───────────────────────────────┘
```

1. **Firebase Firestore (Primary Live Store & Auth)**:
   - Evaluated by `firestore.rules`.
   - Client applications (`src/App.tsx`) connect directly via Firebase Web SDK and attach real-time listeners (`onSnapshot`).
   - Authentication is managed via Firebase Authentication (`src/firebase.ts`).
   - Multi-tenant isolation is enforced at the rule level: `resource.data.userId == request.auth.uid`.

2. **Supabase PostgreSQL (Relational SQL Mirror & Backup)**:
   - Hosted PostgreSQL database accessed server-side via `@supabase/supabase-js` using `SUPABASE_SERVICE_ROLE_KEY` (`server/supabaseBackup.ts:getSupabaseClient`).
   - Acts as an analytical mirror, relational query target, and off-site backup.
   - Zero anon or authenticated access: Row Level Security is active with NO policies (`REVOKE ALL ON ALL TABLES FROM anon, authenticated`).

3. **Data Flow**:
   - **Firestore → Supabase**: Triggered by client debounced calls (`src/services/supabaseSyncService.ts:triggerDebouncedMedicinesSync`), manual sync in settings modal (`src/components/SettingsModal.tsx:handleManualSupabaseSync`), and server-side cron (`server/twoWaySync.ts:pushFirestoreToSupabase`). Scoped to caller's `req.userId` in user requests.
   - **Supabase → Firestore**: Triggered by `/api/backup/pull-from-supabase` or `/api/backup/two-way-sync` (`server/twoWaySync.ts:pullSupabaseToFirebase`), strictly scoped to `req.userId`. Missing documents are never created in standard sync; they can only be recreated via the administrative disaster recovery restore endpoint `/api/backup/restore-from-supabase`.

---

## 2. Table & Collection Mappings

| Firebase Firestore Path | Supabase PostgreSQL Table | Primary Key in Supabase | Code Mapping Function |
| :--- | :--- | :--- | :--- |
| `medicines/{medicineId}` | `public.medicines` | `(user_id, id)` | `server/supabaseBackup.ts:formatMedicineForPostgres` |
| `medicines/{medicineId}/history/{historyId}` | `public.medicine_history` | `id` | `server/supabaseBackup.ts:backupMedicineHistoryToSupabase` |
| `users/{userId}/settings/appSettings` | `public.user_configs` | `user_id` | `server/supabaseBackup.ts:backupUserConfigToSupabase` |
| Firebase Auth User Profiles | `public.users` | `uid` | `server/supabaseBackup.ts:backupUsersBatchToSupabase` |
| `users/{userId}/pushTokens/{tokenId}` | `public.user_push_tokens` | `(user_id, id)` | `server.ts` (`POST /api/notifications/register-token`) |
| Persistent Sync Watermarks | `public.sync_state` | `key` | `server/supabaseBackup.ts:getPersistentSyncState`, `setPersistentSyncState` |

---

## 3. Endpoints & Authentication Matrix

| Endpoint | HTTP Method | Authentication Method | Caller Scope | Database Touchpoints | Implementation Reference |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `/api/backup/supabase/status` | `GET` | Firebase Bearer Token OR `x-cron-secret` Header | Authenticated User or Internal Scheduler | Queries Supabase `medicines` limit 1 with service role | `server.ts` |
| `/api/backup/supabase/sync-medicines` | `POST` | Firebase Bearer Token (`requireFirebaseAuth`) | Authenticated User (Strictly scoped to `req.userId`) | Upserts batch into Supabase `medicines` on conflict `(user_id, id)` | `server.ts`, `server/supabaseBackup.ts:backupMedicinesBatchToSupabase` |
| `/api/backup/supabase/sync-medicine` | `POST` | Firebase Bearer Token (`requireFirebaseAuth`) | Authenticated User (Forces `medicine.userId = req.userId`) | Upserts row into Supabase `medicines` on conflict `(user_id, id)` | `server.ts`, `server/supabaseBackup.ts:backupMedicineToSupabase` |
| `/api/backup/supabase/delete-medicine` | `POST` | Firebase Bearer Token (`requireFirebaseAuth`) | Authenticated User (Scoped to `user_id == req.userId`) | Updates Supabase `medicines` with `is_deleted = true` tombstone | `server.ts`, `server/supabaseBackup.ts:deleteMedicineFromSupabase` |
| `/api/backup/supabase/delete-medicines-batch` | `POST` | Firebase Bearer Token (`requireFirebaseAuth`) | Authenticated User (Scoped to `user_id == req.userId`) | Updates Supabase `medicines` with `is_deleted = true` tombstones | `server.ts`, `server/supabaseBackup.ts:deleteMedicinesBatchFromSupabase` |
| `/api/backup/supabase/sync-config` | `POST` | Firebase Bearer Token (`requireFirebaseAuth`) | Authenticated User (Forces `config.userId = req.userId`) | Upserts row into Supabase `user_configs` on conflict `user_id` | `server.ts`, `server/supabaseBackup.ts:backupUserConfigToSupabase` |
| `/api/backup/supabase/sync-history` | `POST` | Firebase Bearer Token (`requireFirebaseAuth`) | Authenticated User (Forces `history.userId = req.userId`) | Upserts row into Supabase `medicine_history` on conflict `id` | `server.ts`, `server/supabaseBackup.ts:backupMedicineHistoryToSupabase` |
| `/api/backup/two-way-sync` | `POST` | Firebase Bearer Token (`requireFirebaseAuth`) | Authenticated User (Strictly scoped to `user_id == req.userId`) | Pushes caller's Firestore records to Supabase | `server.ts`, `server/twoWaySync.ts:runTwoWaySync` |
| `/api/backup/pull-from-supabase` | `POST` | Firebase Bearer Token (`requireFirebaseAuth`) | Authenticated User (Strictly scoped to `user_id == req.userId`) | Pulls caller's newer Supabase rows to existing Firestore docs | `server.ts`, `server/twoWaySync.ts:pullSupabaseToFirebase` |
| `/api/backup/restore-from-supabase` | `POST` | `x-cron-secret` Header only | Administrator Disaster Recovery | Restores all Supabase rows to Firestore, creating missing documents | `server.ts`, `server/twoWaySync.ts:restoreMissingFromSupabase` |
| `/api/notifications/register-token` | `POST` | Firebase Bearer Token (`requireFirebaseAuth`) | Authenticated User | Writes document to Firestore `users/{userId}/pushTokens/{tokenId}` | `server.ts` |
| `/api/cron/sync` | `POST` | `x-cron-secret` Header only (`crypto.timingSafeEqual`) | Internal Scheduler / Cron | Executes global push `runTwoWaySync()` across all accounts | `server.ts:verifyCronAuth` |
| `/api/cron/check-expiry` | `POST` | `x-cron-secret` Header only (`crypto.timingSafeEqual`) | Internal Scheduler / Cron | Executes `runBackgroundExpiryCheck()` | `server.ts:verifyCronAuth`, `server/expiryCron.ts` |

---

## 4. Upsert & Conflict Resolution Mechanics

### Real Primary Keys & On-Conflict Targets
1. **`public.medicines`**:
   - **Primary Key**: `(user_id, id)`.
   - **Unique Index**: `CREATE UNIQUE INDEX idx_medicines_user_id_id ON public.medicines (user_id, id);`.
   - **Conflict Target in Code**: Strictly `{ onConflict: 'user_id,id' }` (`server/supabaseBackup.ts:executeMedicineUpsert`).
   - **Fallback Mechanism**: Scoped strictly by composite key `(user_id, id)`. If conflict occurs, verifies existing row with `.eq('user_id', row.user_id).eq('id', row.id)` and executes `.update()` or `.insert()`. All legacy fallbacks targeting `id` alone have been completely removed.
2. **`public.users`**:
   - **Primary Key**: `uid` (`TEXT`).
   - **Conflict Target**: `{ onConflict: 'user_id' }` (mapped to `uid`).
3. **`public.user_configs`**:
   - **Primary Key**: `user_id` (`TEXT`).
   - **Conflict Target**: `{ onConflict: 'user_id' }`.
4. **`public.medicine_history`**:
   - **Primary Key**: `id` (`TEXT`).
   - **Conflict Target**: `{ onConflict: 'id' }`.
5. **`public.sync_state`**:
   - **Primary Key**: `key` (`TEXT`).
   - **Conflict Target**: `{ onConflict: 'key' }`.

### Meaning of `updated_at` & Explanation of the 9-Second Window
- **Source of `updated_at`**: In Supabase `medicines`, the column `updated_at` is derived directly from the Firestore source document `updatedAt` (or `createdAt` if `updatedAt` is absent), converted from milliseconds into an ISO-8601 string (`server/supabaseBackup.ts:formatMedicineForPostgres`).
- **Why rows share a 9-second window**: When client batches or initial sync operations run (e.g. `backupMedicinesBatchToSupabase`, client-side migrations, or initial imports), multiple medicine documents in Firestore were created or saved within a single multi-document execution transaction that took approximately 9 seconds to commit. Additionally, whenever legacy records lacked both `updatedAt` and `createdAt`, the system stamped them with the current execution time.
- **Sync-Time Fallback Logging**: `formatMedicineForPostgres` includes an explicit warning whenever source timestamps are missing:
  ```text
  [SUPABASE BACKUP] Medicine <id> missing source updatedAt/createdAt; stamped with sync time instead of source edit time.
  ```
- **Conflict Resolution Rule during Pull**: A Supabase row is applied to Firestore **only if** `supabase.updated_at > firestore.updatedAt`. If the Supabase edit time is equal to or older than the Firestore document, the row is discarded.

---

## 5. Complete Field-by-Field Medicine Mapping

| Firestore Field | Type in Firestore | Supabase Column in `public.medicines` | Included in `raw_payload` | Restored by `pullSupabaseToFirebase`? |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `string` | `id` | Yes | **Yes** |
| `userId` | `string` | `user_id` | Yes | **Yes** |
| `name` | `string` | `name` | Yes | **Yes** |
| `dosage` | `string` | `dosage` | Yes | **Yes** (skipped if `'N/A'` or empty) |
| `expirationDate` | `string` | `expiration_date` | Yes | **Yes** (restored as part of the batch triad) |
| `quantity` | `number` | `quantity` | Yes | **Yes** (restored as part of the batch triad) |
| `totalQuantity` | `number` | `total_quantity` | Yes | **Yes** (restored as part of the batch triad) |
| `form` | `string` (enum) | `form` | Yes | **Yes** (skipped if missing; no default placeholder) |
| `category` | `string` | `category` | Yes | **Yes** (skipped if `'Other'` or missing) |
| `categories` | `array` (`string[]`) | `categories` | Yes | **Yes** (restored if non-empty array) |
| `tags` | `array` (`string[]`) | `tags` | Yes | **Yes** (restored if non-empty array) |
| `usageInstructions`| `string` | `usage_instructions` | Yes | **Yes** (skipped if missing; no empty string placeholder) |
| `price` | `number` \| `string` | `price` | Yes | **Yes** (restored if numeric) |
| `barcode` | `string` | `barcode` | Yes | **Yes** (skipped if missing) |
| `mfgDate` | `string` | `mfg_date` | Yes | **Yes** (skipped if missing) |
| `manufacturer` | `string` | `manufacturer` | Yes | **Yes** (skipped if missing) |
| `taken` | `boolean` | `taken` | Yes | **Yes** (restored if boolean) |
| `liked` | `boolean` | `liked` | Yes | **Yes** (restored if boolean) |
| `isDeleted` | `boolean` | `is_deleted` | Yes | **Yes** (tombstone marked; never un-deleted) |
| `deletedAt` | `number` | `deleted_at` | Yes | **Yes** (restored if tombstoned) |
| `createdAt` | `number` \| `timestamp` | `created_at` | Yes | **No** (preserved in Firestore; set only on disaster recovery) |
| `updatedAt` | `number` \| `timestamp` | `updated_at` | Yes | **Yes** (mapped from `row.updated_at`) |
| `schedule` | `string` | None | Yes | **No** (field not stored in dedicated column) |
| `notes` | `string` | None | Yes | **No** (field not stored in dedicated column) |
| `batches` | `array` | `batches` (`jsonb`/`text`) | Yes | **Yes** (restored strictly together with `quantity` and `expirationDate`) |
| `allBatches` | `array` | None | Yes | **No** |
| `activeBatches` | `array` | None | Yes | **No** |
| `expiredOrEmptyBatches` | `array` | None | Yes | **No** |
| `batchId` | `string` | None | Yes | **No** |
| `batchCount` | `number` | None | Yes | **No** |
| `groupKey` | `string` | None | Yes | **No** |
| `earliestExpiry` | `string` | None | Yes | **No** |
| `dosageUnit` | `string` | None | Yes | **No** |
| `sideEffects` | `string` | None | Yes | **No** |
| `email` | `string` | None | Yes | **No** |
| `enableLowStockAlert` | `boolean` | None | Yes | **No** |
| `lowStockThreshold` | `number` | None | Yes | **No** |
| `enableEmailExpiryAlert` | `boolean` | None | Yes | **No** |
| `enableEmailLowStockAlert` | `boolean` | None | Yes | **No** |
| `isEncrypted` | None | None | None | **REMOVED** (Dead field removed from rules and types) |
| `ivMap` | None | None | None | **REMOVED** (Dead field removed from rules and types) |
| `imageUrl` | `string` | None | Yes (`'local'`) | **No** |
| `capturedImage` | `string` (base64) | None | **Stripped** | **No** (never saved to cloud) |
| `capturedImageBack` | `string` (base64) | None | **Stripped** | **No** (never saved to cloud) |
| `imageData` | `string` (base64) | None | **Stripped** | **No** (never saved to cloud) |

---

## 6. Data Contract & Pull Safety Invariants

When rows from Supabase `public.medicines` are ingested by `server/twoWaySync.ts:pullSupabaseToFirebase`, the engine enforces seven strict safety invariants:

1. **User Identity Batched Verification**:
   - `pullSupabaseToFirebase` performs a deduplicated, chunked lookup of user IDs via `auth.getUsers()` (up to 100 UIDs per batch).
   - Zero sequential per-row `auth.getUser` calls. If a UID does not exist in Firebase Auth, its rows are rejected immediately.
2. **Pre-Existing Document Constraint (Pull Safety)**:
   - In normal pull operations (`allowCreateMissing = false`), the engine checks `docSnap.exists`.
   - If the Firestore document does **not already exist**, the row is **SKIPPED**. Normal pull never creates new documents in Firestore.
   - To recreate missing documents following catastrophic loss, the administrator must invoke `POST /api/backup/restore-from-supabase` with `CRON_SECRET`.
3. **Strict Timestamp Progression**:
   - A row is applied **only if** `supabase.updated_at > firestore.updatedAt`.
   - If the incoming edit time is older or equal, it is ignored.
4. **Zero Fallback Defaults (No Placeholders)**:
   - Missing fields are omitted entirely from the update payload.
   - The engine **never** supplies default placeholders like `'tablet'`, `''`, or synthesized category strings. If a column is absent or null, the existing Firestore value is left untouched.
5. **Atomic Batches Triad (Restored Together or Neither)**:
   - If `row.batches` is present, it is restored **strictly together with** `row.quantity` and `row.expiration_date`.
   - If either `quantity` or `expiration_date` is missing or invalid, `batches` is skipped entirely. This guarantees multi-batch inventories never decouple from total count and earliest expiry.
6. **Tombstone Preservation & Anti-Resurrection**:
   - If an existing Firestore document is marked `isDeleted: true`, an incoming Supabase row with `is_deleted = false` is rejected.
   - Soft-deleted documents can never be resurrected by database sync.
7. **Strict Multi-Tenant Scoping**:
   - When called via client endpoints (`/api/backup/pull-from-supabase` or `/api/backup/two-way-sync`), `targetUserId` is mandatory (`req.userId`).
   - Queries to Supabase and Firestore filter strictly on `user_id == req.userId`. Global sync across all users is restricted to authenticated cron execution.

---

## 7. History & User Settings Sync Details

### History Mapping
- In Firestore: subcollection documents at `medicines/{medicineId}/history/{historyId}`.
- In Supabase: table `public.medicine_history`.
- **Field Conversion**: Firestore `actionType` is mapped to Supabase column `action` (`server/supabaseBackup.ts:backupMedicineHistoryBatchToSupabase`). Allowed actions in `firestore.rules`: `'CREATE'`, `'EDIT'`, `'MARK_TAKEN'`, `'MARK_NOT_TAKEN'`, `'DELETE'`.
- **Sync Direction**: **ONE-WAY ONLY (Firestore → Supabase)**. Pulling history from Supabase into Firestore is **NOT IMPLEMENTED**.

### User Config (`public.user_configs`)
- Handled by `server/supabaseBackup.ts:backupUserConfigToSupabase`.
- `alertThreshold`: Allowed values enforced by `firestore.rules:isValidUserConfig` are **any number between `0` and `365`** (`data.alertThreshold >= 0 && data.alertThreshold <= 365`). The UI offers preset buttons for 30, 60, and 90 days, but the database contract accepts any integer in the range `[0, 365]`.

---

## 8. Deletion Semantics & Tombstones

1. **Soft Delete**:
   - Client soft delete sets `isDeleted: true` and `deletedAt: Date.now()` in Firestore (`src/App.tsx:handleDeleteMultiple`).
   - In Supabase, this translates to `is_deleted = true`, `deleted_at = NOW()`, and `updated_at = NOW()`.
2. **Permanent Delete & Tombstones**:
   - Direct deletions (`deleteMedicineFromSupabase`, `deleteMedicinesBatchFromSupabase`) update Supabase rows with `is_deleted = true`, `deleted_at = NOW()`, and `updated_at = NOW()`.
   - Retaining tombstones prevents hard-deleted rows from being resurrected during sync.
3. **Resurrection Prevention**:
   - `pullSupabaseToFirebase` checks `firestoreData.isDeleted`. If `isDeleted == true` in Firestore, incoming updates without deletion markers are skipped.
   - When `allowCreateMissing` is false, missing Firestore documents are not created from Supabase.

---

## 9. Encryption Status: Dead Fields Removed

- The fields `isEncrypted` and `ivMap` were legacy placeholders that had no active client or server decryption logic.
- **Action Taken**: Formally removed from `firestore.rules` and `src/types.ts:Medicine`.
- All data at rest is encrypted natively by Google Cloud Firestore (AES-256) and Supabase PostgreSQL (AES-256), and in transit via TLS 1.3.

---

## 10. Medicine ID Generation

- Medicine IDs in Firestore: Generated using standard `crypto.randomUUID()` (`src/App.tsx:1062`). Format is a standard 36-character UUID v4.
- History IDs in Firestore: Generated using `crypto.randomUUID()` (`src/App.tsx:1052`).
- Validation Rule: Must satisfy `firestore.rules:isValidMedicine` (`data.id is string && data.id.size() > 0 && data.id.size() < 100`).

---

## 11. Push Tokens, FCM & Dead Token Cleanup

1. **Push Token Storage**:
   - Stored in Firestore at `users/{userId}/pushTokens/{tokenId}`.
   - Registered via `POST /api/notifications/register-token` or client `src/services/nativeNotificationService.ts`.
2. **FCM Dispatch Flow**:
   - Handled in `server/expiryCron.ts:runBackgroundExpiryCheck`.
   - Dispatches expiry notifications using `firebase-admin/messaging:getMessaging().sendEachForMulticast()`.
3. **Dead Token Cleanup**:
   - `server/expiryCron.ts` inspects each response in `multicastResponse.responses`.
   - Any token returning error code `messaging/registration-token-not-registered` or `messaging/invalid-registration-token` is immediately pruned in a batch delete from Firestore `users/{userId}/pushTokens`.
4. **Firebase Storage**:
   - **UNUSED**. Photos never leave the client device; they are stored exclusively in on-device IndexedDB via `src/services/localImageStorage.ts`.

---

## 12. Account Deletion Flow Across All Stores

When a user initiates account deletion (`POST /api/user/purge-data`), the system coordinates cleanup across all three persistence layers:

1. **Firestore Permanent Deletion**:
   - Deletes all user documents in collection `medicines` where `userId == req.userId`.
   - Deletes document `users/{userId}` and subcollections `users/{userId}/settings/appSettings` and `users/{userId}/pushTokens/*`.
   - Deletes expiry schedule from `server_expiry_schedules/{userId}`.
   - Deletes sent alert deduplication logs from `server_sent_expiry_alerts` where `userId == req.userId`.
2. **Supabase PostgreSQL Purge**:
   - Executed via `server/supabaseBackup.ts:deleteUserAllDataFromSupabase(userId)`.
   - Purges all rows where `user_id == userId` in `public.medicines`.
   - Purges all rows where `user_id == userId` in `public.user_configs`.
   - Purges all rows where `user_id == userId` in `public.medicine_history`.
3. **In-Memory Worker State**:
   - Executed via `server/expiryCron.ts:purgeUserServerData(userId)`.
   - Evicts active schedules and rate-limiting buckets from memory.

---

## 13. Schedulers & Sync Triggers

1. **Client Debounce**:
   - Triggered on client data modifications with a 2500ms delay (`src/services/supabaseSyncService.ts:triggerDebouncedMedicinesSync`).
2. **Manual Sync**:
   - Triggered from the UI Settings modal (`src/components/SettingsModal.tsx:handleManualSupabaseSync`).
   - Calls `POST /api/backup/supabase/sync-medicines` followed by `POST /api/backup/two-way-sync` (scoped strictly to `req.userId`).
3. **Server Schedulers**:
   - Managed in `server.ts:setupViteAndListen`.
   - Evaluates `const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME)`.
   - On persistent hosts (Render / container), `server/expiryCron.ts:startExpiryCron()` runs in-process once every hour (`60 * 60 * 1000`).
   - On serverless hosts (Vercel), in-process intervals are disabled; scheduled jobs rely on external cron triggering `/api/cron/sync` and `/api/cron/check-expiry` with `CRON_SECRET` in header `x-cron-secret`.

---

## 14. Files Changed & Required Environment Variables

### Files Changed in Repository
1. `server.ts`:
   - Enforced user scoping on `/api/backup/two-way-sync` and `/api/backup/pull-from-supabase`.
   - Enforced authentication on `/api/backup/supabase/status` (Firebase Auth Bearer token OR `CRON_SECRET`).
   - Restricted `/api/cron/sync` and `/api/cron/check-expiry` strictly to header `x-cron-secret` via `crypto.timingSafeEqual` (removed `?secret=` query option).
   - Added administrative disaster recovery restore endpoint `/api/backup/restore-from-supabase`.
2. `server/twoWaySync.ts`:
   - Scoped `pushFirestoreToSupabase` and `pullSupabaseToFirebase` to `targetUserId`.
   - Replaced per-row `auth.getUser` with chunked, deduplicated `auth.getUsers` in 100-user batches.
   - Enforced pull safety: only update pre-existing Firestore docs, require `supabase.updated_at > firestore.updatedAt`, zero default placeholders, atomic batch triad, and anti-resurrection guards.
   - Added `restoreMissingFromSupabase` for admin-only restore.
3. `server/supabaseBackup.ts`:
   - Updated `executeMedicineUpsert` to strictly target composite key `(user_id, id)` and removed legacy `id` fallbacks.
   - Converted deletions into soft tombstones (`is_deleted = true`, `deleted_at = NOW()`, `updated_at = NOW()`).
   - Added log line in `formatMedicineForPostgres` when source edit time is absent and sync time is stamped.
   - Added `userId` scoping to `fetchMedicinesFromSupabase`.
4. `server/expiryCron.ts`:
   - Added automated pruning of dead FCM tokens returning `messaging/registration-token-not-registered` or `messaging/invalid-registration-token`.
5. `SUPABASE_BACKUP_SCHEMA.sql`:
   - Added explicit unique index `CREATE UNIQUE INDEX IF NOT EXISTS idx_medicines_user_id_id ON public.medicines (user_id, id);`.
   - Added `public.sync_state` table with RLS enabled and zero anon policies.
   - Configured `vw_active_medicines WITH (security_invoker = true)`.
   - Explicitly revoked all privileges on public tables and views from `anon` and `authenticated`.
6. `firestore.rules`:
   - Removed dead `isEncrypted` and `ivMap` from `isValidMedicine` schema.
7. `src/types.ts`:
   - Removed dead `isEncrypted` and `ivMap` properties from `Medicine` interface.
8. `FIREBASE_SUPABASE_INTEGRATION_SPEC.md`:
   - Complete architectural and data contract update.

### Environment Variables Needed
- `SUPABASE_URL`: HTTPS URL of your Supabase project (e.g. `https://xyz.supabase.co`).
- `SUPABASE_SERVICE_ROLE_KEY`: Service-role secret key for Supabase (bypasses RLS on server; never exposed to browser).
- `CRON_SECRET`: High-entropy shared secret for cron jobs and disaster recovery endpoints.
- `FIREBASE_SERVICE_ACCOUNT_KEY`: Service account JSON string for Firebase Admin SDK.
- `RESEND_API_KEY`: API key for automated expiry alert emails.

---

## 15. Changelog

- **2026-10-13**:
  - Scoped `/api/backup/pull-from-supabase` and `/api/backup/two-way-sync` to `req.userId`.
  - Restricted `/api/cron/sync` strictly to header `x-cron-secret` validated via `crypto.timingSafeEqual` (removed `?secret=` query option).
  - Protected `/api/backup/supabase/status` with Firebase Auth Bearer token or `CRON_SECRET`.
  - Added pull safety: existing-doc requirement in normal sync, `supabase.updated_at > firestore.updatedAt` check, zero default placeholders, and atomic batch triads.
  - Added administrative restore endpoint `/api/backup/restore-from-supabase`.
  - Replaced per-row `auth.getUser` with deduplicated, batched `auth.getUsers` (100 per chunk).
  - Enforced composite on-conflict target `user_id,id` in Supabase upserts and added unique index in schema.
  - Replaced hard-deletes with `is_deleted` tombstones to prevent resurrection.
  - Added warning log line when documents lack source timestamps and stamp sync time.
  - Hardened `SUPABASE_BACKUP_SCHEMA.sql`: added `sync_state`, `security_invoker` view, and explicit `REVOKE ALL` from `anon`/`authenticated`.
  - Implemented automatic pruning of unregistered FCM tokens (`registration-token-not-registered`).
  - Removed dead `isEncrypted` and `ivMap` fields from `firestore.rules` and `src/types.ts`.
  - Documented complete account deletion lifecycle across all datastores.
