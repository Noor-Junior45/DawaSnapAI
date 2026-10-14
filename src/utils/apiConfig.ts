import { Capacitor } from '@capacitor/core';

/**
 * Configuration for connecting Vercel frontend or native Capacitor Android app with the Cloud Run backend server.
 */

const metaEnv = typeof import.meta !== 'undefined' ? (import.meta as any).env : undefined;

export const BACKEND_URL = 
  (metaEnv?.VITE_BACKEND_URL) 
    ? String(metaEnv.VITE_BACKEND_URL).replace(/\/+$/, '') 
    : "https://REPLACE_WITH_MY_API_DOMAIN";

/**
 * Resolves API URL.
 * In native Capacitor (Android APK), relative '/api' paths fail because there is no local
 * web server running on https://localhost. On native platforms, requests are automatically routed
 * to the deployed backend server (BACKEND_URL).
 * On web, clean relative paths are used so Vite dev proxy or Vercel rewrites work as intended.
 */
export function getApiUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  if (typeof window !== 'undefined') {
    const isNative = Capacitor.isNativePlatform();
    const isCapacitorOrigin = window.location.protocol === 'capacitor:' || 
      (window.location.hostname === 'localhost' && typeof (window as any).Capacitor !== 'undefined');
    if (isNative || isCapacitorOrigin) {
      return `${BACKEND_URL}${cleanPath}`;
    }
  }
  return cleanPath;
}

export function getDirectBackendUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${BACKEND_URL}${cleanPath}`;
}

/**
 * Builds standard API headers including Firebase Auth token and App Check token.
 */
export async function getStandardApiHeaders(user?: any, additionalHeaders: Record<string, string> = {}): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...additionalHeaders,
  };

  if (user && typeof user.getIdToken === 'function') {
    try {
      const idToken = await user.getIdToken();
      if (idToken) headers['Authorization'] = `Bearer ${idToken}`;
    } catch {}
  }

  try {
    const { getClientAppCheckToken } = await import('../firebase');
    const appCheckToken = await getClientAppCheckToken();
    if (appCheckToken) {
      headers['X-Firebase-AppCheck'] = appCheckToken;
    }
  } catch {}

  return headers;
}
