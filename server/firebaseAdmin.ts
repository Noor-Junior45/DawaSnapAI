import { initializeApp, getApps, cert, applicationDefault, type App } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import type { Request, Response, NextFunction } from 'express';
import firebaseConfig from '../firebase-applet-config.json' with { type: 'json' };

let adminApp: App | null = null;
let hasServiceAccount = false;

export function initFirebaseAdmin(): App {
  if (adminApp && getApps().length > 0) {
    return adminApp;
  }

  const serviceAccountEnv = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (serviceAccountEnv) {
    try {
      const parsed = JSON.parse(serviceAccountEnv);
      adminApp = initializeApp({
        credential: cert(parsed),
        projectId: parsed.project_id || firebaseConfig.projectId,
      });
      hasServiceAccount = true;
      console.log('[FIREBASE ADMIN] Initialized with FIREBASE_SERVICE_ACCOUNT_KEY credentials.');
      return adminApp;
    } catch (e) {
      console.error('[FIREBASE ADMIN ERROR] Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY JSON:', e);
    }
  }

  // If no service-account env var is set, initialize with Application Default Credentials (applicationDefault()),
  // so Cloud Run uses its attached service account and no JSON key is needed. hasServiceAccountConfigured() returns true.
  try {
    adminApp = initializeApp({
      credential: applicationDefault(),
      projectId: firebaseConfig.projectId,
    });
    hasServiceAccount = true;
    console.log('[FIREBASE ADMIN] Initialized with Application Default Credentials (Cloud Run attached service account).');
    return adminApp;
  } catch (e) {
    console.warn('[FIREBASE ADMIN] applicationDefault credentials unavailable, falling back to project ID only:', e);
  }

  // Fallback: Initialize with projectId only.
  // This allows verifying user ID tokens using Google's public x509 certs without a private key.
  try {
    const existing = getApps();
    if (existing.length === 0) {
      adminApp = initializeApp({
        projectId: firebaseConfig.projectId,
      });
    } else {
      adminApp = existing[0];
    }
    hasServiceAccount = false;
    console.log(`[FIREBASE ADMIN] Initialized in token-verification mode for project: ${firebaseConfig.projectId}`);
  } catch (e) {
    console.error('[FIREBASE ADMIN ERROR] Failed to initialize Firebase Admin:', e);
  }

  return adminApp!;
}

export function getAdminApp(): App {
  return initFirebaseAdmin();
}

let cachedAdminDb: Firestore | null = null;
export function getAdminDb(): Firestore {
  if (cachedAdminDb) return cachedAdminDb;
  const app = getAdminApp();
  cachedAdminDb = getFirestore(app, firebaseConfig.firestoreDatabaseId);
  try {
    cachedAdminDb.settings({ ignoreUndefinedProperties: true });
  } catch {}
  return cachedAdminDb;
}

export function hasServiceAccountConfigured(): boolean {
  return hasServiceAccount;
}

export interface AuthenticatedRequest extends Request {
  user?: DecodedIdToken;
  userId?: string;
  userEmail?: string;
}

/**
 * Express middleware to verify Firebase ID tokens.
 * Extracts 'Authorization: Bearer <token>' header and validates against Firebase Auth.
 * Automatically populates req.userId and req.user.
 */
export async function requireFirebaseAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'Unauthorized: Missing or malformed Authorization Bearer token header.'
    });
    return;
  }

  const token = authHeader.split('Bearer ')[1]?.trim();
  if (!token) {
    res.status(401).json({
      error: 'Unauthorized: Empty token provided in Authorization header.'
    });
    return;
  }

  try {
    const app = initFirebaseAdmin();
    const auth = getAuth(app);
    const decodedToken = await auth.verifyIdToken(token);
    req.user = decodedToken;
    req.userId = decodedToken.uid;
    req.userEmail = decodedToken.email;
    next();
  } catch (error: any) {
    console.warn('[AUTH VERIFICATION FAILED]:', error?.message || error);
    res.status(401).json({
      error: 'Unauthorized: Invalid or expired Firebase ID token.',
      code: error?.code || 'auth/invalid-token'
    });
  }
}
