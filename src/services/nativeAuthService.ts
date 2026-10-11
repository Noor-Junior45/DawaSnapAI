import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { 
  signInWithPopup, 
  signInWithCredential, 
  GoogleAuthProvider, 
  signOut, 
  User as FirebaseUser,
  auth,
  googleProvider,
  browserPopupRedirectResolver 
} from '../firebase';

export interface NativeAuthResult {
  success: boolean;
  user?: FirebaseUser;
  error?: string;
  isCancelled?: boolean;
}

function isCancellationError(err: any): boolean {
  if (!err) return false;
  const msg = String(err?.message || err?.code || err || '').toLowerCase();
  return (
    msg.includes('cancel') ||
    msg.includes('12501') ||
    msg.includes('16') ||
    msg.includes('closed by user') ||
    msg.includes('popup-closed') ||
    msg.includes('user canceled') ||
    msg.includes('user cancelled')
  );
}

function isPlayServicesConfigError(err: any): boolean {
  if (!err) return false;
  const msg = String(err?.message || err?.code || err || '');
  return (
    msg.includes('10:') ||
    msg.includes('10 :') ||
    msg.includes('code 10') ||
    msg.includes('DEVELOPER_ERROR') ||
    msg.includes('ApiException: 10')
  );
}

function formatAuthError(error: any): string {
  if (!error) return 'Failed to sign in with Google';
  const code = String(error?.code || '');
  const message = String(error?.message || error || '');

  if (isPlayServicesConfigError(error)) {
    return 'Google Play App Signing SHA-1 Required (Error 10):\n\n' +
      'Google Play re-signs your app with a different key (Play App Signing key) than your local build, which is why it works on Indus Appstore but shows Error 10 on Play Store.\n\n' +
      'How to fix in 2 minutes:\n' +
      '1. Open Google Play Console > Your App > Setup > App integrity (under App signing).\n' +
      '2. Copy the "SHA-1 certificate fingerprint" of the App signing key certificate.\n' +
      '3. Open Firebase Console > Project Settings > Your apps (Android) > click "Add fingerprint" and paste it.\n' +
      '4. Download the new google-services.json and rebuild your app.';
  }

  if (code === 'auth/unauthorized-domain' || message.includes('unauthorized-domain')) {
    return 'Domain Unauthorized: Please add this domain to Firebase Console > Authentication > Settings > Authorized domains.';
  }
  if (code === 'auth/operation-not-allowed' || message.includes('operation-not-allowed') || message.includes('action is invalid')) {
    return 'Google Sign-In not enabled: Please enable Google provider in Firebase Console > Authentication > Sign-in method and select a Project support email.';
  }
  if (code === 'auth/popup-blocked') {
    return 'Popup blocked by browser. Please allow popups for this site and try again.';
  }
  return message;
}

/**
 * High-performance cross-platform Google Sign In service.
 * Automatically detects native Capacitor Android environment and uses Google Play Services native auth sheet,
 * while falling back to standard web popup on browser / PWA.
 */
export async function signInWithGoogleAdaptive(): Promise<NativeAuthResult> {
  const isNative = Capacitor.isNativePlatform();

  if (isNative) {
    try {
      let result: any = null;
      let lastError: any = null;

      // 1. Try modern Credential Manager sheet (Android 14+ / updated Play Services)
      try {
        result = await FirebaseAuthentication.signInWithGoogle();
      } catch (credMgrErr: any) {
        lastError = credMgrErr;

        if (isCancellationError(credMgrErr)) {
          return {
            success: false,
            isCancelled: true,
            error: 'Sign in was cancelled',
          };
        }

        // If Error 10 (DEVELOPER_ERROR) occurred, it is a Play App Signing SHA-1 mismatch.
        // Trying legacy GoogleSignInClient will just pop up a second account picker and fail with the same Error 10.
        if (isPlayServicesConfigError(credMgrErr)) {
          console.warn('Play Services SHA-1 config error (10) detected in Credential Manager:', credMgrErr);
          return {
            success: false,
            error: formatAuthError(credMgrErr),
          };
        }

        // Credential Manager is unsupported or threw a non-config error; try legacy GoogleSignInClient
        console.warn('Credential Manager attempt warning, falling back to legacy Play Services:', credMgrErr);
        try {
          result = await FirebaseAuthentication.signInWithGoogle({
            useCredentialManager: false,
          });
          lastError = null;
        } catch (legacyErr: any) {
          lastError = legacyErr;
          if (isCancellationError(legacyErr)) {
            return {
              success: false,
              isCancelled: true,
              error: 'Sign in was cancelled',
            };
          }
          console.error('Legacy Google Sign-In failed:', legacyErr);
        }
      }

      if (lastError && !result) {
        throw lastError;
      }

      // 2. If native credential was returned, synchronize with Firebase Web SDK
      if (result?.credential?.idToken) {
        const credential = GoogleAuthProvider.credential(
          result.credential.idToken,
          result.credential.accessToken || undefined
        );
        const userCredential = await signInWithCredential(auth, credential);
        return {
          success: true,
          user: userCredential.user,
        };
      }

      // 3. If native user object was returned directly by plugin / OAuth activity
      if (result?.user) {
        const idTokenRes = await FirebaseAuthentication.getIdToken().catch(() => null);
        if (idTokenRes?.token) {
          try {
            const credential = GoogleAuthProvider.credential(idTokenRes.token);
            const userCredential = await signInWithCredential(auth, credential);
            return {
              success: true,
              user: userCredential.user,
            };
          } catch (syncErr) {
            console.warn('Native token sync warning:', syncErr);
          }
        }
      }

      // 4. Check if Firebase currentUser was populated
      if (auth.currentUser) {
        return {
          success: true,
          user: auth.currentUser,
        };
      }

      return {
        success: true,
      };
    } catch (nativeError: any) {
      console.warn('Native Google Sign-In attempt error:', nativeError);

      if (isCancellationError(nativeError)) {
        return {
          success: false,
          isCancelled: true,
          error: 'Sign in was cancelled',
        };
      }

      return {
        success: false,
        error: formatAuthError(nativeError),
      };
    }
  }

  // Web / PWA flow
  try {
    const res = await signInWithPopup(auth, googleProvider, browserPopupRedirectResolver);
    return {
      success: true,
      user: res.user,
    };
  } catch (error: any) {
    if (isCancellationError(error)) {
      return {
        success: false,
        isCancelled: true,
      };
    }
    return {
      success: false,
      error: formatAuthError(error),
    };
  }
}

/**
 * Universal sign-out handling both native Android session and Firebase Web SDK session.
 */
export async function signOutAdaptive(): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      await FirebaseAuthentication.signOut();
    } catch (e) {
      console.warn('Native signOut warning:', e);
    }
  }
  await signOut(auth);
}
