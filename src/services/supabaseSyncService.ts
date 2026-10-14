import { User } from 'firebase/auth';
import { Medicine } from '../types';
import { getApiUrl, getDirectBackendUrl } from '../utils/apiConfig';
import { getAuthHeader } from '../firebase';

let debounceTimer: any = null;
let lastSyncedChecksum = '';

/**
 * Computes a lightweight checksum of medicines array to skip redundant sync network calls.
 */
function computeMedsChecksum(medicines: Medicine[]): string {
  if (!medicines || medicines.length === 0) return 'empty';
  return `${medicines.length}:${medicines.map(m => `${m.id}-${m.updatedAt || m.quantity}-${m.taken}`).slice(0, 15).join('|')}`;
}

/**
 * Checks backend Supabase connection status.
 */
export async function getSupabaseBackupStatus(): Promise<{ configured: boolean; ok?: boolean; message?: string }> {
  try {
    const res = await fetch(getApiUrl('/api/backup/supabase/status'));
    if (res.ok) {
      return await res.json();
    }
    // Fallback direct backend call on native/cross-origin
    const directRes = await fetch(getDirectBackendUrl('/api/backup/supabase/status'));
    if (directRes.ok) {
      return await directRes.json();
    }
  } catch (e) {
    console.warn('[SUPABASE SYNC] Status check error:', e);
  }
  return { configured: false, message: 'Could not connect to backup endpoint' };
}

/**
 * Syncs an entire batch of medicines to the Cloud Run server -> Supabase backup.
 */
export async function syncMedicinesToSupabase(medicines: Medicine[], user: User): Promise<boolean> {
  if (!user || !Array.isArray(medicines)) return false;

  try {
    const authHeader = await getAuthHeader();
    const payload = JSON.stringify({ medicines, userId: user.uid });
    const headers = {
      'Content-Type': 'application/json',
      ...authHeader,
    };

    let response = await fetch(getApiUrl('/api/backup/supabase/sync-medicines'), {
      method: 'POST',
      headers,
      body: payload,
    });

    if (!response.ok && response.status === 404) {
      response = await fetch(getDirectBackendUrl('/api/backup/supabase/sync-medicines'), {
        method: 'POST',
        headers,
        body: payload,
      });
    }

    if (response.ok) {
      lastSyncedChecksum = computeMedsChecksum(medicines);
      return true;
    }
  } catch (err) {
    console.warn('[SUPABASE SYNC] Failed to backup medicines to Supabase:', err);
  }
  return false;
}

/**
 * Automatically debounces sync to Supabase so typing, filtering, or rapid changes
 * don't overwhelm the network, but guarantee any medicine update is uploaded within ~1.2s.
 */
export function triggerDebouncedMedicinesSync(medicines: Medicine[], user: User, delayMs = 1200): void {
  if (!user || !Array.isArray(medicines)) return;

  const currentChecksum = computeMedsChecksum(medicines);
  if (currentChecksum === lastSyncedChecksum) {
    return;
  }

  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    syncMedicinesToSupabase(medicines, user).catch(() => {});
  }, delayMs);
}

/**
 * Immediately uploads a single newly added or edited medicine to Supabase.
 */
export async function syncSingleMedicineToSupabase(medicine: Medicine, user: User): Promise<boolean> {
  if (!user || !medicine?.id) return false;

  try {
    const authHeader = await getAuthHeader();
    const payload = JSON.stringify({ medicine, userId: user.uid });
    const headers = {
      'Content-Type': 'application/json',
      ...authHeader,
    };

    let response = await fetch(getApiUrl('/api/backup/supabase/sync-medicine'), {
      method: 'POST',
      headers,
      body: payload,
    });

    if (!response.ok && response.status === 404) {
      response = await fetch(getDirectBackendUrl('/api/backup/supabase/sync-medicine'), {
        method: 'POST',
        headers,
        body: payload,
      });
    }

    return response.ok;
  } catch (err) {
    console.warn(`[SUPABASE SYNC] Failed to backup single medicine ${medicine.id}:`, err);
    return false;
  }
}

/**
 * Syncs user configuration and settings (alert thresholds, notifications, color theme) to Supabase.
 */
export async function syncConfigToSupabase(config: any, user: User): Promise<boolean> {
  if (!user || !config) return false;

  try {
    const authHeader = await getAuthHeader();
    const payload = JSON.stringify({ config, userId: user.uid });
    const headers = {
      'Content-Type': 'application/json',
      ...authHeader,
    };

    let response = await fetch(getApiUrl('/api/backup/supabase/sync-config'), {
      method: 'POST',
      headers,
      body: payload,
    });

    if (!response.ok && response.status === 404) {
      response = await fetch(getDirectBackendUrl('/api/backup/supabase/sync-config'), {
        method: 'POST',
        headers,
        body: payload,
      });
    }

    return response.ok;
  } catch (err) {
    console.warn('[SUPABASE SYNC] Failed to backup user config to Supabase:', err);
    return false;
  }
}

