import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

export const BASE_DAILY_CHAT_LIMIT = 10;
export const CHATS_PER_REWARD = 3;

export interface ChatQuotaState {
  limit: number;
  used: number;
  bonus: number;
  remaining: number;
  dateKey: string;
}

type QuotaListener = (state: ChatQuotaState) => void;
const listeners = new Set<QuotaListener>();

function getTodayKey(): string {
  // Returns YYYY-MM-DD local date
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getStorageKey(userId?: string): string {
  return `dawasnap_consult_quota_${userId || 'guest'}`;
}

function notifyListeners(state: ChatQuotaState) {
  listeners.forEach((fn) => {
    try {
      fn(state);
    } catch (e) {
      console.warn('[ChatQuota] Listener error:', e);
    }
  });
}

/**
 * Gets the current chat quota for today.
 * Resets daily automatically at midnight.
 */
export function getChatQuota(userId?: string): ChatQuotaState {
  const today = getTodayKey();
  const key = getStorageKey(userId);

  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.dateKey === today) {
        const used = Math.max(0, Number(parsed.used) || 0);
        const bonus = Math.max(0, Number(parsed.bonus) || 0);
        const remaining = Math.max(0, BASE_DAILY_CHAT_LIMIT + bonus - used);
        return {
          limit: BASE_DAILY_CHAT_LIMIT,
          used,
          bonus,
          remaining,
          dateKey: today,
        };
      }
    }
  } catch (e) {
    console.warn('[ChatQuota] Read error, using defaults:', e);
  }

  // New day or uninitialized
  const fresh: ChatQuotaState = {
    limit: BASE_DAILY_CHAT_LIMIT,
    used: 0,
    bonus: 0,
    remaining: BASE_DAILY_CHAT_LIMIT,
    dateKey: today,
  };

  try {
    localStorage.setItem(key, JSON.stringify(fresh));
  } catch (_) {}

  return fresh;
}

/**
 * Increments chat usage by 1 when user sends a message.
 */
export async function recordChatUsed(userId?: string): Promise<ChatQuotaState> {
  const current = getChatQuota(userId);
  const newUsed = current.used + 1;
  const newRemaining = Math.max(0, BASE_DAILY_CHAT_LIMIT + current.bonus - newUsed);

  const updated: ChatQuotaState = {
    ...current,
    used: newUsed,
    remaining: newRemaining,
  };

  try {
    localStorage.setItem(getStorageKey(userId), JSON.stringify(updated));
  } catch (_) {}

  // Save to Firestore in background for logged-in user
  if (userId) {
    try {
      const today = current.dateKey;
      setDoc(
        doc(db, 'users', userId, 'dailyChatQuota', today),
        {
          dateKey: today,
          used: newUsed,
          bonus: current.bonus,
          updatedAt: Date.now(),
        },
        { merge: true }
      ).catch(() => {});
    } catch (_) {}
  }

  notifyListeners(updated);
  return updated;
}

/**
 * Grants bonus chats to the user upon successfully watching a rewarded ad.
 */
export async function grantBonusChats(
  amount: number = CHATS_PER_REWARD,
  userId?: string
): Promise<ChatQuotaState> {
  const current = getChatQuota(userId);
  const newBonus = current.bonus + amount;
  const newRemaining = Math.max(0, BASE_DAILY_CHAT_LIMIT + newBonus - current.used);

  const updated: ChatQuotaState = {
    ...current,
    bonus: newBonus,
    remaining: newRemaining,
  };

  try {
    localStorage.setItem(getStorageKey(userId), JSON.stringify(updated));
  } catch (_) {}

  // Sync to Firestore
  if (userId) {
    try {
      const today = current.dateKey;
      setDoc(
        doc(db, 'users', userId, 'dailyChatQuota', today),
        {
          dateKey: today,
          used: current.used,
          bonus: newBonus,
          updatedAt: Date.now(),
        },
        { merge: true }
      ).catch(() => {});
    } catch (_) {}
  }

  notifyListeners(updated);
  return updated;
}

/**
 * Syncs quota with Firestore if user is signed in.
 */
export async function syncQuotaFromCloud(userId?: string): Promise<ChatQuotaState> {
  const local = getChatQuota(userId);
  if (!userId) return local;

  try {
    const today = local.dateKey;
    const snap = await getDoc(doc(db, 'users', userId, 'dailyChatQuota', today));
    if (snap.exists()) {
      const cloudData = snap.data();
      const cloudUsed = Math.max(local.used, Number(cloudData.used) || 0);
      const cloudBonus = Math.max(local.bonus, Number(cloudData.bonus) || 0);
      const remaining = Math.max(0, BASE_DAILY_CHAT_LIMIT + cloudBonus - cloudUsed);

      const merged: ChatQuotaState = {
        limit: BASE_DAILY_CHAT_LIMIT,
        used: cloudUsed,
        bonus: cloudBonus,
        remaining,
        dateKey: today,
      };

      try {
        localStorage.setItem(getStorageKey(userId), JSON.stringify(merged));
      } catch (_) {}

      notifyListeners(merged);
      return merged;
    }
  } catch (err) {
    console.warn('[ChatQuota] Cloud sync note:', err);
  }

  return local;
}

/**
 * Subscribes to quota changes.
 */
export function subscribeToQuota(listener: QuotaListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
