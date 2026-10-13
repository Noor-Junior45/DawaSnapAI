import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import firebaseConfig from '../firebase-applet-config.json' with { type: 'json' };
import { 
  backupMedicinesBatchToSupabase, 
  backupUserConfigToSupabase, 
  backupUsersBatchToSupabase, 
  backupMedicineHistoryBatchToSupabase,
  fetchMedicinesFromSupabase,
  getPersistentSyncState,
  setPersistentSyncState,
  isSupabaseConfigured,
  getSupabaseClient
} from './supabaseBackup.ts';
import { getAdminApp, hasServiceAccountConfigured } from './firebaseAdmin.ts';

let isSyncInProgress = false;

let cachedDb: any = null;

function getAdminDb() {
  if (cachedDb) return cachedDb;
  const adminApp = getAdminApp();
  cachedDb = getFirestore(adminApp, firebaseConfig.firestoreDatabaseId);
  try {
    cachedDb.settings({ ignoreUndefinedProperties: true });
  } catch {
    // Settings already applied
  }
  return cachedDb;
}

export interface SyncReport {
  timestamp: string;
  pushedMedicines: number;
  pushedConfigs: number;
  pushedUsers: number;
  pushedHistory: number;
  errors: string[];
}

/**
 * Pushes Firestore data to Supabase incrementally (ONE-WAY: Firestore -> Supabase).
 * When targetUserId is supplied, strictly isolates operations to rows where user_id == targetUserId.
 * When targetUserId is omitted, executes global push across all users (restricted to internal cron).
 */
