import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import firebaseConfig from '../firebase-applet-config.json' with { type: 'json' };
import { 
  backupMedicinesBatchToSupabase, 
  backupUserConfigToSupabase, 
  backupUsersBatchToSupabase, 
  fetchMedicinesFromSupabase,
  isSupabaseConfigured 
} from './supabaseBackup.ts';
import { getAdminApp, hasServiceAccountConfigured } from './firebaseAdmin.ts';

let lastSyncTime: number = Date.now();
let isSyncInProgress = false;

function getAdminDb() {
  const adminApp = getAdminApp();
  return getFirestore(adminApp, firebaseConfig.firestoreDatabaseId);
}

export interface SyncReport {
  timestamp: string;
  pushedMedicines: number;
  pushedConfigs: number;
  pushedUsers: number;
  pulledFromSupabase: number;
  errors: string[];
}

/**
 * Pushes all Firestore data (medicines, configs, user profiles) to Supabase.
 */
export async function pushFirebaseToSupabase(): Promise<{ medicines: number; configs: number; users: number }> {
  if (!isSupabaseConfigured()) {
    return { medicines: 0, configs: 0, users: 0 };
  }

  let medCount = 0;
  let configCount = 0;
  let userCount = 0;

  try {
    const db = getAdminDb();

    // 1. Medicines Push
    try {
      const medSnap = await db.collection('medicines').get();
      const meds: any[] = [];
      medSnap.forEach(d => {
        const data = d.data();
        meds.push({ id: d.id, ...data });
      });
      if (meds.length > 0) {
        const result = await backupMedicinesBatchToSupabase(meds);
        medCount = result.success;
      }
    } catch (err: any) {
      console.warn('[TWO-WAY SYNC] Error reading/pushing medicines to Supabase:', err.message);
    }

    // 2. User Configs Push
    try {
      const configSnap = await db.collection('userConfigs').get();
      for (const d of configSnap.docs) {
        const configData = { userId: d.id, ...d.data() };
        const ok = await backupUserConfigToSupabase(configData);
        if (ok) configCount++;
      }
    } catch (err: any) {
      console.warn('[TWO-WAY SYNC] Error pushing configs to Supabase:', err.message);
    }

    // 3. User Accounts & Profiles Push
    try {
      const userProfiles: any[] = [];

      // Query Firebase Auth registered users if service account available
      if (hasServiceAccountConfigured()) {
        try {
          const auth = getAuth(getAdminApp());
          const userList = await auth.listUsers(1000);
          userList.users.forEach(u => {
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
          });
        } catch (authErr: any) {
          console.warn('[TWO-WAY SYNC] Admin listUsers notice:', authErr.message);
        }
      }

      // Also enrich with Firestore userConfigs
      const configSnap = await db.collection('userConfigs').get();
      configSnap.forEach(d => {
        const data = d.data();
        if (!userProfiles.some(u => u.uid === d.id)) {
          userProfiles.push({
            uid: d.id,
            email: data.email || null,
            displayName: data.displayName || null,
            photoURL: data.photoURL || null,
            createdAt: data.createdAt || Date.now(),
          });
        }
      });

      if (userProfiles.length > 0) {
        const res = await backupUsersBatchToSupabase(userProfiles);
        userCount = res.success;
      }
    } catch (err: any) {
      console.warn('[TWO-WAY SYNC] Error pushing user accounts to Supabase:', err.message);
    }
  } catch (err: any) {
    console.warn('[TWO-WAY SYNC] Global push exception:', err.message);
  }

  return { medicines: medCount, configs: configCount, users: userCount };
}

/**
 * Pulls changes made in Supabase back into Firebase Firestore.
 * If you edit a medicine in Supabase (e.g. quantity, dosage, category),
 * this function updates Firestore so user devices receive the update live!
 */
