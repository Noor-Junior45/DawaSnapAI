import { Capacitor } from '@capacitor/core';
import {
  AdMob,
  BannerAdOptions,
  BannerAdSize,
  BannerAdPosition,
  AdmobConsentStatus,
} from '@capacitor-community/admob';

/**
 * Service to manage Google AdMob for Capacitor Android.
 * Preconfigured with official Google AdMob Test IDs to avoid policy strikes during development/testing.
 */

export const ADMOB_APP_ID = 'ca-app-pub-5865716270182311~1628341584';

// Official Google AdMob Test Ad Unit IDs (Use these during dev/testing to prevent account suspension)
export const ADMOB_TEST_IDS = {
  // Banner test ad unit
  BANNER: 'ca-app-pub-3940256099942544/6300978111',
  // Interstitial test ad unit
  INTERSTITIAL: 'ca-app-pub-3940256099942544/1033173712',
  // Rewarded test ad unit
  REWARDED: 'ca-app-pub-3940256099942544/5224354917',
};

let isAdmobInitialized = false;

/**
 * Initializes the Google AdMob SDK on native Android platforms.
 */
export async function initAdMob(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) {
    return false;
  }

  if (isAdmobInitialized) {
    return true;
  }

  try {
    // 1. Initialize AdMob with test device flags
    await AdMob.initialize({
      testingDevices: ['EMULATOR'],
      initializeForTesting: true,
    });

    // 2. Request User Consent Info (Google UMP GDPR/Privacy compliance)
    try {
      const consentInfo = await AdMob.requestConsentInfo();
      if (
        consentInfo.isConsentFormAvailable &&
        consentInfo.status === AdmobConsentStatus.REQUIRED
      ) {
        await AdMob.showConsentForm();
      }
    } catch (consentErr) {
      console.warn('[AdMob] Consent check notice:', consentErr);
    }

    isAdmobInitialized = true;
    console.log('[AdMob] Initialized successfully');
    return true;
  } catch (error) {
    console.warn('[AdMob] Initialization warning (non-fatal):', error);
    return false;
  }
}

/**
 * Shows an AdMob Banner Ad at the bottom of the screen.
 */
export async function showBannerAd(adId: string = ADMOB_TEST_IDS.BANNER): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;

  try {
    await initAdMob();

    const options: BannerAdOptions = {
      adId,
      adSize: BannerAdSize.ADAPTIVE_BANNER,
      position: BannerAdPosition.BOTTOM_CENTER,
      margin: 0,
      isTesting: true,
    };

    await AdMob.showBanner(options);
    return true;
  } catch (err) {
    console.warn('[AdMob] Show banner warning:', err);
    return false;
  }
}

/**
 * Hides the active banner ad.
 */
export async function hideBannerAd(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await AdMob.hideBanner();
  } catch (err) {
    console.warn('[AdMob] Hide banner warning:', err);
  }
}

/**
 * Resumes / shows previously hidden banner ad.
 */
export async function resumeBannerAd(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await AdMob.resumeBanner();
  } catch (err) {
    console.warn('[AdMob] Resume banner warning:', err);
  }
}

/**
 * Prepares and displays a fullscreen Interstitial Ad.
 */
export async function showInterstitialAd(adId: string = ADMOB_TEST_IDS.INTERSTITIAL): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;

  try {
    await initAdMob();
    await AdMob.prepareInterstitial({
      adId,
      isTesting: true,
    });
    await AdMob.showInterstitial();
    return true;
  } catch (err) {
    console.warn('[AdMob] Interstitial warning:', err);
    return false;
  }
}