export async function pushFirestoreToSupabase(targetUserId?: string): Promise<{ 
  medicines: number; 
  configs: number; 
  users: number; 
  history: number;
}> {
  if (!isSupabaseConfigured()) {
    return { medicines: 0, configs: 0, users: 0, history: 0 };
  }

  let medCount = 0;
  let configCount = 0;
  let userCount = 0;
  let historyCount = 0;

  const currentSyncStart = Date.now();
  const syncStateKey = targetUserId ? `firestore_to_supabase_${targetUserId}` : 'firestore_to_supabase';
  const persistentLastSync = await getPersistentSyncState(syncStateKey);

  try {
    const db = getAdminDb();

    // 1. Medicines Push (Incremental: docUpdatedAt >= persistentLastSync)
    try {
      let query: any = db.collection('medicines');
      if (targetUserId) {
        query = query.where('userId', '==', targetUserId);
      }
      const medSnap = await query.get();
      const medsToPush: any[] = [];

      medSnap.forEach((d: any) => {
        const data = d.data();
        if (targetUserId && data.userId !== targetUserId) {
          return;
        }

        let docUpdatedMs = 0;
        if (typeof data.updatedAt === 'number') {
          docUpdatedMs = data.updatedAt;
        } else if (data.updatedAt?.toMillis) {
          docUpdatedMs = data.updatedAt.toMillis();
        } else if (typeof data.createdAt === 'number') {
          docUpdatedMs = data.createdAt;
        } else if (data.createdAt?.toMillis) {
          docUpdatedMs = data.createdAt.toMillis();
        }

        // Only include if never synced before or updated after last persistent sync
        if (persistentLastSync === 0 || docUpdatedMs >= persistentLastSync) {
          medsToPush.push({ id: d.id, ...data });
        }
      });

      if (medsToPush.length > 0) {
        const result = await backupMedicinesBatchToSupabase(medsToPush, targetUserId);
        medCount = result.success;
      }

      // Propagate deletions: mark Supabase active rows as is_deleted tombstones if deleted in Firestore
      try {
        const activeFirestoreIds = new Set(
          medSnap.docs.filter((d: any) => !d.data()?.isDeleted).map((d: any) => d.id)
        );
        const supabaseActiveRows = await fetchMedicinesFromSupabase(undefined, targetUserId);
        const toDeleteInSupabase: string[] = [];

        for (const row of supabaseActiveRows) {
          if (!row.is_deleted && !activeFirestoreIds.has(row.id)) {
            toDeleteInSupabase.push(row.id);
          }
        }

        if (toDeleteInSupabase.length > 0) {
          const client = getSupabaseClient();
          if (client) {
            let delQuery = client
              .from('medicines')
              .update({ 
                is_deleted: true, 
                deleted_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              })
              .in('id', toDeleteInSupabase);

            if (targetUserId) {
              delQuery = delQuery.eq('user_id', targetUserId);
            }
            await delQuery;
          }
        }
      } catch (delErr: any) {
        console.warn('[FIRESTORE->SUPABASE] Notice propagating deletions:', delErr.message);
      }
    } catch (err: any) {
      console.warn('[FIRESTORE->SUPABASE] Error reading/pushing medicines:', err.message);
    }

    // 2. User Configs Push (users/{uid}/settings/appSettings)
    try {
      if (targetUserId) {
        const settingsDoc = await db.collection('users').doc(targetUserId).collection('settings').doc('appSettings').get();
        if (settingsDoc.exists) {
          const data = settingsDoc.data() || {};
          let docUpdatedMs = 0;
          if (typeof data.updatedAt === 'number') {
            docUpdatedMs = data.updatedAt;
          } else if (data.updatedAt?.toMillis) {
            docUpdatedMs = data.updatedAt.toMillis();
          }

          if (persistentLastSync === 0 || docUpdatedMs >= persistentLastSync) {
            const configData = { userId: targetUserId, ...data };
            const ok = await backupUserConfigToSupabase(configData);
            if (ok) configCount++;
          }
        }
      } else {
        const settingsSnap = await db.collectionGroup('settings').get();
        for (const d of settingsSnap.docs) {
          if (d.id === 'appSettings') {
            const data = d.data() || {};
            const userId = d.ref.parent.parent?.id || data.userId;
            if (userId) {
              let docUpdatedMs = 0;
              if (typeof data.updatedAt === 'number') {
                docUpdatedMs = data.updatedAt;
              } else if (data.updatedAt?.toMillis) {
                docUpdatedMs = data.updatedAt.toMillis();
              }

              if (persistentLastSync === 0 || docUpdatedMs >= persistentLastSync) {
                const configData = { userId, ...data };
                const ok = await backupUserConfigToSupabase(configData);
                if (ok) configCount++;
              }
            }
          }
        }
      }
    } catch (err: any) {
      console.warn('[FIRESTORE->SUPABASE] Error pushing configs:', err.message);
    }

    // 3. User Accounts & Profiles Push
    try {
      const userProfiles: any[] = [];
      if (hasServiceAccountConfigured()) {
        const auth = getAuth(getAdminApp());

        if (targetUserId) {
          try {
            const u = await auth.getUser(targetUserId);
            userProfiles.push({
              uid: u.uid,
              email: u.email,
              displayName: u.displayName,
              photoURL: u.photoURL,
              phoneNumber: u.phoneNumber,
              emailVerified: u.emailVerified,
              disabled: u.disabled,
              providerData: u.providerData,
              metadata: {
                creationTime: u.metadata.creationTime,
                lastSignInTime: u.metadata.lastSignInTime,
              },
            });
          } catch (authErr: any) {
            console.warn('[FIRESTORE->SUPABASE] Admin getUser notice:', authErr.message);
          }
        } else {
          try {
            let pageToken: string | undefined = undefined;
            do {
              const listResult = await auth.listUsers(1000, pageToken);
              for (const u of listResult.users) {
                userProfiles.push({
                  uid: u.uid,
                  email: u.email,
                  displayName: u.displayName,
                  photoURL: u.photoURL,
                  phoneNumber: u.phoneNumber,
                  emailVerified: u.emailVerified,
                  disabled: u.disabled,
                  providerData: u.providerData,
                  metadata: {
                    creationTime: u.metadata.creationTime,
                    lastSignInTime: u.metadata.lastSignInTime,
                  },
                });
              }
              pageToken = listResult.pageToken;
            } while (pageToken);
          } catch (authErr: any) {
            console.warn('[FIRESTORE->SUPABASE] Admin listUsers notice:', authErr.message);
          }
        }
      }

      if (userProfiles.length > 0) {
        const res = await backupUsersBatchToSupabase(userProfiles);
        userCount = res.success;
      }
    } catch (err: any) {
      console.warn('[FIRESTORE->SUPABASE] Error pushing user accounts:', err.message);
    }

    // 4. Medicine History Push (Sync via collectionGroup('history'))
    try {
      const historySnap = await db.collectionGroup('history').get();
      const historyItems: any[] = [];

      historySnap.forEach((d: any) => {
        const data = d.data();
        const userId = data.userId || null;
        if (targetUserId && userId !== targetUserId) {
          return;
        }

        let ts = 0;
        if (typeof data.timestamp === 'number') {
          ts = data.timestamp;
        } else if (data.timestamp?.toMillis) {
          ts = data.timestamp.toMillis();
        }

        if (persistentLastSync === 0 || ts >= persistentLastSync) {
          const parentMedId = d.ref.parent.parent?.id || data.medicineId || '';
          historyItems.push({
            id: d.id,
            medicineId: parentMedId,
            userId,
            actionType: data.actionType || 'EDIT',
            details: data.details || null,
            timestamp: ts || Date.now(),
          });
        }
      });

      if (historyItems.length > 0) {
        const histRes = await backupMedicineHistoryBatchToSupabase(historyItems);
        historyCount = histRes.success;
      }
    } catch (err: any) {
      console.warn('[FIRESTORE->SUPABASE] Error syncing history:', err.message);
    }

    // Persist new sync state to Supabase table 'sync_state'
    await setPersistentSyncState(syncStateKey, currentSyncStart);
  } catch (err: any) {
    console.warn('[FIRESTORE->SUPABASE] Push exception:', err.message);
  }

  return { medicines: medCount, configs: configCount, users: userCount, history: historyCount };
}

