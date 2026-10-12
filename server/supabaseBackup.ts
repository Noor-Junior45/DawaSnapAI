import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Environment variables configuration: strictly server-only SUPABASE_SERVICE_ROLE_KEY (no anon key on server)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabaseClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (supabaseClient) return supabaseClient;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return null;
  }

  try {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    return supabaseClient;
  } catch (error) {
    console.warn('[SUPABASE BACKUP] Failed to initialize Supabase client:', error);
    return null;
  }
}

export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

/**
 * Tests connection to the Supabase PostgreSQL database using the service role key.
 */
export async function testSupabaseConnection(): Promise<{ ok: boolean; message: string }> {
  const client = getSupabaseClient();
  if (!client) {
    return {
      ok: false,
      message: 'Supabase credentials not configured in environment variables. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.',
    };
  }

  try {
    const { error } = await client.from('medicines').select('id').limit(1);
    if (error) {
      return {
        ok: false,
        message: `Connected to Supabase, but query returned error: ${error.message}. (Ensure tables are created in Supabase).`,
      };
    }
    return {
      ok: true,
      message: 'Successfully connected to Supabase PostgreSQL database using service role.',
    };
  } catch (err: any) {
    return {
      ok: false,
      message: `Failed to connect to Supabase: ${err?.message || err}`,
    };
  }
}

/**
 * Parses timestamps from various Firestore representations (number ms, Timestamp object, or ISO string)
 */
export function getIsoDateFromSource(val: any): string | null {
  if (!val) return null;
  if (typeof val === 'number') {
    return new Date(val).toISOString();
  }
  if (typeof val === 'string') {
    const parsed = Date.parse(val);
    return !isNaN(parsed) ? new Date(parsed).toISOString() : null;
  }
  if (val && typeof val.toMillis === 'function') {
    return new Date(val.toMillis()).toISOString();
  }
  if (val && typeof val.toDate === 'function') {
    return val.toDate().toISOString();
  }
  return null;
}

/**
 * Formats a Firestore medicine document into a clean PostgreSQL row.
 * Strictly stores the source updatedAt in Supabase updated_at (convert from ms), NEVER sync time.
 */
export function formatMedicineForPostgres(m: any): Record<string, any> {
  const sourceUpdatedAt = getIsoDateFromSource(m.updatedAt) || getIsoDateFromSource(m.createdAt) || new Date(0).toISOString();
  const sourceDeletedAt = m.deletedAt ? (getIsoDateFromSource(m.deletedAt) || new Date(m.deletedAt).toISOString()) : null;

  return {
    id: String(m.id || ''),
    user_id: String(m.userId || ''),
    name: String(m.name || 'Unnamed Medicine'),
    dosage: m.dosage || null,
    form: m.form || 'other',
    expiration_date: m.expirationDate || null,
    quantity: typeof m.quantity === 'number' ? m.quantity : 0,
    total_quantity: typeof m.totalQuantity === 'number' ? m.totalQuantity : (m.quantity || 0),
    category: m.category || null,
    categories: Array.isArray(m.categories) ? m.categories : [],
    tags: Array.isArray(m.tags) ? m.tags : [],
    usage_instructions: m.usageInstructions || null,
    price: typeof m.price === 'number' ? m.price : (parseFloat(m.price) || null),
    barcode: m.barcode || null,
    mfg_date: m.mfgDate || null,
    manufacturer: m.manufacturer || null,
    taken: Boolean(m.taken),
    liked: Boolean(m.liked),
    is_deleted: Boolean(m.isDeleted),
    deleted_at: sourceDeletedAt,
    batches: m.batches ? JSON.stringify(m.batches) : null,
    raw_payload: JSON.stringify(m),
    updated_at: sourceUpdatedAt, // Converted from source updatedAt, not current sync time!
  };
}

/**
 * Upserts a single medicine into the Supabase 'medicines' table as a backup.
 */
