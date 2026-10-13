# DawaSnap AI: Firebase & Supabase Integration Specification

> **Target Audience**: External AI Assistants (e.g., Claude), backend engineers, and automated data scripts modifying the Supabase PostgreSQL database who do not have direct access to Google Cloud / Firebase console credentials.
> **Database Environment**:
> - **Firebase Firestore**: `ai-studio-e1e8d489-3968-4072-8848-8d0fc6a943f7` (Primary Live App Store & Real-Time Sync)
> - **Supabase PostgreSQL**: Configured via server-side environment variables `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (Relational SQL Mirror & Analytical Storage)

---

## 1. System Role & Architecture Overview

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
                │ (/server/twoWaySync.ts)       │
                ▼                               │
 ┌───────────────────────────────┐              │
 │     SUPABASE POSTGRESQL       │──────────────┘
 │    (Relational SQL Mirror)    │ (Pulls back via /api/backup/pull-from-supabase)
 └───────────────────────────────┘
```

1. **Firebase Firestore (Primary Live DB & Auth)**:
   - Primary database used by Web and Android clients.
   - Client code listens in real time using Firestore SDK `onSnapshot`.
   - Security enforced via Attribute-Based Access Control in `firestore.rules`.
   - All data is strictly scoped by user ID (`userId == request.auth.uid`).

2. **Supabase PostgreSQL (Relational SQL Mirror)**:
   - Synchronized copy used for SQL queries, backups, complex relational filters, and external AI agents (like Claude).
   - Server backend accesses Supabase using `SUPABASE_SERVICE_ROLE_KEY`.