export async function pullSupabaseToFirebase(): Promise<{ updated: number; errors: string[] }> {
  if (!isSupabaseConfigured()) {
    return { updated: 0, errors: ['Supabase not configured'] };
  }

  const errors: string[] = [];
  let updatedCount = 0;

  try {
    const db = getAdminDb();
    const supabaseMeds = await fetchMedicinesFromSupabase();
    if (!Array.isArray(supabaseMeds) || supabaseMeds.length === 0) {
      return { updated: 0, errors: [] };
    }

    for (const row of supabaseMeds) {
      if (!row.id || !row.user_id) continue;

      try {
        const docRef = db.collection('medicines').doc(String(row.id));
        const firestoreSnap = await docRef.get();

        const supabaseUpdatedAt = row.updated_at ? new Date(row.updated_at).getTime() : 0;
        let shouldUpdateFirestore = false;

        if (!firestoreSnap.exists) {
          // Record exists in Supabase but not in Firestore -> restore it to Firestore!
          shouldUpdateFirestore = true;
        } else {
          const fsData = firestoreSnap.data() || {};
          let fsUpdatedAt = 0;
          if (typeof fsData.updatedAt === 'number') {
            fsUpdatedAt = fsData.updatedAt;
          } else if (fsData.updatedAt && fsData.updatedAt.toMillis) {
            fsUpdatedAt = fsData.updatedAt.toMillis();
          } else if (typeof fsData.createdAt === 'number') {
            fsUpdatedAt = fsData.createdAt;
          } else if (fsData.createdAt && fsData.createdAt.toMillis) {
            fsUpdatedAt = fsData.createdAt.toMillis();
          }

          // If Supabase was modified more recently than Firestore (with 2000ms clock skew grace)
          if (supabaseUpdatedAt > (fsUpdatedAt + 2000)) {
            shouldUpdateFirestore = true;
          }
        }

        if (shouldUpdateFirestore) {
          const updatePayload: Record<string, any> = {
            id: String(row.id),
            userId: String(row.user_id),
            name: String(row.name || 'Unnamed'),
            dosage: row.dosage || 'N/A',
            form: row.form || 'other',
            expirationDate: row.expiration_date || new Date().toISOString().split('T')[0],
            quantity: typeof row.quantity === 'number' ? row.quantity : 0,
            totalQuantity: typeof row.total_quantity === 'number' ? row.total_quantity : (row.quantity || 0),
            category: row.category || 'Other',
            categories: Array.isArray(row.categories) ? row.categories : (row.category ? [row.category] : []),
            tags: Array.isArray(row.tags) ? row.tags : [],
            usageInstructions: row.usage_instructions || '',
            price: row.price,
            barcode: row.barcode || null,
            mfgDate: row.mfg_date || null,
            manufacturer: row.manufacturer || null,
            taken: Boolean(row.taken),
            liked: Boolean(row.liked),
            isDeleted: Boolean(row.is_deleted),
            updatedAt: supabaseUpdatedAt || Date.now(),
          };

          if (row.batches) {
            try {
              updatePayload.batches = typeof row.batches === 'string' ? JSON.parse(row.batches) : row.batches;
            } catch {
              // Ignore batch parse error
            }
          }

          await docRef.set(updatePayload, { merge: true });
          updatedCount++;
        }
      } catch (docErr: any) {
        errors.push(`Doc ${row.id}: ${docErr.message}`);
      }
    }
  } catch (err: any) {
    errors.push(err.message || String(err));
  }

  return { updated: updatedCount, errors };
}

/**
 * Runs a complete two-way synchronization between Firebase and Supabase.
 */
export async function runTwoWaySync(): Promise<SyncReport> {
  if (isSyncInProgress) {
    return {
      timestamp: new Date().toISOString(),
      pushedMedicines: 0,
      pushedConfigs: 0,
      pushedUsers: 0,
      pulledFromSupabase: 0,
      errors: ['Sync already in progress']
    };
  }

  isSyncInProgress = true;
  const errors: string[] = [];
  let pushedResult = { medicines: 0, configs: 0, users: 0 };
  let pulledResult = { updated: 0, errors: [] as string[] };

  try {
    console.log('[TWO-WAY SYNC] Starting bidirectional sync (Firebase ⇄ Supabase)...');
    
    // Step 1: Pull changes made in Supabase -> Firebase
    pulledResult = await pullSupabaseToFirebase();
    if (pulledResult.errors.length > 0) {
      errors.push(...pulledResult.errors);
    }

    // Step 2: Push changes from Firebase -> Supabase
    pushedResult = await pushFirebaseToSupabase();

    lastSyncTime = Date.now();
    console.log(`[TWO-WAY SYNC] Success! Pulled from Supabase: ${pulledResult.updated} items. Pushed to Supabase: ${pushedResult.medicines} medicines, ${pushedResult.users} users.`);
  } catch (err: any) {
    errors.push(err.message || String(err));
    console.error('[TWO-WAY SYNC] Exception during sync:', err);
  } finally {
    isSyncInProgress = false;
  }

  return {
    timestamp: new Date(lastSyncTime).toISOString(),
    pushedMedicines: pushedResult.medicines,
    pushedConfigs: pushedResult.configs,
    pushedUsers: pushedResult.users,
    pulledFromSupabase: pulledResult.updated,
    errors,
  };
}

/**
 * Starts the hourly automated two-way synchronization cron worker on the Render server.
 */
export function startScheduledTwoWaySync(): void {
  // Sync every 1 hour (3600000 ms)
  const ONE_HOUR = 60 * 60 * 1000;

  // Initial sync after 15 seconds of server startup
  setTimeout(() => {
    runTwoWaySync().catch(err => console.warn('[SCHEDULED TWO-WAY SYNC] Initial run notice:', err));
  }, 15 * 1000);

  // Recurring hourly sync
  setInterval(() => {
    runTwoWaySync().catch(err => console.warn('[SCHEDULED TWO-WAY SYNC] Hourly run notice:', err));
  }, ONE_HOUR);

  console.log('[SCHEDULED TWO-WAY SYNC] Automated background worker registered. Interval: Every 1 hour.');
}

export function getLastSyncTime(): string {
  return new Date(lastSyncTime).toISOString();
}
