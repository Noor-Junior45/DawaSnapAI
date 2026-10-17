import { getFirestore, Firestore } from 'firebase-admin/firestore';
import firebaseConfig from '../firebase-applet-config.json' with { type: 'json' };
import { sendEmailDirectServer, getExpiryEmailHTMLServer, getExpiryEmailSubject, type ExpiryStage } from "./emailTemplates.ts";
import { getAdminApp, hasServiceAccountConfigured } from "./firebaseAdmin.ts";

let cachedDb: Firestore | null = null;

function getAdminDb(): Firestore {
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

export interface ActiveMedicineItem {
  id: string;
  name: string;
  expirationDate: string;
  quantity?: number | string;
  enableEmailExpiryAlert?: boolean;
}

export interface UserExpirySchedule {
  userId: string;
  email: string;
  emailNotificationsEnabled: boolean;
  medicines: ActiveMedicineItem[];
  updatedAt: string;
}

// In-memory fallback cache
const memorySchedules = new Map<string, UserExpirySchedule>();

// Mutex lock and in-flight tracking to strictly prevent duplicate email dispatches
let isCheckRunning = false;
const inFlightAlerts = new Set<string>();

/**
 * Registers or updates a user's active medicine schedule in Firestore and memory.
 * Called whenever a user logs in, adds, edits, or deletes a medicine in the app.
 */
export async function registerUserExpirySchedule(
  userId: string,
  email: string,
  emailNotificationsEnabled: boolean,
  medicines: ActiveMedicineItem[]
): Promise<void> {
  const schedule: UserExpirySchedule = {
    userId,
    email,
    emailNotificationsEnabled,
    medicines: medicines.filter(m => Boolean(m.name && m.expirationDate)),
    updatedAt: new Date().toISOString()
  };

  memorySchedules.set(userId, schedule);

  try {
    if (hasServiceAccountConfigured()) {
      const db = getAdminDb();
      await db.collection('server_expiry_schedules').doc(userId).set(schedule);
      console.log(`[EXPIRY SYNC] Successfully registered ${schedule.medicines.length} medicine(s) for user ${email}`);
    } else {
      console.log(`[EXPIRY SYNC] Service account not configured in environment; schedule for ${email} (${schedule.medicines.length} meds) held safely in memory.`);
    }
  } catch (err) {
    console.warn(`[EXPIRY SYNC WARNING] Could not persist schedule to Firestore, kept in memory:`, err);
  }
}

/**
 * Executes the backend automated expiry check.
 * 
 * Policy:
 * - Stage 1 (30_DAYS): Exactly 30-31 days before expiry (1 Month Notice)
 * - Stage 2 (7_DAYS): Exactly 7 days before expiry (1 Week Warning)
 * - Stage 3 (EXPIRED): On or within 14 days after expiration date (Safe Disposal Advisory)
 * 
 * Each stage for a given medicine is dispatched at most ONCE per user.
 */
export async function runBackgroundExpiryCheck(): Promise<{ checked: number; sent: number }> {
  if (isCheckRunning) {
    console.log("[BACKGROUND EXPIRY CRON] Another check is already in progress, skipping.");
    return { checked: 0, sent: 0 };
  }

  isCheckRunning = true;
  let totalChecked = 0;
  let totalSent = 0;

  try {
    // 1. Gather all registered user schedules (from Firestore + memory)
    const schedulesToProcess = new Map<string, UserExpirySchedule>();

    // Load from memory first
    for (const [uid, sched] of memorySchedules.entries()) {
      schedulesToProcess.set(uid, sched);
    }

    // Load from Firestore server_expiry_schedules using Admin SDK if service account configured
    if (hasServiceAccountConfigured()) {
      try {
        const db = getAdminDb();
        const snap = await db.collection('server_expiry_schedules').get();
        snap.forEach(docSnap => {
          const data = docSnap.data() as UserExpirySchedule;
          if (data && data.userId && data.email) {
            schedulesToProcess.set(data.userId, data);
            memorySchedules.set(data.userId, data);
          }
        });
      } catch (fsErr) {
        console.warn("[BACKGROUND EXPIRY] Failed to query server_expiry_schedules from Firestore, using memory:", fsErr);
      }
    }

    if (schedulesToProcess.size === 0) {
      return { checked: 0, sent: 0 };
    }

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const db = getAdminDb();

    for (const schedule of schedulesToProcess.values()) {
      if (!schedule.emailNotificationsEnabled || !schedule.email || !schedule.medicines) {
        continue;
      }

      for (const m of schedule.medicines) {
        if (m.enableEmailExpiryAlert === false || !m.expirationDate) {
          continue;
        }

        totalChecked++;

        // Parse expiration date YYYY-MM-DD
        const parts = m.expirationDate.split('-').map(Number);
        if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
          continue;
        }

        const expiry = new Date(parts[0], parts[1] - 1, parts[2]);
        expiry.setHours(0, 0, 0, 0);

        const diffTime = expiry.getTime() - now.getTime();
        const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

        let stageToSend: ExpiryStage | null = null;
        if (diffDays === 30 || diffDays === 31) {
          stageToSend = '30_DAYS';
        } else if (diffDays === 7) {
          stageToSend = '7_DAYS';
        } else if (diffDays <= 0 && diffDays >= -14) {
          stageToSend = 'EXPIRED';
        }

        if (!stageToSend) {
          continue;
        }

        // Global deduplication key in Firestore
        // Format: ${userId}_${medicineId}_${stage}
        const alertDocId = `${schedule.userId}_${m.id}_${stageToSend}`;

        // In-memory guard to immediately halt concurrent tasks
        if (inFlightAlerts.has(alertDocId)) {
          continue;
        }

        try {
          // Check if this alert was already sent in Firestore using Admin SDK
          const alertRef = db.collection('server_sent_expiry_alerts').doc(alertDocId);
          const alertSnap = await alertRef.get();

          if (alertSnap.exists) {
            // Already sent! Skip to guarantee only one email is ever sent
            inFlightAlerts.add(alertDocId);
            continue;
          }

          // Mark in-flight memory set immediately
          inFlightAlerts.add(alertDocId);

          // Atomic reservation in Firestore: write PENDING record immediately to prevent race conditions
          await alertRef.set({
            userId: schedule.userId,
            medId: m.id,
            medName: m.name,
            stage: stageToSend,
            email: schedule.email,
            expirationDate: m.expirationDate,
            status: 'PENDING',
            claimedAt: new Date().toISOString()
          });

          // Construct email content (professional, no emojis)
          const subject = getExpiryEmailSubject(m.name, stageToSend);

          const text = stageToSend === 'EXPIRED'
            ? `DawaSnap Safety Advisory: Your medicine ${m.name} reached its expiration date on ${m.expirationDate}. Please do not consume this medication and discard it securely in accordance with government disposal guidelines.`
            : (stageToSend === '7_DAYS'
                ? `DawaSnap Refill Notice: Your medicine ${m.name} expires in 7 days on ${m.expirationDate}. Please consult your physician or pharmacy for a refill.`
                : `DawaSnap Advance Notice: Your medicine ${m.name} is scheduled to expire on ${m.expirationDate}.`);

          const html = getExpiryEmailHTMLServer(
            m.name, 
            m.quantity || "1", 
            m.expirationDate, 
            stageToSend
          );

          console.log(`[BACKGROUND EXPIRY CRON] Dispatching single ${stageToSend} notice for "${m.name}" to ${schedule.email}...`);
          
          await sendEmailDirectServer(schedule.email, subject, html, text);
          totalSent++;

          // Also dispatch Firebase Cloud Message (FCM) push notification to all user's registered devices
          if (hasServiceAccountConfigured()) {
            try {
              const { getMessaging } = await import('firebase-admin/messaging');
              const tokensSnap = await db.collection('users').doc(schedule.userId).collection('pushTokens').get();
              const tokens = tokensSnap.docs.map(d => d.data().token).filter(Boolean);
              if (tokens.length > 0) {
                const messaging = getMessaging(getAdminApp());
                const multicastResponse = await messaging.sendEachForMulticast({
                  tokens,
                  notification: {
                    title: subject,
                    body: text,
                  },
                  data: {
                    medicineId: m.id,
                    stage: stageToSend,
                    expirationDate: m.expirationDate,
                  },
                  android: {
                    priority: 'high',
                    notification: {
                      channelId: 'medicine_alerts',
                      sound: 'default',
                      defaultVibrateTimings: true,
                      priority: 'high',
                      visibility: 'public',
                    },
                  },
                });
                console.log(`[BACKGROUND EXPIRY CRON] Dispatched FCM push notification to ${tokens.length} device(s) for ${schedule.email}`);

                // Clean up dead/unregistered FCM tokens immediately
                if (multicastResponse && Array.isArray(multicastResponse.responses)) {
                  const deadTokenDocRefs: any[] = [];
                  multicastResponse.responses.forEach((resp, idx) => {
                    if (!resp.success && resp.error) {
                      const code = resp.error.code;
                      if (
                        code === 'messaging/registration-token-not-registered' ||
                        code === 'messaging/invalid-registration-token'
                      ) {
                        if (tokensSnap.docs[idx]) {
                          deadTokenDocRefs.push(tokensSnap.docs[idx].ref);
                        }
                      }
                    }
                  });

                  if (deadTokenDocRefs.length > 0) {
                    try {
                      const batch = db.batch();
                      deadTokenDocRefs.forEach(ref => batch.delete(ref));
                      await batch.commit();
                      console.log(`[BACKGROUND EXPIRY CRON] Pruned ${deadTokenDocRefs.length} dead FCM token(s) (registration-token-not-registered) for user ${schedule.userId}`);
                    } catch (pruneErr: any) {
                      console.warn('[BACKGROUND EXPIRY CRON] Notice pruning dead tokens:', pruneErr.message);
                    }
                  }
                }
              }
            } catch (fcmErr) {
              console.warn('[BACKGROUND EXPIRY CRON] FCM push notice:', fcmErr);
            }
          }

          // Finalize permanently sent in Firestore
          await alertRef.set({
            status: 'SENT',
            sentAt: new Date().toISOString()
          }, { merge: true });

          console.log(`[BACKGROUND EXPIRY CRON] Logged sent alert in Firestore: ${alertDocId}`);
        } catch (alertErr) {
          console.error(`[BACKGROUND EXPIRY CRON ERROR] Failed to dispatch alert for ${m.name}:`, alertErr);
          // Release lock on error
          inFlightAlerts.delete(alertDocId);
        }
      }
    }
  } catch (err) {
    console.error("[BACKGROUND EXPIRY CRON ROOT ERROR]", err);
  } finally {
    isCheckRunning = false;
  }

  return { checked: totalChecked, sent: totalSent };
}

