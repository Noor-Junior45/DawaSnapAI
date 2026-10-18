import { Capacitor } from '@capacitor/core';
import {
  AdMob,
  BannerAdOptions,
  BannerAdSize,
  BannerAdPosition,
  AdmobConsentStatus,
  BannerAdPluginEvents,
  AdMobBannerSize,
  RewardAdOptions,
  AdMobRewardItem,
  RewardAdPluginEvents,
} from '@capacitor-community/admob';

/**
 * Service to manage Google AdMob for Capacitor Android.
 * Integrates DawaSnap AI's official AdMob App ID, Banner, and Rewarded Ad Units.
 */

export const ADMOB_APP_ID = 'ca-app-pub-5865716270182311~1628341584';

// User's official Production Ad Unit IDs
export const ADMOB_PRODUCTION_IDS = {
  APP_ID: 'ca-app-pub-5865716270182311~1628341584',
  BANNER: 'ca-app-pub-5865716270182311/9965076733', // DawaSnap_Main_Banner
  REWARDED: 'ca-app-pub-5865716270182311/3189669416', // DawaSnap_Chat_Reward
  EXPIRED_SECTION_NATIVE: 'ca-app-pub-5865716270182311/6125203379', // DawaSnap_ExpiredSection_Native
};

// Official Google AdMob Test Ad Unit IDs (Google Sample IDs)
export const ADMOB_TEST_IDS = {
  BANNER: 'ca-app-pub-3940256099942544/6300978111',
  INTERSTITIAL: 'ca-app-pub-3940256099942544/1033173712',
  REWARDED: 'ca-app-pub-3940256099942544/5224354917',
  NATIVE: 'ca-app-pub-3940256099942544/2247696110', // Google Sample Native Advanced ID
};

// Default ad units to use
export const DEFAULT_BANNER_ID = ADMOB_PRODUCTION_IDS.BANNER;
export const DEFAULT_REWARDED_ID = ADMOB_PRODUCTION_IDS.REWARDED || ADMOB_TEST_IDS.REWARDED;
export const DEFAULT_NATIVE_DIVIDER_ID = ADMOB_PRODUCTION_IDS.EXPIRED_SECTION_NATIVE;

// Safe minimum clearance height (dp) on Android to guarantee banner never overlays floating navbar
export const DEFAULT_NATIVE_BANNER_HEIGHT = 65;

type HeightChangeListener = (height: number) => void;
const heightChangeListeners: Set<HeightChangeListener> = new Set();

let isAdmobInitialized = false;
let isBannerVisible = false;
let currentBannerHeight = 0;
let isListenersRegistered = false;

/**
 * Register a callback to be notified when the banner ad changes size (or appears/disappears).
 * Used by UI to dynamically pad the bottom navigation bar so ads never overlap interactive buttons.
 */
export function onBannerHeightChange(listener: HeightChangeListener): () => void {
  heightChangeListeners.add(listener);
  // Emit current height immediately
  listener(currentBannerHeight);
  return () => {
    heightChangeListeners.delete(listener);
  };
}

function notifyBannerHeight(height: number) {
  currentBannerHeight = height;
  heightChangeListeners.forEach((fn) => {
    try {
      fn(height);
    } catch (e) {
      console.warn('[AdMob] Listener error:', e);
    }
  });
}

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
    // 1. Request User Consent Info (Google UMP GDPR/Privacy compliance)
    try {
      const consentInfo = await AdMob.requestConsentInfo();
      if (
        consentInfo.isConsentFormAvailable &&
        consentInfo.status === AdmobConsentStatus.REQUIRED
      ) {
        await AdMob.showConsentForm();
      }
    } catch (consentErr) {
      console.warn('[AdMob] Consent check notice (non-fatal):', consentErr);
    }

    // 2. Initialize AdMob
    const isDev = Boolean((import.meta as any)?.env?.DEV);
    await AdMob.initialize({
      testingDevices: isDev ? ['EMULATOR'] : undefined,
      initializeForTesting: isDev,
    });

    // 3. Register lifecycle listeners once
    if (!isListenersRegistered) {
      isListenersRegistered = true;

      await AdMob.addListener(BannerAdPluginEvents.Loaded, () => {
        console.log('[AdMob] Banner ad loaded successfully');
        isBannerVisible = true;
        // Ensure UI stays safely above banner
        if (currentBannerHeight < DEFAULT_NATIVE_BANNER_HEIGHT) {
          notifyBannerHeight(DEFAULT_NATIVE_BANNER_HEIGHT);
        }
      });

      await AdMob.addListener(BannerAdPluginEvents.SizeChanged, (size: AdMobBannerSize) => {
        console.log('[AdMob] Banner size changed:', size.width, size.height);
        const effectiveHeight = Math.max(DEFAULT_NATIVE_BANNER_HEIGHT, size.height || 0);
        notifyBannerHeight(effectiveHeight);
      });

      await AdMob.addListener(BannerAdPluginEvents.FailedToLoad, (err) => {
        console.warn('[AdMob] Banner failed to load (e.g. unverified app or no fill):', err);
        notifyBannerHeight(0);
      });

      await AdMob.addListener(BannerAdPluginEvents.Closed, () => {
        console.log('[AdMob] Banner closed');
        isBannerVisible = false;
        notifyBannerHeight(0);
      });
    }

    isAdmobInitialized = true;
    console.log('[AdMob] Initialized successfully');
    return true;
  } catch (error) {
    console.warn('[AdMob] Initialization warning (non-fatal):', error);
    return false;
  }
}

