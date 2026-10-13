import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  User, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  sendPasswordResetEmail, 
  signInWithCredential, 
  reauthenticateWithPopup, 
  reauthenticateWithCredential,
  browserPopupRedirectResolver 
} from 'firebase/auth';
import { initializeFirestore, collection, doc, setDoc, addDoc, getDoc, getDocs, updateDoc, deleteDoc, onSnapshot, query, where, orderBy, getDocFromServer, writeBatch, deleteField, serverTimestamp } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject, uploadBytesResumable } from 'firebase/storage';
import firebaseConfig from '../firebase-applet-config.json';

// Use project Firebase authDomain for native Android app / localhost / dev runners,
// or actual custom domain if hosted on a web server
const resolvedAuthDomain = (() => {
  // Always use the official Firebase authDomain for standard authentication handshakes
  return firebaseConfig.authDomain;
})();

const dynamicFirebaseConfig = {
  ...firebaseConfig,
  authDomain: resolvedAuthDomain,
};

const app = initializeApp(dynamicFirebaseConfig);
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  experimentalAutoDetectLongPolling: false,
}, firebaseConfig.firestoreDatabaseId);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

// ============================================================
// FIREBASE APP CHECK INITIALIZATION
// ============================================================
let appCheckInstance: any = null;

export async function initAppCheck(): Promise<any> {
  if (appCheckInstance) return appCheckInstance;
  if (typeof window === 'undefined') return null;

  try {
    const { initializeAppCheck, ReCaptchaV3Provider, CustomProvider } = await import('firebase/app-check');
    const isCapacitorAndroid = (window as any)?.Capacitor?.getPlatform?.() === 'android';

    if (isCapacitorAndroid) {
      // Android Play Integrity bridge provider for native Capacitor
      appCheckInstance = initializeAppCheck(app, {
        provider: new CustomProvider({
          getToken: async () => {
            const token = (window as any)?.CapacitorAppCheckToken || 'android-play-integrity-token';
            return {
              token,
              expireTimeMillis: Date.now() + 60 * 60 * 1000,
            };
          }
        }),
        isTokenAutoRefreshEnabled: true,
      });
      console.log('[APP CHECK] Initialized with Play Integrity on Android.');
    } else {
      // Web ReCaptcha v3 provider (or debug provider in local dev)
      const siteKey = (import.meta as any).env?.VITE_RECAPTCHA_SITE_KEY || '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI';
      appCheckInstance = initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(siteKey),
        isTokenAutoRefreshEnabled: true,
      });
      console.log('[APP CHECK] Initialized ReCaptchaV3 provider on Web.');
    }
    return appCheckInstance;
  } catch (err) {
    console.warn('[APP CHECK NOTICE] App Check initialization skipped:', err);
    return null;
  }
}

// Automatically bootstrap App Check in browser environment
if (typeof window !== 'undefined') {
  initAppCheck().catch(() => {});
}

export async function getClientAppCheckToken(): Promise<string | null> {
  if (!appCheckInstance) {
    await initAppCheck();
  }
  if (!appCheckInstance) return null;
  try {
    const { getToken } = await import('firebase/app-check');
    const res = await getToken(appCheckInstance, false);
    return res?.token || null;
  } catch {
    return null;
  }
}

export { 
  signInWithPopup, 
  browserPopupRedirectResolver,
  signOut, 
  onAuthStateChanged, 
  collection, 
  doc, 
  setDoc, 
  addDoc, 
  getDoc, 
  getDocs, 
  updateDoc, 
  deleteDoc, 
  onSnapshot, 
  query, 
  where, 
  orderBy, 
  getDocFromServer, 
  writeBatch, 
  deleteField, 
  serverTimestamp, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  sendPasswordResetEmail, 
  signInWithCredential,
  reauthenticateWithPopup,
  reauthenticateWithCredential,
  GoogleAuthProvider,
  ref, 
  uploadBytes, 
  getDownloadURL, 
  deleteObject, 
  uploadBytesResumable 
};
export type { User };

export async function getAuthToken(): Promise<string | null> {
  try {
    if (auth.currentUser) {
      return await auth.currentUser.getIdToken();
    }
  } catch (err) {
    console.warn('Failed to obtain Firebase ID token:', err);
  }
  return null;
}

export async function getAuthHeader(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  const token = await getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  try {
    const appCheckToken = await getClientAppCheckToken();
    if (appCheckToken) {
      headers['X-Firebase-AppCheck'] = appCheckToken;
    }
  } catch {}
  return headers;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  uid: string | undefined;
}

// Safe stringify helper to handle circular references and non-serializable objects
const getSafeStringify = () => {
  const cache = new WeakSet();
  return (key: string, value: any) => {
    if (typeof value === 'object' && value !== null) {
      if (
        key.startsWith('__reactFiber') || 
        key.startsWith('__reactProps') || 
        key.startsWith('__reactEvents') || 
        key.startsWith('__reactContainer') ||
        key.startsWith('__reactInternal') ||
        key.startsWith('__reactEventHandlers')
      ) {
        return '[React Internal]';
      }

      if (cache.has(value)) {
        return '[Circular]';
      }
      
      const isDOM = (val: any): boolean => {
        try {
          return (
            val instanceof Node || 
            (typeof val.nodeType === 'number' && typeof val.nodeName === 'string') ||
            (val.constructor && (
              val.constructor.name === 'HTMLVideoElement' || 
              val.constructor.name === 'Window' || 
              val.constructor.name.includes('Element') ||
              val.constructor.name.includes('HTML')
            ))
          );
        } catch {
          return false;
        }
      };

      if (isDOM(value)) {
        return `[DOM Element: ${value.nodeName || value.tagName || value.constructor?.name || 'Unknown'}]`;
      }

      cache.add(value);
    }
    return value;
  };
};

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path,
    uid: auth.currentUser?.uid,
  };
  
  let errString: string;
  try {
    const safeStringify = getSafeStringify();
    errString = JSON.stringify(errInfo, safeStringify);
  } catch {
    errString = `{"error": "Failed to stringify error info", "originalError": "${errInfo.error}"}`;
  }
  
  console.error('Firestore Error: ', errString);
  throw new Error(errString);
}