export async function backupMedicineToSupabase(medicine: any): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client || !medicine?.id) return false;

  try {
    const row = formatMedicineForPostgres(medicine);
    const { error } = await client
      .from('medicines')
      .upsert(row, { onConflict: 'id' });

    if (error) {
      console.warn(`[SUPABASE BACKUP] Error upserting medicine ${medicine.id}:`, error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[SUPABASE BACKUP] Exception upserting medicine:`, err);
    return false;
  }
}

/**
 * Upserts a batch of medicines into Supabase in chunks.
 */
export async function backupMedicinesBatchToSupabase(medicines: any[]): Promise<{ success: number; failed: number }> {
  const client = getSupabaseClient();
  if (!client || !Array.isArray(medicines) || medicines.length === 0) {
    return { success: 0, failed: medicines?.length || 0 };
  }

  const rows = medicines.filter(m => m && m.id).map(formatMedicineForPostgres);
  const CHUNK_SIZE = 50;
  let success = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    try {
      const { error } = await client
        .from('medicines')
        .upsert(chunk, { onConflict: 'id' });

      if (error) {
        console.warn(`[SUPABASE BACKUP] Chunk upsert error:`, error.message);
        failed += chunk.length;
      } else {
        success += chunk.length;
      }
    } catch (err) {
      console.warn(`[SUPABASE BACKUP] Chunk exception:`, err);
      failed += chunk.length;
    }
  }

  return { success, failed };
}

/**
 * Upserts a user configuration record into the 'user_configs' backup table.
 */
export async function backupUserConfigToSupabase(config: any): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client || !config?.userId) return false;

  try {
    const sourceUpdatedAt = getIsoDateFromSource(config.updatedAt) || new Date().toISOString();
    const row = {
      user_id: String(config.userId),
      email: config.email || null,
      email_notifications_enabled: Boolean(config.emailNotificationsEnabled),
      browser_notifications_enabled: Boolean(config.browserNotificationsEnabled),
      alert_threshold: typeof config.alertThreshold === 'number' ? config.alertThreshold : 30,
      accent_color: config.accentColor || '#0f9d58',
      sort_order: config.sortOrder || 'default',
      low_quantity_threshold: typeof config.lowQuantityThreshold === 'number' ? config.lowQuantityThreshold : 5,
      theme: config.theme || 'system',
      updated_at: sourceUpdatedAt,
    };

    const { error } = await client
      .from('user_configs')
      .upsert(row, { onConflict: 'user_id' });

    if (error) {
      console.warn(`[SUPABASE BACKUP] User config upsert error:`, error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[SUPABASE BACKUP] User config exception:`, err);
    return false;
  }
}

/**
 * Permanently removes a single medicine from Supabase.
 */
export async function deleteMedicineFromSupabase(medicineId: string, userId?: string): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client || !medicineId) return false;

  try {
    let query = client.from('medicines').delete().eq('id', medicineId);
    if (userId) {
      query = query.eq('user_id', userId);
    }
    const { error } = await query;
    if (error) {
      console.warn(`[SUPABASE BACKUP] Error deleting medicine ${medicineId}:`, error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[SUPABASE BACKUP] Exception deleting medicine:`, err);
    return false;
  }
}

/**
 * Deletes a batch of medicines from Supabase by their IDs.
 */
export async function deleteMedicinesBatchFromSupabase(medicineIds: string[], userId?: string): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client || !Array.isArray(medicineIds) || medicineIds.length === 0) return false;

  try {
    let query = client.from('medicines').delete().in('id', medicineIds);
    if (userId) {
      query = query.eq('user_id', userId);
    }
    const { error } = await query;
    if (error) {
      console.warn(`[SUPABASE BACKUP] Error deleting medicines batch:`, error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[SUPABASE BACKUP] Exception deleting batch:`, err);
    return false;
  }
}

/**
 * Backs up a medicine audit history event to Supabase.
 */