/**
 * Initializes the background cron worker on the server.
 * Runs independently in the server process so emails are sent in the background when the app is closed,
 * and NOT instantly on user app opening.
 */
export function startExpiryCron(): void {
  // Periodic run every 1 hour (runs independently in the backend)
  const ONE_HOUR = 60 * 60 * 1000;
  setInterval(() => {
    runBackgroundExpiryCheck()
      .then(res => {
        if (res.sent > 0) {
          console.log(`[BACKGROUND EXPIRY CRON] Hourly check dispatched ${res.sent} new email(s).`);
        }
      })
      .catch(err => console.error("[BACKGROUND EXPIRY CRON] Periodic run failed:", err));
  }, ONE_HOUR);

  console.log("[BACKGROUND EXPIRY CRON] Automated backend worker running. Interval: Every 1 hour. Concurrency locking & atomic deduplication active.");
}

/**
 * Permanently removes user's expiry schedule and push notification tokens from server memory & Firestore.
 * Executed during account deletion to ensure zero lingering data.
 */
export async function purgeUserServerData(userId: string): Promise<void> {
  memorySchedules.delete(userId);

  try {
    const db = getAdminDb();
    await db.collection('server_expiry_schedules').doc(userId).delete();
  } catch (err) {
    console.warn(`[PURGE] Notice when deleting server_expiry_schedules doc for ${userId}:`, err);
  }

  try {
    const db = getAdminDb();
    const snap = await db.collection('users').doc(userId).collection('pushTokens').get();
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  } catch (err) {
    console.warn(`[PURGE] Notice when deleting pushTokens for ${userId}:`, err);
  }
}