/**
 * Strict, safe helper to pull updates from Supabase PostgreSQL back into Firebase Firestore.
 * 
 * Safety Guarantees:
 * 1. Scope: When targetUserId is supplied, pulls ONLY rows where user_id == targetUserId.
 * 2. Pull safety: Only updates Firestore docs that ALREADY exist; never creates docs in normal sync (allowCreateMissing = false).
 * 3. Timestamp check: Only applies row if supabase.updated_at > firestore.updatedAt.
 * 4. Deduplicated batched auth check: Uses getAuth().getUsers() in 100-user chunks (zero per-row network calls).
 * 5. Clean field mapping: Never writes default placeholders (no 'tablet', no '', skips absent fields).
 * 6. Batches triad: Restores batches together with quantity and expirationDate, or neither.
 * 7. Tombstone protection: Never resurrects deleted Firestore documents.
 */
export async function pullSupabaseToFirebase(
  targetUserId?: string,
  allowCreateMissing: boolean = false
): Promise<{ updated: number; errors: string[] }> {
  if (!isSupabaseConfigured()) {
    return { updated: 0, errors: ['Supabase not configured'] };
  }

  const errors: string[] = [];
  let updatedCount = 0;

  try {
    const db = getAdminDb();
    const auth = getAuth(getAdminApp());

    // Fetch Supabase rows (scoped to targetUserId if provided)
    const supabaseMeds = await fetchMedicinesFromSupabase(undefined, targetUserId);
    if (!Array.isArray(supabaseMeds) || supabaseMeds.length === 0) {
      return { updated: 0, errors: [] };
    }

    // Requirement 4: Deduplicated, batched getUsers lookup in chunks of 100
    const distinctUserIds = [...new Set(supabaseMeds.map(r => r.user_id).filter(Boolean))];
    const validUserIds = new Set<string>();

    for (let i = 0; i < distinctUserIds.length; i += 100) {
      const chunk = distinctUserIds.slice(i, i + 100).map(uid => ({ uid }));
      try {
        const res = await auth.getUsers(chunk);
        res.users.forEach(u => validUserIds.add(u.uid));
      } catch (authErr: any) {
        console.warn('[PULL] Batch getUsers lookup notice:', authErr.message);
      }
    }

    const bulkWriter = db.bulkWriter();
    bulkWriter.onWriteError((err: any) => {
      errors.push(`BulkWriter error: ${err.message || String(err)}`);
      return false; // do not retry failed writes
    });

    for (const row of supabaseMeds) {
      // 1. Strict schema & caller verification
      if (!row.id || typeof row.id !== 'string' || !row.user_id || typeof row.user_id !== 'string') {
        continue;
      }
      if (targetUserId && row.user_id !== targetUserId) {
        continue;
      }
      if (!validUserIds.has(row.user_id)) {
        continue;
      }
      if (!row.name || typeof row.name !== 'string' || row.name.trim().length === 0) {
        continue;
      }
      if (row.expiration_date && !/^\d{4}-\d{2}-\d{2}$/.test(row.expiration_date)) {
        continue;
      }
      if (row.dosage === 'N/A') {
        continue;
      }
      if (row.category === 'Other') {
        continue;
      }

      const docRef = db.collection('medicines').doc(String(row.id));
      const docSnap = await docRef.get();

      // Requirement 2: Only update docs that ALREADY exist in Firestore (unless admin restore mode is active)
      if (!docSnap.exists) {
        if (!allowCreateMissing) {
          continue;
        }
      }

      const firestoreData = docSnap.exists ? docSnap.data() : null;

      // Requirement 9: Tombstone preservation — do NOT resurrect deleted Firestore documents
      if (firestoreData?.isDeleted === true && !row.is_deleted) {
        continue;
      }

      // Requirement 2: Only apply a row if supabase.updated_at > firestore.updatedAt
      const supabaseUpdatedAt = row.updated_at ? new Date(row.updated_at).getTime() : 0;
      if (firestoreData) {
        let firestoreUpdatedAt = 0;
        if (typeof firestoreData.updatedAt === 'number') {
          firestoreUpdatedAt = firestoreData.updatedAt;
        } else if (firestoreData.updatedAt?.toMillis) {
          firestoreUpdatedAt = firestoreData.updatedAt.toMillis();
        } else if (typeof firestoreData.createdAt === 'number') {
          firestoreUpdatedAt = firestoreData.createdAt;
        } else if (firestoreData.createdAt?.toMillis) {
          firestoreUpdatedAt = firestoreData.createdAt.toMillis();
        }

        if (supabaseUpdatedAt <= firestoreUpdatedAt) {
          continue;
        }
      }

      // Requirement 2: Build update payload WITHOUT default placeholders (no 'tablet', no '', skip absent fields)
      const updatePayload: Record<string, any> = {
        id: String(row.id),
        userId: String(row.user_id),
        updatedAt: supabaseUpdatedAt || Date.now(),
      };

      if (row.name && typeof row.name === 'string' && row.name.trim().length > 0) {
        updatePayload.name = row.name.trim();
      }
      if (row.dosage != null && row.dosage !== 'N/A' && String(row.dosage).trim().length > 0) {
        updatePayload.dosage = String(row.dosage).trim();
      }
      if (row.form != null && row.form !== '' && row.form !== 'other') {
        updatePayload.form = row.form;
      }
      if (row.category != null && row.category !== 'Other' && String(row.category).trim().length > 0) {
        updatePayload.category = String(row.category).trim();
      }
      if (Array.isArray(row.categories) && row.categories.length > 0) {
        updatePayload.categories = row.categories;
      }
      if (Array.isArray(row.tags) && row.tags.length > 0) {
        updatePayload.tags = row.tags;
      }
      if (row.usage_instructions != null && typeof row.usage_instructions === 'string' && row.usage_instructions.trim().length > 0) {
        updatePayload.usageInstructions = row.usage_instructions.trim();
      }
      if (typeof row.price === 'number') {
        updatePayload.price = row.price;
      }
      if (row.barcode != null && row.barcode !== '') {
        updatePayload.barcode = row.barcode;
      }
      if (row.mfg_date != null && row.mfg_date !== '') {
        updatePayload.mfgDate = row.mfg_date;
      }
      if (row.manufacturer != null && row.manufacturer !== '') {
        updatePayload.manufacturer = row.manufacturer;
      }
      if (typeof row.taken === 'boolean') {
        updatePayload.taken = row.taken;
      }
      if (typeof row.liked === 'boolean') {
        updatePayload.liked = row.liked;
      }
      if (row.is_deleted === true) {
        updatePayload.isDeleted = true;
        if (row.deleted_at) {
          updatePayload.deletedAt = new Date(row.deleted_at).getTime();
        }
      }

      // Requirement 2: Restore batches together with quantity and expirationDate, or neither
      let parsedBatches: any[] | null = null;
      if (row.batches) {
        try {
          const parsed = typeof row.batches === 'string' ? JSON.parse(row.batches) : row.batches;
          if (Array.isArray(parsed) && parsed.length > 0) {
            parsedBatches = parsed;
          }
        } catch {
          parsedBatches = null;
        }
      }

      const hasBatches = Boolean(parsedBatches);
      const hasQuantity = typeof row.quantity === 'number';
      const hasExpiration = Boolean(row.expiration_date && /^\d{4}-\d{2}-\d{2}$/.test(row.expiration_date));

      if (hasBatches) {
        if (hasQuantity && hasExpiration) {
          updatePayload.batches = parsedBatches;
          updatePayload.quantity = row.quantity;
          updatePayload.expirationDate = row.expiration_date;
          if (typeof row.total_quantity === 'number') {
            updatePayload.totalQuantity = row.total_quantity;
          }
        } else {
          console.warn(`[PULL] Skipping batches triad for ${row.id}: quantity or expiration missing`);
        }
      } else {
        if (hasQuantity) {
          updatePayload.quantity = row.quantity;
        }
        if (typeof row.total_quantity === 'number') {
          updatePayload.totalQuantity = row.total_quantity;
        }
        if (hasExpiration) {
          updatePayload.expirationDate = row.expiration_date;
        }
      }

      if (!docSnap.exists && allowCreateMissing) {
        updatePayload.createdAt = supabaseUpdatedAt || Date.now();
      }

      bulkWriter.set(docRef, updatePayload, { merge: true });
      updatedCount++;
    }

    await bulkWriter.close();
  } catch (err: any) {
    errors.push(err.message || String(err));
  }

  return { updated: updatedCount, errors };
}