export interface ShowBannerConfig {
  adId?: string;
  isTesting?: boolean;
  position?: BannerAdPosition;
  margin?: number;
}

/**
 * Shows an AdMob Banner Ad anchored at the bottom of the screen.
 * Complies with Google AdMob policy by keeping content and controls safely inset.
 */
export async function showBannerAd(config?: ShowBannerConfig): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) {
    return false;
  }

  try {
    // Immediately notify UI of safe banner clearance BEFORE native banner is rendered,
    // ensuring the floating navbar glides up in advance and is NEVER hidden or clipped!
    notifyBannerHeight(DEFAULT_NATIVE_BANNER_HEIGHT);

    const initialized = await initAdMob();
    if (!initialized) return false;

    const isDev = Boolean((import.meta as any)?.env?.DEV);
    const adId = config?.adId || DEFAULT_BANNER_ID;
    const isTesting = config?.isTesting !== undefined ? config.isTesting : isDev;

    const options: BannerAdOptions = {
      adId,
      adSize: BannerAdSize.ADAPTIVE_BANNER,
      position: config?.position || BannerAdPosition.BOTTOM_CENTER,
      margin: config?.margin || 0,
      isTesting,
    };

    console.log(`[AdMob] Displaying banner ad (unit: ${adId}, testing: ${isTesting})`);
    await AdMob.showBanner(options);
    isBannerVisible = true;
    return true;
  } catch (err) {
    console.warn('[AdMob] Show banner warning:', err);
    return false;
  }
}

/**
 * Hides the active banner ad (e.g. when opening camera, chat, or auth modal).
 */
export async function hideBannerAd(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await AdMob.hideBanner();
    isBannerVisible = false;
    notifyBannerHeight(0);
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
    notifyBannerHeight(DEFAULT_NATIVE_BANNER_HEIGHT);
    await AdMob.resumeBanner();
    isBannerVisible = true;
  } catch (err) {
    console.warn('[AdMob] Resume banner warning:', err);
  }
}

/**
 * Removes the banner completely from view.
 */
export async function removeBannerAd(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await AdMob.removeBanner();
    isBannerVisible = false;
    notifyBannerHeight(0);
  } catch (err) {
    console.warn('[AdMob] Remove banner warning:', err);
  }
}

/**
 * Prepares and displays a fullscreen Interstitial Ad.
 */
export async function showInterstitialAd(adId: string = ADMOB_TEST_IDS.INTERSTITIAL): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;

  try {
    await initAdMob();
    const isDev = Boolean((import.meta as any)?.env?.DEV);
    await AdMob.prepareInterstitial({
      adId,
      isTesting: isDev,
    });
    await AdMob.showInterstitial();
    return true;
  } catch (err) {
    console.warn('[AdMob] Interstitial warning:', err);
    return false;
  }
}

export interface ShowRewardedResult {
  success: boolean;
  rewarded: boolean;
  amount: number;
  type: string;
  error?: string;
}

/**
 * Prepares and displays a Rewarded Video Ad (Option 4).
 * Gives users bonus consultation chats upon completion.
 * Includes preview simulation on web so testing works instantly.
 */
export async function showRewardedAd(
  adId: string = DEFAULT_REWARDED_ID
): Promise<ShowRewardedResult> {
  // Web preview simulation for development/testing
  if (!Capacitor.isNativePlatform()) {
    console.log('[AdMob Simulation] Web preview active: simulating Rewarded Video Ad (+3 chats)...');
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          success: true,
          rewarded: true,
          amount: 3,
          type: 'chat_quota',
        });
      }, 1500);
    });
  }

  try {
    await initAdMob();
    const isDev = Boolean((import.meta as any)?.env?.DEV);
    const targetAdId = (adId && adId.trim()) ? adId : ADMOB_TEST_IDS.REWARDED;

    console.log(`[AdMob] Preparing Rewarded Ad unit: ${targetAdId} (testing: ${isDev})`);

    // Prepare the rewarded ad
    await AdMob.prepareRewardVideoAd({
      adId: targetAdId,
      isTesting: isDev || targetAdId === ADMOB_TEST_IDS.REWARDED,
    });

    console.log('[AdMob] Rewarded Ad loaded, presenting full-screen video...');
    const rewardItem: AdMobRewardItem = await AdMob.showRewardVideoAd();

    console.log('[AdMob] User earned reward:', rewardItem);
    return {
      success: true,
      rewarded: true,
      amount: rewardItem?.amount || 3,
      type: rewardItem?.type || 'chat_quota',
    };
  } catch (err: any) {
    console.warn('[AdMob] Rewarded ad warning or dismissed early:', err);
    return {
      success: false,
      rewarded: false,
      amount: 0,
      type: 'chat_quota',
      error: err?.message || 'Rewarded video ad dismissed or unavailable',
    };
  }
}

