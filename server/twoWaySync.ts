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
 * Only pushes docs with updatedAt/createdAt/timestamp > persistent lastSyncTime (from Supabase sync_state table).
 */
export async function pushFirestoreToSupabase(): Promise<{ 
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
  const persistentLastSync = await getPersistentSyncState('firestore_to_supabase');

  try {
    const db = getAdminDb();

    // 1. Medicines Push (Incremental: only docs with updatedAt > persistentLastSync)
    try {
      let query = db.collection('medicines');
      const medSnap = await query.get();
      const medsToPush: any[] = [];

      medSnap.forEach(d => {
        const data = d.data();
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
        const result = await backupMedicinesBatchToSupabase(medsToPush);
        medCount = result.success;
      }
      // Propagate deletions: verify active medicines and reconcile soft-deletes
      try {
        const activeFirestoreIds = new Set(medSnap.docs.filter(d => !d.data()?.isDeleted).map(d => d.id));
        const supabaseActiveRows = await fetchMedicinesFromSupabase();
        const toDeleteInSupabase: string[] = [];
        for (const row of supabaseActiveRows) {
          if (!row.is_deleted && !activeFirestoreIds.has(row.id)) {
            toDeleteInSupabase.push(row.id);
          }
        }
        if (toDeleteInSupabase.length > 0) {
          const client = getSupabaseClient();
          if (client) {
            await client
              .from('medicines')
              .update({ is_deleted: true, deleted_at: new Date().toISOString() })
              .in('id', toDeleteInSupabase);
          }
        }
      } catch (delErr: any) {
        console.warn('[FIRESTORE->SUPABASE] Notice propagating deletions:', delErr.message);
      }
    } catch (err: any) {
      console.warn('[FIRESTORE->SUPABASE] Error reading/pushing medicines:', err.message);
    }

    // 2. User Configs Push (read from users/{uid}/settings/appSettings via collectionGroup('settings'))
    try {
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
    } catch (err: any) {
      console.warn('[FIRESTORE->SUPABASE] Error pushing configs via collectionGroup:', err.message);
    }

    // 3. User Accounts & Profiles Push (Paginated listUsers with nextPageToken)
    try {
      const userProfiles: any[] = [];

      if (hasServiceAccountConfigured()) {
        try {
          const auth = getAuth(getAdminApp());
          let pageToken: string | undefined = undefined;

          // Paginate listUsers through all pages
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

      historySnap.forEach(d => {
        const data = d.data();
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
            userId: data.userId || null,
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
      console.warn('[FIRESTORE->SUPABASE] Error syncing collectionGroup history:', err.message);
    }

    // Persist new sync state to Supabase table 'sync_state'
    await setPersistentSyncState('firestore_to_supabase', currentSyncStart);
  } catch (err: any) {
    console.warn('[FIRESTORE->SUPABASE] Global push exception:', err.message);
  }

  return { medicines: medCount, configs: configCount, users: userCount, history: historyCount };
}

/**
 * Strict helper to pull medicines from Supabase to Firebase IF invoked directly.
 * Enforces strict row schema validation, verifies user existence in Auth, and avoids placeholders.
 */
export async function pullSupabaseToFirebase(): Promise<{ updated: number; errors: string[] }> {
  if (!isSupabaseConfigured()) {
    return { updated: 0, errors: ['Supabase not configured'] };
  }

  const errors: string[] = [];
  let updatedCount = 0;

  try {
    const db = getAdminDb();
    const auth = getAuth(getAdminApp());
    const supabaseMeds = await fetchMedicinesFromSupabase();
    if (!Array.isArray(supabaseMeds) || supabaseMeds.length === 0) {
      return { updated: 0, errors: [] };
    }

    const bulkWriter = db.bulkWriter();
    bulkWriter.onWriteError((err: any) => {
      errors.push(`BulkWriter error: ${err.message || String(err)}`);
      return false; // do not retry failed writes
    });

    for (const row of supabaseMeds) {
      // 1. Strict schema validation
      if (!row.id || typeof row.id !== 'string' || !row.user_id || typeof row.user_id !== 'string') {
        continue;
      }
      if (!row.name || typeof row.name !== 'string' || row.name.trim().length === 0) {
        continue;
      }
      // Never allow placeholder defaults like 'N/A', 'Other' or today's date placeholder
      if (!row.expiration_date || !/^\d{4}-\d{2}-\d{2}$/.test(row.expiration_date)) {
        continue;
      }
      if (!row.dosage || row.dosage === 'N/A') {
        continue;
      }
      if (row.category === 'Other') {
        continue;
      }

      // 2. Verify user exists in Firebase Auth
      try {
        await auth.getUser(row.user_id);
      } catch {
        // User does not exist in Firebase Auth -> reject
        continue;
      }

      const docRef = db.collection('medicines').doc(String(row.id));
      const supabaseUpdatedAt = row.updated_at ? new Date(row.updated_at).getTime() : Date.now();

      const updatePayload: Record<string, any> = {
        id: String(row.id),
        userId: String(row.user_id),
        name: String(row.name).trim(),
        dosage: String(row.dosage).trim(),
        form: row.form || 'tablet',
        expirationDate: row.expiration_date,
        quantity: typeof row.quantity === 'number' ? row.quantity : 0,
        totalQuantity: typeof row.total_quantity === 'number' ? row.total_quantity : (row.quantity || 0),
        category: String(row.category).trim(),
        categories: Array.isArray(row.categories) ? row.categories : [row.category],
        tags: Array.isArray(row.tags) ? row.tags : [],
        usageInstructions: row.usage_instructions || '',
        price: typeof row.price === 'number' ? row.price : null,
        barcode: row.barcode || null,
        mfgDate: row.mfg_date || null,
        manufacturer: row.manufacturer || null,
        taken: Boolean(row.taken),
        liked: Boolean(row.liked),
        isDeleted: Boolean(row.is_deleted),
        updatedAt: supabaseUpdatedAt,
      };

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
 * Runs ONE-WAY synchronization from Firestore to Supabase.
 * Pull from Supabase is removed from standard sync.
 */
export async function runTwoWaySync(): Promise<SyncReport> {
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
    console.log('[SYNC] Starting ONE-WAY sync (Firestore -> Supabase)...');
    
    // ONE-WAY: Push Firestore to Supabase incrementally
    pushedResult = await pushFirestoreToSupabase();

    console.log(`[SYNC] Success! Pushed to Supabase: ${pushedResult.medicines} medicines, ${pushedResult.configs} configs, ${pushedResult.users} users, ${pushedResult.history} history events.`);
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

// Scheduled setInterval removed in favor of authenticated POST /api/cron/sync endpoint