/**
 * Runs synchronization. When targetUserId is provided, strictly limits scope to caller's records.
 */
export async function runTwoWaySync(targetUserId?: string): Promise<SyncReport> {
  if (isSyncInProgress) {
    return {
      timestamp: new Date().toISOString(),
      pushedMedicines: 0,
      pushedConfigs: 0,
      pushedUsers: 0,
      pushedHistory: 0,
      errors: ['Sync already in progress']
    };
  }

  isSyncInProgress = true;
  const errors: string[] = [];
  let pushedResult = { medicines: 0, configs: 0, users: 0, history: 0 };

  try {
    console.log(`[SYNC] Starting sync (targetUserId: ${targetUserId || 'GLOBAL_CRON'})...`);
    pushedResult = await pushFirestoreToSupabase(targetUserId);
    console.log(`[SYNC] Success! Pushed: ${pushedResult.medicines} meds, ${pushedResult.configs} configs, ${pushedResult.users} users, ${pushedResult.history} history events.`);
  } catch (err: any) {
    errors.push(err.message || String(err));
    console.error('[SYNC] Exception during sync:', err);
  } finally {
    isSyncInProgress = false;
  }

  return {
    timestamp: new Date().toISOString(),
    pushedMedicines: pushedResult.medicines,
    pushedConfigs: pushedResult.configs,
    pushedUsers: pushedResult.users,
    pushedHistory: pushedResult.history,
    errors,
  };
}

/**
 * Admin-only restore endpoint handler to recreate missing Firestore documents from Supabase.
 */
export async function restoreMissingFromSupabase(targetUserId?: string): Promise<{ restored: number; errors: string[] }> {
  const result = await pullSupabaseToFirebase(targetUserId, true);
  return { restored: result.updated, errors: result.errors };
}
