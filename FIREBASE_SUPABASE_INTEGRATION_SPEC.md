# DawaSnap AI: Firebase & Supabase Integration Specification

> **Classification**: Internal System Architecture & Data Contract  
> **Source Grounding**: Derived directly from codebase files (`server/supabaseBackup.ts`, `server/twoWaySync.ts`, `server/expiryCron.ts`, `server.ts`, `firestore.rules`, `src/types.ts`, `src/services/supabaseSyncService.ts`, `src/services/nativeNotificationService.ts`, `src/services/localImageStorage.ts`).  
> **Last Updated**: 2026-10-13

---

## 1. System Role & Architecture

```
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

3. **Data Flow**:
   - **Firestore → Supabase**: Triggered by client debounced calls (`src/services/supabaseSyncService.ts:triggerDebouncedMedicinesSync`), manual sync in settings (`src/components/SettingsModal.tsx:handleManualSupabaseSync`), and server-side push (`server/twoWaySync.ts:pushFirestoreToSupabase`).
   - **Supabase → Firestore**: Triggered by `/api/backup/pull-from-supabase` or `/api/backup/two-way-sync` (`server/twoWaySync.ts:pullSupabaseToFirebase`).

---

## 2. Table & Collection Mappings

| Firebase Firestore Path | Supabase PostgreSQL Table | Primary Key in Supabase | Code Mapping Function |
| :--- | :--- | :--- | :--- |
| `medicines/{medicineId}` | `public.medicines` | `id` | `server/supabaseBackup.ts:formatMedicineForPostgres` |
| `medicines/{medicineId}/history/{historyId}` | `public.medicine_history` | `id` | `server/supabaseBackup.ts:backupMedicineHistoryToSupabase` |
| `users/{userId}/settings/appSettings` | `public.user_configs` | `user_id` | `server/supabaseBackup.ts:backupUserConfigToSupabase` |
| Firebase Auth User Profiles | `public.users` | `user_id` | `server/supabaseBackup.ts:backupUsersBatchToSupabase` |
| `users/{userId}/pushTokens/{tokenId}` | *(Firestore only)* | N/A | `server.ts` (`POST /api/notifications/register-token`) |

---

## 3. Endpoints & Authentication Matrix

| Endpoint | HTTP Method | Authentication Method | Caller Scope | Database Touchpoints | Implementation Reference |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `/api/backup/supabase/status` | `GET` | Public / None | Anyone | Checks Supabase connection (`medicines` limit 1) | `server.ts` |
| `/api/backup/supabase/sync-medicines` | `POST` | Firebase Bearer Token (`requireFirebaseAuth`) | Authenticated User (Strictly scoped to caller's `req.userId`) | Upserts array of rows to Supabase `medicines` | `server.ts`, `server/supabaseBackup.ts:backupMedicinesBatchToSupabase` |
| `/api/backup/supabase/sync-medicine` | `POST` | Firebase Bearer Token (`requireFirebaseAuth`) | Authenticated User (Forces `medicine.userId = req.userId`) | Upserts single row to Supabase `medicines` | `server.ts`, `server/supabaseBackup.ts:backupMedicineToSupabase` |
| `/api/backup/supabase/delete-medicine` | `POST` | Firebase Bearer Token (`requireFirebaseAuth`) | Authenticated User (Deletes only where `user_id == req.userId`) | Deletes row from Supabase `medicines` | `server.ts`, `server/supabaseBackup.ts:deleteMedicineFromSupabase` |
| `/api/backup/supabase/delete-medicines-batch` | `POST` | Firebase Bearer Token (`requireFirebaseAuth`) | Authenticated User (Deletes only where `user_id == req.userId`) | Deletes multiple rows from Supabase `medicines` | `server.ts`, `server/supabaseBackup.ts:deleteMedicinesBatchFromSupabase` |
| `/api/backup/supabase/sync-config` | `POST` | Firebase Bearer Token (`requireFirebaseAuth`) | Authenticated User (Forces `config.userId = req.userId`) | Upserts row to Supabase `user_configs` | `server.ts`, `server/supabaseBackup.ts:backupUserConfigToSupabase` |
| `/api/backup/supabase/sync-history` | `POST` | Firebase Bearer Token (`requireFirebaseAuth`) | Authenticated User (Forces `history.userId = req.userId`) | Upserts row to Supabase `medicine_history` | `server.ts`, `server/supabaseBackup.ts:backupMedicineHistoryToSupabase` |
| `/api/backup/two-way-sync` | `POST` | Firebase Bearer Token (`requireFirebaseAuth`) | Authenticated User | Runs full push to Supabase, then pulls from Supabase | `server.ts`, `server/twoWaySync.ts:runTwoWaySync` |
| `/api/backup/pull-from-supabase` | `POST` | Firebase Bearer Token (`requireFirebaseAuth`) | Authenticated User | Reads Supabase `medicines` and writes to Firestore `medicines` via `bulkWriter` | `server.ts`, `server/twoWaySync.ts:pullSupabaseToFirebase` |
| `/api/notifications/register-token` | `POST` | Firebase Bearer Token (`requireFirebaseAuth`) | Authenticated User | Writes document to Firestore `users/{userId}/pushTokens/{tokenId}` | `server.ts` |
| `/api/cron/sync` | `POST` | `x-cron-secret` Header or `?secret=` | Internal Scheduler / Cron | Executes `runTwoWaySync()` server-wide | `server.ts:verifyCronAuth` |
| `/api/cron/check-expiry` | `POST` | `x-cron-secret` Header or `?secret=` | Internal Scheduler / Cron | Executes `runBackgroundExpiryCheck()` | `server.ts:verifyCronAuth`, `server/expiryCron.ts` |

---

## 4. Upsert & Conflict Resolution Mechanics

### Real Primary Keys & On-Conflict Targets
1. **`public.medicines`**:
   - **Primary Key**: `id` (`TEXT`).
   - **Conflict Strategy in Code** (`server/supabaseBackup.ts:executeMedicineUpsert`):
     - Strategy 1: Attempts upsert with candidate targets `['user_id,id', 'id', 'id,user_id', undefined]`. Once a target succeeds, it caches `resolvedMedicineConflictTarget`.
     - Strategy 2 (Fallback): If candidate conflict targets fail with Postgres error `42P10` (no unique constraint matching given keys), code falls back to `client.from('medicines').select('id').eq('id', row.id).eq('user_id', row.user_id)`. If record exists, it runs `.update()`; otherwise `.insert()`.
2. **`public.users`**:
   - **Primary Key**: `user_id` (`TEXT`).
   - **Conflict Target**: `{ onConflict: 'user_id' }` (`server/supabaseBackup.ts:backupUsersBatchToSupabase`).
3. **`public.user_configs`**:
   - **Primary Key**: `user_id` (`TEXT`).
   - **Conflict Target**: `{ onConflict: 'user_id' }` (`server/supabaseBackup.ts:backupUserConfigToSupabase`).
4. **`public.medicine_history`**:
   - **Primary Key**: `id` (`TEXT`).
   - **Conflict Target**: `{ onConflict: 'id' }` (`server/supabaseBackup.ts:backupMedicineHistoryToSupabase`).

### Conflict Resolution Rule & Timestamp Semantics
- **Meaning of `updated_at` in Supabase**: Represents the **source edit time** (`server/supabaseBackup.ts:formatMedicineForPostgres`), converted from Firestore `updatedAt` (or `createdAt`). It is **NOT** the timestamp of when the backup sync executed.
- **Clock Skew Handling**: During push (`server/twoWaySync.ts:pushFirestoreToSupabase`), incremental selection filters documents where `docUpdatedMs >= persistentLastSync`. If `sync_state` table is missing or empty, `persistentLastSync` evaluates to `0`, resulting in a full push.
- **Pull Overwrite**: When pulling from Supabase (`server/twoWaySync.ts:pullSupabaseToFirebase`), writes use `bulkWriter.set(docRef, updatePayload, { merge: true })`. No field-level three-way merge or clock-skew compensation is performed; Supabase values overwrite matching Firestore fields unconditionally, setting Firestore `updatedAt = new Date(row.updated_at).getTime()`.

---

## 5. Complete Field-by-Field Medicine Mapping

The following matrix documents **every** field permitted in Firestore by `firestore.rules:isValidMedicine` and `src/types.ts:Medicine`:

| Firestore Field | Type in Firestore | Supabase Column in `public.medicines` | Included in `raw_payload` | Restored by `pullSupabaseToFirebase`? |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `string` | `id` | Yes | **Yes** |
| `userId` | `string` | `user_id` | Yes | **Yes** |
| `name` | `string` | `name` | Yes | **Yes** |
| `dosage` | `string` | `dosage` | Yes | **Yes** |
| `expirationDate` | `string` | `expiration_date` | Yes | **Yes** |
| `quantity` | `number` | `quantity` | Yes | **Yes** |
| `totalQuantity` | `number` | `total_quantity` | Yes | **Yes** |
| `form` | `string` (enum) | `form` | Yes | **Yes** (defaults to `'tablet'` if missing) |
| `category` | `string` | `category` | Yes | **Yes** |
| `categories` | `array` (`string[]`) | `categories` | Yes | **Yes** (defaults to `[row.category]` if not array) |
| `tags` | `array` (`string[]`) | `tags` | Yes | **Yes** (defaults to `[]` if not array) |
| `usageInstructions`| `string` | `usage_instructions` | Yes | **Yes** (defaults to `''` if missing) |
| `price` | `number` \| `string` | `price` | Yes | **Yes** |
| `barcode` | `string` | `barcode` | Yes | **Yes** |
| `mfgDate` | `string` | `mfg_date` | Yes | **Yes** |
| `manufacturer` | `string` | `manufacturer` | Yes | **Yes** |
| `taken` | `boolean` | `taken` | Yes | **Yes** |
| `liked` | `boolean` | `liked` | Yes | **Yes** |
| `isDeleted` | `boolean` | `is_deleted` | Yes | **Yes** |
| `deletedAt` | `number` | `deleted_at` | Yes | **No** (`deletedAt` is not mapped in `pullSupabaseToFirebase`) |
| `createdAt` | `number` \| `timestamp` | `created_at` | Yes | **No** (`createdAt` is not mapped in `pullSupabaseToFirebase`) |
| `updatedAt` | `number` \| `timestamp` | `updated_at` | Yes | **Yes** (mapped from `row.updated_at`) |
| `schedule` | `string` | None | Yes | **No** (field lost if doc only exists in Supabase) |
| `notes` | `string` | None | Yes | **No** (field lost if doc only exists in Supabase) |
| `batches` | `array` | `batches` (`jsonb`/`text`) | Yes | **No** (not mapped back in `pullSupabaseToFirebase`) |
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
| `isEncrypted` | `boolean` | None | Yes | **No** |
| `ivMap` | `map` | None | Yes | **No** |
| `imageUrl` | `string` | None | Yes (`'local'`) | **No** |
| `capturedImage` | `string` (base64) | None | **Stripped** | **No** (never saved to cloud) |
| `capturedImageBack` | `string` (base64) | None | **Stripped** | **No** (never saved to cloud) |
| `imageData` | `string` (base64) | None | **Stripped** | **No** (never saved to cloud) |

---

## 6. Data Contract & Pull Invariants

When rows in Supabase `public.medicines` are ingested by `server/twoWaySync.ts:pullSupabaseToFirebase`, the following strict rules are enforced:

1. **User Identity Verification**:
   - `row.user_id` is queried against Firebase Authentication using `auth.getUser(row.user_id)`.
   - If the user account does not exist in Firebase Auth, **the row is skipped**.
2. **Key Invariants**:
   - `row.id` must be a non-empty string.
   - `row.user_id` must be a non-empty string.
   - `row.name` must be a non-empty string.
3. **Format & Value Rejection Filters**:
   - `row.expiration_date` must match `/^\d{4}-\d{2}-\d{2}$/`.
   - `row.dosage` must not be `'N/A'`.
   - `row.category` must not be `'Other'`.
4. **Fallback Defaults Applied When Pulling Into Firestore**:
   - `form`: defaults to `'tablet'` if null or empty.
   - `quantity`: defaults to `0` if not a number.
   - `totalQuantity`: defaults to `row.quantity` or `0` if not a number.
   - `categories`: defaults to `[row.category]` if not an array.
   - `tags`: defaults to `[]` if not an array.
   - `usageInstructions`: defaults to `''` if null or empty.
   - `price`: defaults to `null` if not a number.
   - `barcode`, `mfgDate`, `manufacturer`: default to `null` if empty.
   - `taken`, `liked`, `isDeleted`: default to `false` if falsy.
   - `updatedAt`: defaults to `new Date(row.updated_at).getTime()` or `Date.now()`.

---

## 7. History & User Settings Sync Details

### History Mapping
- In Firestore: subcollection documents at `medicines/{medicineId}/history/{historyId}`.
- In Supabase: table `public.medicine_history`.
- **Field Conversion**: Firestore `actionType` is mapped to Supabase column `action` (`server/supabaseBackup.ts:backupMedicineHistoryBatchToSupabase`). Allowed actions in `firestore.rules`: `'CREATE'`, `'EDIT'`, `'MARK_TAKEN'`, `'MARK_NOT_TAKEN'`, `'DELETE'`.
- **Sync Direction**: **ONE-WAY ONLY (Firestore → Supabase)**. Pulling history from Supabase into Firestore is **NOT IMPLEMENTED**.

### User Config (`public.user_configs`)
- Handled by `server/supabaseBackup.ts:backupUserConfigToSupabase`.
- `alertThreshold`: Allowed values enforced by `firestore.rules:isValidUserConfig` are **any number between `0` and `365`** (`data.alertThreshold >= 0 && data.alertThreshold <= 365`). The UI offers preset buttons for 30, 60, and 90 days, but the database contract accepts any number in the range `[0, 365]`.

---

## 8. Deletion Semantics & Resurrection Risks

1. **Soft Delete**:
   - Client soft delete sets `isDeleted: true` and `deletedAt: Date.now()` in Firestore (`src/App.tsx:handleDeleteMultiple`).
   - In Supabase, this translates to `is_deleted = true` and `deleted_at = <ISO timestamp>`.
2. **Hard Delete (Firestore → Supabase)**:
   - When a user permanently deletes a medicine (`src/App.tsx:handlePermanentDelete`), the client executes `deleteDoc(doc(db, 'medicines', id))` in Firestore and calls `DELETE /api/backup/supabase/delete-medicine`.
   - During push sync (`server/twoWaySync.ts:pushFirestoreToSupabase`), any medicine present in Supabase with `is_deleted = false` that no longer exists in Firestore is marked `is_deleted = true`.
3. **Resurrection Risk (Supabase → Firestore)**:
   - `pullSupabaseToFirebase` does **NOT** delete Firestore documents missing from Supabase.
   - If a medicine was permanently deleted in Firestore, but remains in Supabase with `is_deleted = false`, running `pullSupabaseToFirebase` will recreate the medicine document in Firestore.
   - Permanent deletions must therefore be reflected in Supabase (either deleted or marked `is_deleted = true`) to avoid resurrection.

---

## 9. Encryption Status & IV Map

- `src/types.ts:Medicine` and `firestore.rules:isValidMedicine` define `isEncrypted?: boolean` and `ivMap?: { [key: string]: string }`.
- Client-side field-level encryption logic: **NOT IMPLEMENTED**.
- At-rest encryption is provided natively by Google Cloud Firestore (AES-256) and in-transit encryption by TLS 1.3.
- **Constraint**: External writers must **NOT** set `isEncrypted: true` or populate `ivMap`. Because decryption logic is NOT IMPLEMENTED in the client, writing ciphertexts will cause the UI to display raw cipher strings.

---

## 10. ID Generation

- Medicine IDs in Firestore: Generated using standard `crypto.randomUUID()` (`src/App.tsx:1062`). Format is a standard 36-character UUID v4.
- History IDs in Firestore: Generated using `crypto.randomUUID()` (`src/App.tsx:1052`, `src/App.tsx:1104`).
- Constraint: Document IDs must satisfy `firestore.rules:isValidMedicine` (`data.id is string && data.id.size() > 0 && data.id.size() < 100`).

---

## 11. Push Tokens, FCM & Storage Usage

1. **Push Token Storage**:
   - Document path: `users/{userId}/pushTokens/{tokenId}`.
   - Saved by client (`src/services/nativeNotificationService.ts`) or server (`server.ts:POST /api/notifications/register-token`).
   - Structure: `{ token: string, platform: 'android' | 'web', userAgent?: string, updatedAt: string }`.
   - Security: Permitted for authenticated user (`firestore.rules: match /pushTokens/{tokenId} { allow read, write: if isAuthenticated() && request.auth.uid == userId; }`).
2. **FCM Dispatch Flow**:
   - Worker: `server/expiryCron.ts:runBackgroundExpiryCheck`.
   - When an alert condition triggers (`30_DAYS`, `7_DAYS`, `EXPIRED`), the worker fetches tokens from `users/{userId}/pushTokens` and dispatches alerts via `firebase-admin/messaging:getMessaging().sendEachForMulticast()`.
3. **Firebase Storage**:
   - Firebase Storage SDK is imported in `src/firebase.ts`, but is **UNUSED** by the application.
   - All captured packaging images are stored exclusively in on-device IndexedDB via `src/services/localImageStorage.ts`.

---

## 12. Schedulers & Sync Triggers

1. **Client Debounce**:
   - Implemented in `src/services/supabaseSyncService.ts:triggerDebouncedMedicinesSync`.
   - Timer: 2500ms debounce delay (`DEBOUNCE_DELAY_MS`).
2. **Manual Sync**:
   - Triggered via UI in `src/components/SettingsModal.tsx:handleManualSupabaseSync`.
   - Calls `POST /api/backup/supabase/sync-medicines` followed by `POST /api/backup/two-way-sync`.
3. **Server Schedulers**:
   - Managed in `server.ts:setupViteAndListen`.
   - Host check: `const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME)`.
   - When running on a persistent host (Render / container), `server/expiryCron.ts:startExpiryCron()` runs in-process once every hour (`60 * 60 * 1000`).
   - On serverless hosts (Vercel), in-process intervals are disabled; scheduled jobs rely on external cron triggering `/api/cron/sync` and `/api/cron/check-expiry` with `CRON_SECRET`.

---

## 13. Known Limitations & Security Notes

1. **Unidirectional History**: Medicine history audit records are pushed to Supabase, but are never pulled back into Firestore.
2. **Partial Field Restoration**: `pullSupabaseToFirebase` only maps a subset of columns back into Firestore documents. Custom metadata (`batches`, `dosageUnit`, `schedule`, `notes`, `enableEmailExpiryAlert`) is omitted during pull.
3. **Rate Limiting Scope**: `authenticatedUidLimiter` in `server.ts` uses in-memory map tracking. In distributed or serverless environments, state is not shared across instances.
4. **Zero Cloud Photos**: Photos never sync to Supabase or Firestore. `imageUrl` is hardcoded to `'local'`.
5. **No 3-Way Diffing**: Sync uses last-write-wins based on `updated_at`. Concurrent edits to different fields on the same document are not merged at the field level.

---

## 14. Changelog

- **2026-10-13**:
  - Aligned document with actual repository implementation (`server/supabaseBackup.ts`, `server/twoWaySync.ts`, `server/expiryCron.ts`, `server.ts`).
  - Corrected table primary keys and conflict targets (`medicines: id`, `users: user_id`, `user_configs: user_id`, `medicine_history: id`).
  - Added comprehensive endpoints and authentication matrix.
  - Added full field mapping with pull restoration statuses.
  - Documented deletion semantics, resurrection risks, encryption status (NOT IMPLEMENTED), ID generation (`crypto.randomUUID`), and FCM dispatch flows.
  - Specified allowed range for `alertThreshold` (`[0, 365]`).
  - Replaced external assistant targeting with a neutral data contract.