/**
 * Deletes a medicine from Supabase when removed by the user.
 */
export async function deleteMedicineFromSupabase(medicineId: string, user: User): Promise<boolean> {
  if (!user || !medicineId) return false;

  try {
    const authHeader = await getAuthHeader();
    const payload = JSON.stringify({ medicineId, userId: user.uid });
    const headers = {
      'Content-Type': 'application/json',
      ...authHeader,
    };

    let response = await fetch(getApiUrl('/api/backup/supabase/delete-medicine'), {
      method: 'POST',
      headers,
      body: payload,
    });

    if (!response.ok && response.status === 404) {
      response = await fetch(getDirectBackendUrl('/api/backup/supabase/delete-medicine'), {
        method: 'POST',
        headers,
        body: payload,
      });
    }

    return response.ok;
  } catch (err) {
    console.warn(`[SUPABASE SYNC] Failed to delete medicine ${medicineId} in Supabase:`, err);
    return false;
  }
}

/**
 * Deletes multiple medicines from Supabase by IDs.
 */
export async function deleteMedicinesBatchFromSupabase(medicineIds: string[], user: User): Promise<boolean> {
  if (!user || !Array.isArray(medicineIds) || medicineIds.length === 0) return false;

  try {
    const authHeader = await getAuthHeader();
    const payload = JSON.stringify({ medicineIds, userId: user.uid });
    const headers = {
      'Content-Type': 'application/json',
      ...authHeader,
    };

    let response = await fetch(getApiUrl('/api/backup/supabase/delete-medicines-batch'), {
      method: 'POST',
      headers,
      body: payload,
    });

    if (!response.ok && response.status === 404) {
      response = await fetch(getDirectBackendUrl('/api/backup/supabase/delete-medicines-batch'), {
        method: 'POST',
        headers,
        body: payload,
      });
    }

    return response.ok;
  } catch (err) {
    console.warn('[SUPABASE SYNC] Failed to delete medicines batch in Supabase:', err);
    return false;
  }
}

/**
 * Backs up an audit history entry to Supabase.
 */
export async function syncHistoryToSupabase(history: any, user: User): Promise<boolean> {
  if (!user || !history) return false;

  try {
    const authHeader = await getAuthHeader();
    const payload = JSON.stringify({ history, userId: user.uid });
    const headers = {
      'Content-Type': 'application/json',
      ...authHeader,
    };

    const response = await fetch(getApiUrl('/api/backup/supabase/sync-history'), {
      method: 'POST',
      headers,
      body: payload,
    });

    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Triggers a bidirectional sync (Firebase ⇄ Supabase) on demand.
 */
export async function triggerFullTwoWaySync(): Promise<{ success: boolean; pushedMedicines?: number; pulledFromSupabase?: number; message?: string }> {
  try {
    const authHeader = await getAuthHeader();
    let res = await fetch(getApiUrl('/api/backup/two-way-sync'), {
      method: 'POST',
      headers: { ...authHeader },
    });

    if (!res.ok && res.status === 404) {
      res = await fetch(getDirectBackendUrl('/api/backup/two-way-sync'), {
        method: 'POST',
        headers: { ...authHeader },
      });
    }

    if (res.ok) {
      const data = await res.json();
      return { success: true, ...data };
    }
  } catch (err: any) {
    console.warn('[SUPABASE SYNC] Two-way sync error:', err);
  }
  return { success: false, message: 'Could not complete two-way sync' };
}

/**
 * Pulls manual edits or new rows made directly in Supabase into Firebase Firestore.
 */
export async function triggerPullFromSupabase(): Promise<{ success: boolean; updated?: number }> {
  try {
    const authHeader = await getAuthHeader();
    let res = await fetch(getApiUrl('/api/backup/pull-from-supabase'), {
      method: 'POST',
      headers: { ...authHeader },
    });

    if (!res.ok && res.status === 404) {
      res = await fetch(getDirectBackendUrl('/api/backup/pull-from-supabase'), {
        method: 'POST',
        headers: { ...authHeader },
      });
    }

    if (res.ok) {
      return await res.json();
    }
  } catch (err: any) {
    console.warn('[SUPABASE SYNC] Pull from Supabase error:', err);
  }
  return { success: false };
}

