import { getFirestore, Firestore } from 'firebase-admin/firestore';
import { getAdminApp } from './server/firebaseAdmin.ts';
import firebaseConfig from './firebase-applet-config.json' with { type: 'json' };

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

export async function getChatCount(userId: string, date: string): Promise<number> {
  try {
    const db = getAdminDb();
    const docSnap = await db.collection('server_chat_limits').doc(`${userId}_${date}`).get();
    if (docSnap.exists) {
      return docSnap.data()?.count || 0;
    }
  } catch (error) {
    console.error("Error in getChatCount:", error);
  }
  return 0;
}

export async function incrementChatCount(userId: string, date: string): Promise<void> {
  try {
    const db = getAdminDb();
    const docRef = db.collection('server_chat_limits').doc(`${userId}_${date}`);
    const docSnap = await docRef.get();
    if (docSnap.exists) {
      const currentCount = docSnap.data()?.count || 0;
      await docRef.set({ count: currentCount + 1, updated_at: new Date().toISOString() }, { merge: true });
    } else {
      await docRef.set({ count: 1, updated_at: new Date().toISOString() });
    }
  } catch (error) {
    console.error("Error in incrementChatCount:", error);
  }
}

export async function getCachedMedicine(name: string): Promise<any> {
  try {
    const db = getAdminDb();
    const docSnap = await db.collection('medicine_cache').doc(name.toLowerCase().trim()).get();
    if (docSnap.exists) {
      return docSnap.data();
    }
  } catch (error) {
    console.error("Error in getCachedMedicine:", error);
  }
  return null;
}

export async function setCachedMedicine(
  name: string,
  dosage: string,
  instructions: string,
  schedule: string,
  form: string
): Promise<void> {
  try {
    const db = getAdminDb();
    await db.collection('medicine_cache').doc(name.toLowerCase().trim()).set({
      name,
      dosage,
      instructions,
      schedule,
      form,
      updated_at: new Date().toISOString()
    });
  } catch (error) {
    console.error("Error in setCachedMedicine:", error);
  }
}

export async function getExtractionData(hash: string): Promise<any> {
  try {
    const db = getAdminDb();
    const docSnap = await db.collection('extraction_cache').doc(hash).get();
    if (docSnap.exists) {
      return docSnap.data();
    }
  } catch (error) {
    console.error("Error in getExtractionData:", error);
  }
  return null;
}

export async function setExtractionData(hash: string, data: string): Promise<void> {
  try {
    const db = getAdminDb();
    await db.collection('extraction_cache').doc(hash).set({
      data,
      updated_at: new Date().toISOString()
    });
  } catch (error) {
    console.error("Error in setExtractionData:", error);
  }
}

export async function getUserMedicines(userId: string): Promise<any[]> {
  try {
    const db = getAdminDb();
    const snap = await db.collection('medicines').where('userId', '==', userId).get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error("Error in getUserMedicines:", error);
    return [];
  }
}