3. **Data Direction & Two-Way Sync**:
   - **Firestore → Supabase**: Automatic debounced updates when users create/edit/delete medicines in the app, plus hourly scheduled cron.
   - **Supabase → Firestore**: Triggered via `/api/backup/pull-from-supabase` or `/api/backup/two-way-sync` (or the "Sync Now" button in the app's Settings menu).

---

## 2. Table & Collection Mappings

| Firebase Firestore Path | Supabase PostgreSQL Table | Purpose |
| :--- | :--- | :--- |
| `medicines/{medicineId}` | `public.medicines` | Master medication records & dosage vaults |
| `medicines/{medicineId}/history/{historyId}` | `public.medicine_history` | Audit log of actions (Taken, Edited, Created, Deleted) |
| `users/{userId}/settings/appSettings` | `public.user_configs` | User app preferences, thresholds & theme |
| Firebase Auth User Profiles | `public.users` | Registered user identities, emails & provider IDs |
| `users/{userId}/pushTokens/{tokenId}` | *(Server / FCM only)* | Mobile/browser push notification tokens |

---

## 3. Detailed Schemas & Field Mappings

### A. Medications (`medicines` collection ⇄ `public.medicines` table)

| Firestore Document Field (camelCase) | Supabase Table Column (snake_case) | Supabase Column Type | Format / Constraints & Validations |
| :--- | :--- | :--- | :--- |
| `id` | `id` | `TEXT` (Primary Key) | Unique ID string (e.g., `med_1728829102938` or UUID) |
| `userId` | `user_id` | `TEXT` | **Must match a valid, existing Firebase Auth UID** |
| `name` | `name` | `TEXT` | Drug brand or generic name. Cannot be empty. |
| `dosage` | `dosage` | `TEXT` | Strength & unit (e.g., `"500 mg"`, `"10 ml"`). **Never use `"N/A"`**. |
| `form` | `form` | `TEXT` | Allowed values: `'tablet'`, `'capsule'`, `'syrup'`, `'drops'`, `'cream'`, `'lotion'`, `'soap'`, `'ointment'`, `'gel'`, `'spray'`, `'inhaler'`, `'injection'`, `'ampule'`, `'powder'`, `'sachet'`, `'suspension'`, `'tape'`, `'liquid'`, `'other'` |
| `expirationDate` | `expiration_date` | `TEXT` / `DATE` | **Strict format: `YYYY-MM-DD`** (e.g., `"2027-05-15"`) |
| `quantity` | `quantity` | `NUMERIC` / `INTEGER` | Active remaining pill/unit count (≥ 0) |
| `totalQuantity` | `total_quantity` | `NUMERIC` / `INTEGER` | Original total pack quantity (≥ 0) |
| `category` | `category` | `TEXT` | Primary clinical category (e.g., `"Antibiotic"`, `"Analgesic / Pain"`, `"Cardiovascular"`). **Never use `"Other"`**. |
| `categories` | `categories` | `TEXT[]` | Multi-category array of strings |
| `tags` | `tags` | `TEXT[]` | Clinical and personal tags (e.g., `["prescription", "daily", "morning"]`) |
| `usageInstructions` | `usage_instructions` | `TEXT` | Instructions / physician advisory text |
| `price` | `price` | `NUMERIC` | Price per unit or pack |
| `barcode` | `barcode` | `TEXT` | Scanned UPC/EAN barcode number |
| `mfgDate` | `mfg_date` | `TEXT` / `DATE` | Manufacturing date (`YYYY-MM-DD`) |
| `manufacturer` | `manufacturer` | `TEXT` | Pharmaceutical company name |
| `taken` | `taken` | `BOOLEAN` | `true` if current scheduled dose is marked taken |
| `liked` | `liked` | `BOOLEAN` | Favorite/starred status |
| `isDeleted` | `is_deleted` | `BOOLEAN` | Soft deletion status (`true` = in Trash, `false` = active) |
| `deletedAt` | `deleted_at` | `TIMESTAMPTZ` | Timestamp when soft deleted, or `null` |
| `batches` | `batches` | `JSONB` / `TEXT` | Multi-batch inventory tracking array serialized as JSON |
| `raw_payload` | `raw_payload` | `JSONB` / `TEXT` | Clean JSON mirror of full Firestore document |
| `createdAt` | `created_at` | `TIMESTAMPTZ` | ISO 8601 string in Supabase; epoch ms in Firestore |
| `updatedAt` | `updated_at` | `TIMESTAMPTZ` | ISO 8601 string in Supabase; epoch ms in Firestore |

> ⚠️ **Zero-Image Privacy Constraint**: Medication images are strictly on-device only. `imageUrl` is set to `'local'`. **Never write raw base64 data URIs or image buffers into Supabase**.

---

### B. User Settings (`users/{userId}/settings/appSettings` ⇄ `public.user_configs` table)

| Firestore Document Field | Supabase Table Column | Supabase Column Type | Valid Values / Constraints |
| :--- | :--- | :--- | :--- |
| `userId` | `user_id` | `TEXT` (Primary Key) | Firebase Auth UID |
| `email` | `email` | `TEXT` | User's verified email address |
| `emailNotificationsEnabled` | `email_notifications_enabled` | `BOOLEAN` | Whether email expiry alerts are dispatched |
| `browserNotificationsEnabled` | `browser_notifications_enabled` | `BOOLEAN` | Push notifications toggle |
| `alertThreshold` | `alert_threshold` | `INTEGER` | Days in advance to warn of expiry (`30`, `60`, or `90`) |
| `lowQuantityThreshold` | `low_quantity_threshold` | `INTEGER` | Pill threshold for low-stock warning (default: `5`) |
| `accentColor` | `accent_color` | `TEXT` | Hex color code (e.g. `"#0f9d58"`) |
| `sortOrder` | `sort_order` | `TEXT` | `'default'`, `'asc'`, or `'desc'` |
| `theme` | `theme` | `TEXT` | `'system'`, `'light'`, or `'dark'` |
| `updatedAt` | `updated_at` | `TIMESTAMPTZ` | ISO 8601 string |

---

### C. User Identities (`public.users` table)

| Supabase Table Column | Supabase Column Type | Description |
| :--- | :--- | :--- |
| `user_id` | `TEXT` (Primary Key) | Firebase Auth UID (e.g., `11PjRN55FZPn5kb4JNUBkvOiv3F2`) |
| `email` | `TEXT` | User email address |
| `display_name` | `TEXT` | Full name / profile name |
| `photo_url` | `TEXT` | Google avatar profile image URL |
| `phone_number` | `TEXT` | Associated phone number or `null` |
| `email_verified` | `BOOLEAN` | Whether email is verified |
| `disabled` | `BOOLEAN` | Account disabled flag |
| `provider_ids` | `TEXT[]` | Array of auth providers, e.g. `["password"]`, `["google.com"]` |
| `last_sign_in_time` | `TIMESTAMPTZ` | Last authentication timestamp |
| `created_at` | `TIMESTAMPTZ` | User account creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | Account record update timestamp |
| `metadata` | `TEXT` / `JSONB` | JSON metadata and custom claims |

---

### D. Audit Log (`medicines/{medicineId}/history/{historyId}` ⇄ `public.medicine_history` table)

| Supabase Table Column | Type | Notes |
| :--- | :--- | :--- |
| `id` | `TEXT` (Primary Key) | History log ID |
| `medicine_id` | `TEXT` | Parent medicine document ID |
| `user_id` | `TEXT` | Firebase Auth UID |
| `action` | `TEXT` | `'CREATE'`, `'EDIT'`, `'MARK_TAKEN'`, `'MARK_NOT_TAKEN'`, `'DELETE'` |
| `details` | `TEXT` | Human-readable log entry (e.g. `"Quantity reduced to 14"`) |
| `timestamp` | `BIGINT` / `TIMESTAMPTZ` | Epoch ms / ISO timestamp of event |
| `created_at` | `TIMESTAMPTZ` | Creation timestamp |

---

## 4. Strict Validation Requirements for Claude

When writing directly to Supabase, you **must adhere to these rules** so that the sync engine accepts your rows when pulling them into Firebase Firestore (`/server/twoWaySync.ts`):

1. **Existing User Verification**:
   - `user_id` **must correspond to a registered user in Firebase Auth**.
   - If an unrecognized `user_id` is supplied, the sync engine will drop the row.
2. **Strict Expiration Date Pattern**:
   - `expiration_date` must match `/^\d{4}-\d{2}-\d{2}$/` (e.g., `"2027-04-30"`).
3. **No Empty or Placeholder Strings**:
   - `name` cannot be empty.
   - `dosage` cannot be empty or `"N/A"`.
   - `category` cannot be `"Other"`.
4. **Valid Formulations (`form`)**:
   - Must be one of the listed enum strings (e.g., `'tablet'`, `'capsule'`, `'syrup'`).
5. **Upsert Conflict Target (`onConflict`)**:
   - Table `medicines`: use `onConflict: 'user_id,id'` or `'id'`.
   - Table `users`: use `onConflict: 'user_id'`.
   - Table `user_configs`: use `onConflict: 'user_id'`.

---

## 5. How to Trigger Data Synchronization

Once Claude or an automated script finishes updating rows in Supabase, execute any of the following to pull the new data into Firebase:

1. **Trigger via HTTP API**:
   - **`POST /api/backup/pull-from-supabase`**
     Pulls updated rows from Supabase PostgreSQL and merges them into Firebase Firestore documents using `bulkWriter`.
   - **`POST /api/backup/two-way-sync`**
     Performs a full bidirectional sync (pushes latest Firestore edits to Supabase, then pulls Supabase updates into Firestore).
   - *Requires standard Firebase Authorization Bearer token header*.

2. **Trigger via In-App UI**:
   - Open DawaSnap AI.
   - Click the gear icon (**Settings**).
   - Under **Supabase SQL Backup**, click **"Sync Now"**.
