import { Capacitor } from '@capacitor/core';

/**
 * Configuration for connecting Vercel frontend or native Capacitor Android app with the Cloud Run backend server.
 */

/**
 * Official domains configured for DawaSnap AI APK and Web
 * Primary Cloud Run: https://dawasnap.cloud.run
 * Mirror Cloud Run:  https://dawalens.cloud.run
 * Primary Custom:    https://noorpos.in
 */
export const GOOGLE_CLOUD_RUN_URL = "https://dawasnap.cloud.run";
export const MIRROR_CLOUD_RUN_URL = "https://dawalens.cloud.run";
export const NOORPOS_DOMAIN_URL = "https://noorpos.in";

const metaEnv = typeof import.meta !== 'undefined' ? (import.meta as any).env : undefined;

// Active backend URL: If VITE_BACKEND_URL is set and valid, use it; otherwise default to Google Cloud domain
export const BACKEND_URL = 
  (metaEnv?.VITE_BACKEND_URL && !String(metaEnv.VITE_BACKEND_URL).includes('REPLACE_WITH')) 
    ? String(metaEnv.VITE_BACKEND_URL).replace(/\/+$/, '') 
    : GOOGLE_CLOUD_RUN_URL;

// Secondary fallback backend URL: noorpos.in
export const SECONDARY_BACKEND_URL = NOORPOS_DOMAIN_URL;

/**
 * Resolves API URL.
 * In native Capacitor (Android APK), relative '/api' paths fail because the web assets
 * run on https://localhost or capacitor://localhost with no local backend.
 * On native Android APK, all requests are routed directly to the Google Cloud domain
 * (https://dawasnap.cloud.run) by default.
 * On web platforms, clean relative paths are used so local Vite dev proxy, Cloud Run,
 * or Vercel rewrites function seamlessly.
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

/**
 * Direct backend URL with noorpos.in domain fallback.
 * Used for failover calls when primary cloud run microservices need secondary routing.
 */
export function getDirectBackendUrl(path: string, preferNoorpos = false): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const base = preferNoorpos ? NOORPOS_DOMAIN_URL : (BACKEND_URL || GOOGLE_CLOUD_RUN_URL);
  return `${base}${cleanPath}`;
}

/**
 * Failover fetch helper for Android APK:
 * Tries Google Cloud Run domain first; if unreachable, falls back to noorpos.in domain automatically!
 */
export async function fetchWithDomainFailover(
  path: string, 
  init?: RequestInit
): Promise<Response> {
  const primaryUrl = getApiUrl(path);
  try {
    const res = await fetch(primaryUrl, init);
    if (res.ok || res.status < 500) {
      return res;
    }
    throw new Error(`Primary domain response status: ${res.status}`);
  } catch (err) {
    const fallbackUrl = getDirectBackendUrl(path, true);
    if (fallbackUrl !== primaryUrl) {
      return await fetch(fallbackUrl, init);
    }
    throw err;
  }
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