export async function backupMedicineHistoryToSupabase(history: any): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client || !history?.id) return false;

  try {
    const row = {
      id: String(history.id),
      medicine_id: String(history.medicineId || history.medId || ''),
      user_id: history.userId ? String(history.userId) : null,
      action: history.actionType || history.action || 'EDIT',
      details: history.details || null,
      timestamp: history.timestamp ? new Date(history.timestamp).toISOString() : new Date().toISOString(),
      raw_payload: JSON.stringify(history)
    };

    const { error } = await client.from('medicine_history').upsert(row, { onConflict: 'id' });
    if (error) {
      if (error.code !== 'PGRST205') {
        console.warn(`[SUPABASE BACKUP] Medicine history error:`, error.message);
      }
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Batch upserts medicine history records into Supabase in chunks.
 */
export async function backupMedicineHistoryBatchToSupabase(items: any[]): Promise<{ success: number; failed: number }> {
  const client = getSupabaseClient();
  if (!client || !Array.isArray(items) || items.length === 0) {
    return { success: 0, failed: 0 };
  }

  const rows = items.filter(h => h && h.id).map(history => ({
    id: String(history.id),
    medicine_id: String(history.medicineId || history.medId || ''),
    user_id: history.userId ? String(history.userId) : null,
    action: history.actionType || history.action || 'EDIT',
    details: history.details || null,
    timestamp: history.timestamp ? new Date(history.timestamp).toISOString() : new Date().toISOString(),
    raw_payload: JSON.stringify(history)
  }));

  const CHUNK_SIZE = 50;
  let success = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    try {
      const { error } = await client
        .from('medicine_history')
        .upsert(chunk, { onConflict: 'id' });

      if (error) {
        if (error.code !== 'PGRST205') {
          console.warn('[SUPABASE BACKUP] Medicine history chunk error:', error.message);
        }
        failed += chunk.length;
      } else {
        success += chunk.length;
      }
    } catch {
      failed += chunk.length;
    }
  }

  return { success, failed };
}

/**
 * Purges all records for a user from Supabase.
 */
export async function deleteUserAllDataFromSupabase(userId: string): Promise<void> {
  const client = getSupabaseClient();
  if (!client || !userId) return;

  try {
    await Promise.allSettled([
      client.from('medicines').delete().eq('user_id', userId),
      client.from('user_configs').delete().eq('user_id', userId),
      client.from('medicine_history').delete().eq('user_id', userId)
    ]);
    console.log(`[SUPABASE BACKUP] Successfully purged all SQL backup records for user: ${userId}`);
  } catch (err) {
    console.warn(`[SUPABASE BACKUP] Exception purging user data for ${userId}:`, err);
  }
}

/**
 * Fetches medicines from Supabase with pagination (range/limit loop).
 */
export async function fetchMedicinesFromSupabase(sinceIso?: string): Promise<any[]> {
  const client = getSupabaseClient();
  if (!client) return [];

  const allRows: any[] = [];
  const PAGE_SIZE = 500;
  let offset = 0;
  let hasMore = true;

  try {
    while (hasMore) {
      let query = client.from('medicines').select('*').range(offset, offset + PAGE_SIZE - 1);
      if (sinceIso) {
        query = query.gte('updated_at', sinceIso);
      }
      const { data, error } = await query;
      if (error) {
        console.warn('[SUPABASE BACKUP] Error fetching medicines:', error.message);
        break;
      }
      if (!data || data.length === 0) {
        hasMore = false;
      } else {
        allRows.push(...data);
        if (data.length < PAGE_SIZE) {
          hasMore = false;
        } else {
          offset += PAGE_SIZE;
        }
      }
    }
    return allRows;
  } catch (err) {
    console.warn('[SUPABASE BACKUP] Exception fetching medicines from Supabase:', err);
    return [];
  }
}

/**
 * Backs up user accounts and profiles into the Supabase 'users' table.
 */
export async function backupUsersBatchToSupabase(users: any[]): Promise<{ success: number; failed: number }> {
  const client = getSupabaseClient();
  if (!client || !Array.isArray(users) || users.length === 0) {
    return { success: 0, failed: 0 };
  }

  const rows = users.map(u => ({
    user_id: String(u.uid || u.userId || u.id),
    email: u.email || null,
    display_name: u.displayName || u.name || null,
    photo_url: u.photoURL || u.photoUrl || null,
    phone_number: u.phoneNumber || null,
    email_verified: Boolean(u.emailVerified),
    disabled: Boolean(u.disabled),
    provider_ids: Array.isArray(u.providerData) 
      ? u.providerData.map((p: any) => p.providerId) 
      : (Array.isArray(u.providerIds) ? u.providerIds : []),
    last_sign_in_time: u.metadata?.lastSignInTime 
      ? new Date(u.metadata.lastSignInTime).toISOString() 
      : (u.lastSignInTime ? new Date(u.lastSignInTime).toISOString() : null),
    created_at: u.metadata?.creationTime 
      ? new Date(u.metadata.creationTime).toISOString() 
      : (u.createdAt ? new Date(u.createdAt).toISOString() : new Date().toISOString()),
    updated_at: new Date().toISOString(),
    metadata: JSON.stringify(u.customClaims || u.metadata || {}),
  }));

  try {
    const { error } = await client.from('users').upsert(rows, { onConflict: 'user_id' });
    if (error) {
      if (error.code !== 'PGRST205') {
        console.warn('[SUPABASE BACKUP] Users upsert error:', error.message);
      }
      return { success: 0, failed: rows.length };
    }
    return { success: rows.length, failed: 0 };
  } catch (err) {
    console.warn('[SUPABASE BACKUP] Exception upserting users to Supabase:', err);
    return { success: 0, failed: rows.length };
  }
}

/**
 * Gets persistent last sync time from Supabase table 'sync_state'.
 */
export async function getPersistentSyncState(key: string): Promise<number> {
  const client = getSupabaseClient();
  if (!client) return 0;

  try {
    const { data, error } = await client
      .from('sync_state')
      .select('last_sync_time')
      .eq('key', key)
      .single();

    if (error || !data) {
      return 0;
    }
    return typeof data.last_sync_time === 'number' ? data.last_sync_time : Number(data.last_sync_time) || 0;
  } catch {
    return 0;
  }
}

/**
 * Stores persistent last sync time in Supabase table 'sync_state'.
 */
export async function setPersistentSyncState(key: string, timestampMs: number): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;

  try {
    const { error } = await client
      .from('sync_state')
      .upsert({
        key,
        last_sync_time: timestampMs,
        updated_at: new Date(timestampMs).toISOString(),
      }, { onConflict: 'key' });

    if (error && error.code !== 'PGRST205') {
      console.warn('[SUPABASE BACKUP] sync_state upsert warning:', error.message);
    }
  } catch (err) {
    console.warn('[SUPABASE BACKUP] Exception updating sync_state:', err);
  }
}
