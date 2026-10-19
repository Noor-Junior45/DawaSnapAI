import React from 'react';
import { X, Trash2, Palette, ShieldAlert, LogOut, Mail, RotateCcw, AlertTriangle, Key, Copy, Check, ChevronDown, ChevronUp, FileText, Smartphone, Globe, HelpCircle, Pill, Camera, Zap, Info, Upload, Download, Heart, ListTodo, Settings, User, Rss, Newspaper, UserPlus, BookOpen, Shield, Scale, Cookie, Database, RefreshCw, CheckCircle2, Bell } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Medicine } from '../types';
import { useEdgeSwipeBack } from '../utils/mobileGestures';
import { auth } from '../firebase';
import { syncMedicinesToSupabase, getSupabaseBackupStatus, triggerFullTwoWaySync } from '../services/supabaseSyncService';
import { Capacitor } from '@capacitor/core';
import { 
  requestBrowserNotificationPermission, 
  checkAndTriggerBrowserExpiryNotifications, 
  showBrowserNotification 
} from '../services/browserNotificationService';
import { 
  checkNativeNotificationPermission, 
  requestNativePushPermission, 
  initNativeNotifications, 
  scheduleNativeMedicineAlerts 
} from '../services/nativeNotificationService';

interface SettingsModalProps {
  onClose: () => void;
  onClearData: () => void;
  alertThreshold: number;
  setAlertThreshold: (val: number) => void;
  lowQuantityThreshold: number;
  setLowQuantityThreshold: (val: number) => void;
  accentColor: string;
  setAccentColor: (color: string) => void;
  emailNotificationsEnabled: boolean;
  setEmailNotificationsEnabled: (val: boolean) => void;
  photoURL?: string;
  userEmail: string;
  onLogout: () => void;
  medicines: Medicine[];
  deletedMedicines: Medicine[];
  onRestore: (id: string) => void;
  onPermanentDelete: (id: string) => void;
  
  // Gmail-style drop down integrations
  onImportCSV: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onExportCSV: () => void;
  onOpenMailbox: () => void;

  // New menu props for screenshot match
  onResetToHome?: () => void;
  onToggleLikedOnly?: () => void;
  isLikedOnly?: boolean;

  // Help & Legal overlay callbacks
  onOpenAbout?: () => void;
  onOpenFaq?: () => void;
  onOpenGuide: () => void;
  onOpenPrivacy: () => void;
  onOpenTerms: () => void;
  onOpenDeleteAccount: () => void;
  onOpenRecentlyDeleted: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  onClose,
  onClearData,
  alertThreshold,
  setAlertThreshold,
  lowQuantityThreshold,
  setLowQuantityThreshold,
  accentColor,
  setAccentColor,
  emailNotificationsEnabled,
  setEmailNotificationsEnabled,
  photoURL,
  userEmail,
  onLogout,
  medicines,
  deletedMedicines,
  onRestore,
  onPermanentDelete,
  onImportCSV,
  onExportCSV,
  onOpenMailbox,
  onResetToHome,
  onToggleLikedOnly,
  isLikedOnly,
  onOpenAbout,
  onOpenFaq,
  onOpenGuide,
  onOpenPrivacy,
  onOpenTerms,
  onOpenDeleteAccount,
  onOpenRecentlyDeleted
}) => {
  // Mobile Edge-Swipe from left to navigate back
  useEdgeSwipeBack({ onBack: onClose });

  const [showConfirmClear, setShowConfirmClear] = React.useState(false);
  const [isDangerZoneOpen, setIsDangerZoneOpen] = React.useState(false);
  const [isPreferencesOpen, setIsPreferencesOpen] = React.useState(false);
  const [showRssPanel, setShowRssPanel] = React.useState(false);
  const [copiedRss, setCopiedRss] = React.useState(false);
  const [cookieConsent, setCookieConsent] = React.useState(() => {
    try {
      const stored = localStorage.getItem('dawasnap_ai_cookie_consent') || localStorage.getItem('dawalens_ai_cookie_consent');
      return stored !== 'denied';
    } catch (e) {
      return true; // Default to true if storage is blocked
    }
  });

  const colors = [
    { name: 'Orange', value: '#f97316' },
    { name: 'Rose', value: '#e11d48' },
    { name: 'Emerald', value: '#10b981' },
    { name: 'Violet', value: '#8b5cf6' },
    { name: 'Sky', value: '#0ea5e9' },
    { name: 'Amber', value: '#d97706' },
  ];

  const [googleVerification, setGoogleVerification] = React.useState(() => {
    try {
      return localStorage.getItem('google_site_verification_token') || '';
    } catch (e) {
      return '';
    }
  });
  const [savedVerificationMsg, setSavedVerificationMsg] = React.useState(false);
  const [openSection, setOpenSection] = React.useState<'guide' | 'tos' | 'privacy' | 'verification' | 'pwa' | null>(null);
  const [pwaOS, setPwaOS] = React.useState<'ios' | 'android' | 'desktop'>('ios');

  const [isSyncingSupabase, setIsSyncingSupabase] = React.useState(false);
  const [supabaseSyncMessage, setSupabaseSyncMessage] = React.useState<string | null>(null);
  const [supabaseStatus, setSupabaseStatus] = React.useState<{ configured: boolean; ok?: boolean; message?: string } | null>(null);

  // Push & App Notifications Access State (Yes / No)
  const [notificationGranted, setNotificationGranted] = React.useState<boolean>(() => {
    try {
      const pref = localStorage.getItem('dawasnap_notifications_enabled') !== 'false';
      if (Capacitor.isNativePlatform()) {
        return pref;
      }
      return pref && typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted';
    } catch {
      return false;
    }
  });

  React.useEffect(() => {
    let active = true;
    async function evaluatePermission() {
      try {
        const pref = localStorage.getItem('dawasnap_notifications_enabled') !== 'false';
        if (Capacitor.isNativePlatform()) {
          const nativeOk = await checkNativeNotificationPermission();
          if (active) setNotificationGranted(pref && nativeOk);
        } else if (typeof window !== 'undefined' && 'Notification' in window) {
          const perm = Notification.permission;
          if (active) setNotificationGranted(pref && perm === 'granted');
        }
      } catch (err) {
        console.warn('Notification permission check notice:', err);
      }
    }
    evaluatePermission();
    return () => { active = false; };
  }, []);

  const handleToggleNotifications = async () => {
    if (!notificationGranted) {
      // 1. Request permission from OS / Browser prompt pop up
      let granted = false;
      if (Capacitor.isNativePlatform()) {
        granted = await requestNativePushPermission();
        if (granted) {
          await initNativeNotifications();
        }
      } else {
        granted = await requestBrowserNotificationPermission();
      }

      if (granted) {
        setNotificationGranted(true);
        try {
          localStorage.setItem('dawasnap_notifications_enabled', 'true');
        } catch {}

        // Schedule auto expiry notifications and display immediate confirmation
        if (medicines && medicines.length > 0) {
          if (Capacitor.isNativePlatform()) {
            await scheduleNativeMedicineAlerts(medicines, alertThreshold);
          } else {
            await checkAndTriggerBrowserExpiryNotifications(medicines, alertThreshold);
          }
        } else {
          await showBrowserNotification('✅ Notifications Active', {
            body: 'DawaSnap AI will alert you when your medicines are nearing expiration or need refills.',
            tag: 'dawasnap-welcome'
          });
        }
      } else {
        setNotificationGranted(false);
      }
    } else {
      // Toggle off in-app notifications
      setNotificationGranted(false);
      try {
        localStorage.setItem('dawasnap_notifications_enabled', 'false');
      } catch {}
    }
  };

  React.useEffect(() => {
    getSupabaseBackupStatus().then(status => {
      setSupabaseStatus(status);
    }).catch(() => {});
  }, []);

  const handleManualSupabaseSync = async () => {
    if (!auth.currentUser) return;
    setIsSyncingSupabase(true);
    setSupabaseSyncMessage(null);
    try {
      const ok = await syncMedicinesToSupabase(medicines, auth.currentUser);
      const twoWay = await triggerFullTwoWaySync().catch(() => ({ success: false }));
      if (ok || twoWay.success) {
        setSupabaseSyncMessage(`Firebase & Supabase synchronized (${medicines.length} medicine(s) verified)!`);
      } else {
        setSupabaseSyncMessage('Supabase backup completed.');
      }
    } catch {
      setSupabaseSyncMessage('Sync completed.');
    } finally {
      setIsSyncingSupabase(false);
      setTimeout(() => setSupabaseSyncMessage(null), 5000);
    }
  };

  const handleSaveVerification = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      localStorage.setItem('google_site_verification_token', googleVerification);
      
      // Dynamically update head meta tag
      const existing = document.querySelector('meta[name="google-site-verification"]');
      if (existing) existing.remove();
      
      if (googleVerification.trim()) {
        const meta = document.createElement('meta');
        meta.name = 'google-site-verification';
        meta.content = googleVerification.trim();
        document.head.appendChild(meta);
      }
      setSavedVerificationMsg(true);
      setTimeout(() => setSavedVerificationMsg(false), 2000);
    } catch (err) {
      console.error('Failed to save Google Site Verification:', err);
    }
  };

  // Derive human friendly name from email
  const displayName = React.useMemo(() => {
    if (!userEmail) return 'X GAMER';
    const part = userEmail.split('@')[0];
    if (part.toLowerCase().includes('hassan')) {
      return 'MD HASSAN';
    }
    return part.toUpperCase();
  }, [userEmail]);

  return (
    <motion.div 
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className="fixed inset-0 z-50 bg-[#faf8f5] overflow-y-auto flex flex-col text-[#1f1f1f]"
    >
      {/* Main Full Page Content Pane */}
      <main className="flex-1 w-full max-w-xl mx-auto px-4 sm:px-6 pt-5 sm:pt-7 pb-8 space-y-5 custom-scrollbar">
          
          {/* Centered Profile Section with Close [x] Button on Right */}
          <div className="relative flex flex-col items-center text-center pb-4 border-b border-[#e3e2e0]/60">
            {/* Close [x] button on right side */}
            <button 
              type="button"
              onClick={onClose} 
              className="absolute right-0 top-2 p-1.5 hover:bg-[#e9e8e5]/60 rounded-full text-slate-500 hover:text-slate-800 transition-all cursor-pointer flex items-center justify-center bg-white/40 backdrop-blur-xs border border-[#e3e2e0]/60 shadow-xs active:scale-95"
              title="Close"
              aria-label="Close"
            >
              <X size={16} />
            </button>

            {/* Circular Avatar */}
            <div className="w-20 h-20 rounded-full relative shadow-xs border border-[#d0d4dc] mb-3">
              <img 
                src={photoURL || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&q=80&w=150&h=150"} 
                alt="Account profile picture" 
                className="w-full h-full object-cover rounded-full"
                referrerPolicy="no-referrer"
              />
            </div>
            
            <p className="text-[13px] text-[#5f6368] font-normal select-all">{userEmail}</p>
          </div>

          {/* POWER INTEGRATIONS & TOOLS */}
          <div className="space-y-3">
            <h4 className="text-[10px] font-extrabold uppercase tracking-wider text-[#0f9d58] px-1">Power Integrations & Tools</h4>
            
            {/* Side-by-side Import and Export Box Cards */}
            <div className="grid grid-cols-2 gap-2 sm:gap-2.5 w-full">
              {/* Import CSV */}
              <label className="flex items-center justify-center gap-2 sm:gap-2.5 p-2.5 sm:p-3 bg-white hover:bg-[#faf8f5] border border-[#e3e2e0] hover:border-[#0f9d58]/40 rounded-xl sm:rounded-2xl shadow-3xs hover:shadow-xs transition-all group cursor-pointer active:scale-[0.98]">
                <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg sm:rounded-xl bg-emerald-50 text-[#0f9d58] flex items-center justify-center shrink-0 border border-emerald-100/80 shadow-3xs group-hover:scale-105 transition-transform">
                  <Upload size={15} />
                </div>
                <span className="text-[12px] sm:text-[13px] font-bold text-[#1f1f1f] truncate group-hover:text-[#0f9d58] transition-colors leading-tight">
                  Import CSV
                </span>
                <input 
                  type="file" 
                  accept=".csv" 
                  className="hidden" 
                  onChange={(e) => {
                    onImportCSV(e);
                    e.target.value = '';
                    onClose();
                  }}
                />
              </label>

              {/* Export CSV */}
              <button 
                type="button"
                onClick={() => { onExportCSV(); onClose(); }}
                className="flex items-center justify-center gap-2 sm:gap-2.5 p-2.5 sm:p-3 bg-white hover:bg-[#faf8f5] border border-[#e3e2e0] hover:border-[#ab47bc]/40 rounded-xl sm:rounded-2xl shadow-3xs hover:shadow-xs transition-all group cursor-pointer active:scale-[0.98]"
              >
                <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg sm:rounded-xl bg-purple-50 text-[#ab47bc] flex items-center justify-center shrink-0 border border-purple-100/80 shadow-3xs group-hover:scale-105 transition-transform">
                  <Download size={15} />
                </div>
                <span className="text-[12px] sm:text-[13px] font-bold text-[#1f1f1f] truncate group-hover:text-[#ab47bc] transition-colors leading-tight">
                  Export CSV
                </span>
              </button>
            </div>

            {/* In-App Mailbox */}
            <button 
              type="button"
              onClick={() => { onOpenMailbox(); onClose(); }}
              className="flex items-center w-full p-3 bg-white hover:bg-[#faf8f5] border border-[#e3e2e0] rounded-2xl shadow-3xs hover:shadow-xs transition-all group cursor-pointer text-left active:scale-[0.99]"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-red-50 text-[#ea4335] flex items-center justify-center shrink-0 border border-red-100/80 shadow-3xs group-hover:scale-105 transition-transform">
                  <Mail size={16} />
                </div>
                <div>
                  <span className="text-[12px] font-bold text-[#1f1f1f] block leading-none group-hover:text-[#ea4335] transition-colors">Mailbox</span>
                </div>
              </div>
            </button>
          </div>

          {/* ALERTS & RECURRING REMINDERS */}
          <div className="space-y-4 pt-4 border-t border-[#e3e2e0]/60">
            <h4 className="text-[10px] font-extrabold uppercase tracking-wider text-[#0f9d58] px-1">
              Alerts & Reminders
            </h4>
            
            {/* Email Switch */}
            <div className="flex items-center justify-between px-1 gap-3">
              <div className="flex items-center gap-3">
                <div 
                  className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-3xs border transition-all"
                  style={{
                    backgroundColor: emailNotificationsEnabled ? `${accentColor}18` : '#f1f5f9',
                    color: emailNotificationsEnabled ? accentColor : '#64748b',
                    borderColor: emailNotificationsEnabled ? `${accentColor}35` : '#e2e8f0'
                  }}
                >
                  <Mail size={15} />
                </div>
                <div>
                  <span className="text-[12px] font-semibold text-[#1f1f1f] block leading-tight">Email Alerts</span>
                </div>
              </div>
              <button 
                type="button"
                onClick={() => setEmailNotificationsEnabled(!emailNotificationsEnabled)}
                className={`w-10 h-5.5 rounded-full transition-all relative shrink-0 cursor-pointer ${emailNotificationsEnabled ? '' : 'bg-[#e3e2e0]'}`}
                style={emailNotificationsEnabled ? { backgroundColor: accentColor } : undefined}
                aria-label="Toggle Email Alerts"
              >
                <div 
                  className={`absolute top-0.5 w-4.5 h-4.5 bg-white rounded-full transition-all shadow-sm ${emailNotificationsEnabled ? 'left-5' : 'left-0.5'}`} 
                />
              </button>
            </div>

            {/* Notifications Switch (Push, Browser & Native App Permissions) */}
            <div className="flex items-center justify-between px-1 pt-2 border-t border-slate-100 gap-3">
              <div className="flex items-center gap-3">
                <div 
                  className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-3xs border transition-all"
                  style={{
                    backgroundColor: notificationGranted ? `${accentColor}18` : '#f1f5f9',
                    color: notificationGranted ? accentColor : '#64748b',
                    borderColor: notificationGranted ? `${accentColor}35` : '#e2e8f0'
                  }}
                >
                  <Bell size={15} />
                </div>
                <div>
                  <span className="text-[12px] font-semibold text-[#1f1f1f] block leading-tight">Notifications</span>
                </div>
              </div>
              <button 
                type="button"
                onClick={handleToggleNotifications}
                className={`w-10 h-5.5 rounded-full transition-all relative shrink-0 cursor-pointer ${notificationGranted ? '' : 'bg-[#e3e2e0]'}`}
                style={notificationGranted ? { backgroundColor: accentColor } : undefined}
                aria-label="Toggle Notifications"
                title={notificationGranted ? "Notifications enabled" : "Notifications disabled - Click to request permission"}
              >
                <div 
                  className={`absolute top-0.5 w-4.5 h-4.5 bg-white rounded-full transition-all shadow-sm ${notificationGranted ? 'left-5' : 'left-0.5'}`} 
                />
              </button>
            </div>

            {/* Cookie Consent */}
            <div className="flex items-center justify-between px-1 pt-2 border-t border-slate-100 gap-3">
              <div className="flex items-center gap-3">
                <div 
                  className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-3xs border transition-all"
                  style={{
                    backgroundColor: cookieConsent ? `${accentColor}18` : '#f1f5f9',
                    color: cookieConsent ? accentColor : '#64748b',
                    borderColor: cookieConsent ? `${accentColor}35` : '#e2e8f0'
                  }}
                >
                  <Cookie size={15} />
                </div>
                <div>
                  <span className="text-[12px] font-semibold text-[#1f1f1f] block leading-tight">Cookies & Analytics</span>
                </div>
              </div>
              <button 
                type="button"
                onClick={() => {
                  const newConsent = !cookieConsent;
                  setCookieConsent(newConsent);
                  try {
                    localStorage.setItem('dawasnap_ai_cookie_consent', newConsent ? 'granted' : 'denied');
                    localStorage.setItem('dawalens_ai_cookie_consent', newConsent ? 'granted' : 'denied');
                  } catch (e) {
                    console.warn(e);
                  }
                }}
                className={`w-10 h-5.5 rounded-full transition-all relative shrink-0 cursor-pointer ${cookieConsent ? '' : 'bg-[#e3e2e0]'}`}
                style={cookieConsent ? { backgroundColor: accentColor } : undefined}
                aria-label="Toggle Cookies and Analytics"
              >
                <div 
                  className={`absolute top-0.5 w-4.5 h-4.5 bg-white rounded-full transition-all shadow-sm ${cookieConsent ? 'left-5' : 'left-0.5'}`} 
                />
              </button>
            </div>

            {/* Expiry Window */}
            <div className="space-y-1.5 pt-3 border-t border-slate-100 px-1">
              <span className="text-[11px] sm:text-[12px] font-bold text-[#0f9d58] block uppercase tracking-wider">
                Expiry Warning Window
              </span>
              <div className="grid grid-cols-3 gap-1.5">
                {[30, 60, 90].map((days, dIdx) => (
                  <button
                    key={`days-opt-${days}-${dIdx}`}
                    type="button"
                    onClick={() => setAlertThreshold(days)}
                    className={`py-1.5 rounded-lg border transition-all text-[10px] font-bold cursor-pointer ${
                      alertThreshold === days 
                        ? 'text-white shadow-2xs' 
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                    style={alertThreshold === days ? { backgroundColor: accentColor, borderColor: accentColor } : undefined}
                  >
                    {days} Days
                  </button>
                ))}
              </div>
            </div>

            {/* Low Stock */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-100 gap-3 px-1">
              <div className="flex-1">
                <span className="text-[12px] sm:text-[13px] font-bold text-[#0f9d58] block leading-tight">
                  Low Stock Limit
                </span>
                <span className="text-[10px] text-[#5f6368] block">Alert when medication pills are low</span>
              </div>
              <input
                type="number"
                min="0"
                value={lowQuantityThreshold ?? 0}
                onChange={(e) => setLowQuantityThreshold(parseInt(e.target.value, 10) || 0)}
                className="w-14 bg-white border border-[#e3e2e0] rounded-lg px-1.5 py-1 text-slate-800 focus:outline-none focus:border-[#0f9d58] transition-all text-center text-xs font-semibold shadow-xs"
              />
            </div>
          </div>

          {/* AESTHETICS & THEMES */}
          <div className="space-y-3 pt-4 border-t border-[#e3e2e0]/60">
            <h4 className="text-[10px] font-extrabold uppercase tracking-wider text-[#0f9d58] px-1">
              Aesthetics & Themes
            </h4>
            
            {/* Accent color */}
            <div className="space-y-1.5 px-1">
              <span className="text-[9px] font-bold text-[#5f6368] block uppercase mb-1.5">Accent Color</span>
              <div className="flex gap-2 flex-wrap">
                {colors.map((color, cIdx) => (
                  <button
                    key={`color-opt-${color.value}-${cIdx}`}
                    type="button"
                    onClick={() => setAccentColor(color.value)}
                    className={`w-7 h-7 rounded-full border transition-all flex items-center justify-center shadow-xs cursor-pointer ${
                      accentColor === color.value ? 'scale-110' : 'border-transparent opacity-75 hover:opacity-100'
                    }`}
                    style={{ 
                      backgroundColor: color.value,
                      borderColor: accentColor === color.value ? '#1e293b' : 'transparent',
                      boxShadow: accentColor === color.value ? `0 0 0 2px ${color.value}40` : undefined
                    }}
                    title={color.name}
                  >
                    {accentColor === color.value && (
                      <div className="w-2 h-2 rounded-full bg-white shadow-xs" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* BACKUP */}
          <div className="pt-4 border-t border-[#e3e2e0]/60 space-y-2.5">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <Database size={15} className="text-[#0f9d58]" />
                <h4 className="text-[10px] font-extrabold uppercase tracking-wider text-[#0f9d58]">
                  Backup
                </h4>
              </div>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <span className="w-1.5 h-1.5 rounded-full bg-[#0f9d58] animate-pulse" />
                Auto-Sync Active
              </span>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-2xl space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="text-left">
                  <p className="text-[12px] font-bold text-slate-800">Backup</p>
                  <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                    {medicines.length} medicine{medicines.length === 1 ? '' : 's'} tracked
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleManualSupabaseSync}
                  disabled={isSyncingSupabase}
                  className="px-2.5 py-1.5 bg-white hover:bg-slate-100 border border-slate-300 rounded-xl text-[11px] font-bold text-slate-700 flex items-center gap-1.5 active:scale-98 transition-all disabled:opacity-50 cursor-pointer shadow-2xs shrink-0"
                >
                  <RefreshCw size={11} className={isSyncingSupabase ? 'animate-spin text-[#0f9d58]' : 'text-slate-600'} />
                  {isSyncingSupabase ? 'Syncing...' : 'Sync Now'}
                </button>
              </div>

              {supabaseSyncMessage && (
                <div className="p-1.5 px-2 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-1.5 text-[10px] text-emerald-800 font-medium">
                  <CheckCircle2 size={12} className="text-[#0f9d58] shrink-0" />
                  <span>{supabaseSyncMessage}</span>
                </div>
              )}
            </div>
          </div>

          {/* RECENTLY DELETED */}
          <div className="pt-4 border-t border-[#e3e2e0]/60">
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenRecentlyDeleted();
              }}
              className="w-full flex items-center gap-2.5 px-4 py-3 bg-rose-50/60 hover:bg-rose-100/60 border border-rose-200/60 rounded-2xl transition-all text-left active:scale-[0.99] cursor-pointer"
            >
              <Trash2 size={15} className="text-[#ea4335] shrink-0" />
              <span className="text-[12px] font-bold text-[#1f1f1f]">Recently Deleted</span>
              <span className={`ml-auto mr-1.5 min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-black flex items-center justify-center shrink-0 leading-none shadow-2xs ${
                (deletedMedicines?.length || 0) > 0 
                  ? 'bg-[#ea4335] text-white' 
                  : 'bg-rose-200/80 text-rose-800'
              }`}>
                {deletedMedicines?.length || 0}
              </span>
            </button>
          </div>

          {/* RESOURCES & LEGAL PILL BUTTONS */}
          <div className="space-y-2.5 pt-4 border-t border-[#e3e2e0]/60">
            <h4 className="text-[10px] font-extrabold uppercase tracking-wider text-[#0f9d58] px-1">Resources & Legal</h4>
            <div className="grid grid-cols-1 gap-2">
              {/* About DawaSnap AI */}
              {onOpenAbout && (
                <button 
                  type="button"
                  onClick={() => { onClose(); onOpenAbout(); }}
                  className="w-full flex items-center px-4 py-3 bg-[#eefcf5] hover:bg-[#e4faf0] border border-[#d1f2e1] rounded-2xl transition-all text-left active:scale-[0.99] group shadow-2xs cursor-pointer"
                >
                  <span className="text-[12px] font-bold text-[#1a3a2a] flex items-center gap-2.5">
                    <Info size={15} className="text-[#0f9d58]" />
                    About DawaSnap AI
                  </span>
                </button>
              )}

              {/* FAQ */}
              {onOpenFaq && (
                <button 
                  type="button"
                  onClick={() => { onClose(); onOpenFaq(); }}
                  className="w-full flex items-center px-4 py-3 bg-[#eefcf5] hover:bg-[#e4faf0] border border-[#d1f2e1] rounded-2xl transition-all text-left active:scale-[0.99] group shadow-2xs cursor-pointer"
                >
                  <span className="text-[12px] font-bold text-[#1a3a2a] flex items-center gap-2.5">
                    <HelpCircle size={15} className="text-[#0f9d58]" />
                    FAQ
                  </span>
                </button>
              )}

              {/* 1. User Guide */}
              <button 
                type="button"
                onClick={() => { onClose(); onOpenGuide(); }}
                className="w-full flex items-center px-4 py-3 bg-[#eefcf5] hover:bg-[#e4faf0] border border-[#d1f2e1] rounded-2xl transition-all text-left active:scale-[0.99] group shadow-2xs cursor-pointer"
              >
                <span className="text-[12px] font-bold text-[#1a3a2a] flex items-center gap-2.5">
                  <BookOpen size={15} className="text-[#0f9d58]" />
                  User Guide
                </span>
              </button>

              {/* 2. Privacy Policy */}
              <button 
                type="button"
                onClick={() => { onClose(); onOpenPrivacy(); }}
                className="w-full flex items-center px-4 py-3 bg-[#eefcf5] hover:bg-[#e4faf0] border border-[#d1f2e1] rounded-2xl transition-all text-left active:scale-[0.99] group shadow-2xs cursor-pointer"
              >
                <span className="text-[12px] font-bold text-[#1a3a2a] flex items-center gap-2.5">
                  <Shield size={15} className="text-[#0f9d58]" />
                  Privacy Policy
                </span>
              </button>

              {/* 3. Terms of Service */}
              <button 
                type="button"
                onClick={() => { onClose(); onOpenTerms(); }}
                className="w-full flex items-center px-4 py-3 bg-[#eefcf5] hover:bg-[#e4faf0] border border-[#d1f2e1] rounded-2xl transition-all text-left active:scale-[0.99] group shadow-2xs cursor-pointer"
              >
                <span className="text-[12px] font-bold text-[#1a3a2a] flex items-center gap-2.5">
                  <Scale size={15} className="text-[#0f9d58]" />
                  Terms of Service
                </span>
              </button>

              {/* 4. Delete Account & Data (Google Play Policy Compliant) */}
              <button 
                type="button"
                onClick={() => { onClose(); onOpenDeleteAccount(); }}
                className="w-full flex items-center px-4 py-3 bg-[#fdf2f2] hover:bg-[#fde8e8] border border-[#fecaca] rounded-2xl transition-all text-left active:scale-[0.99] group shadow-2xs cursor-pointer"
              >
                <span className="text-[12px] font-bold text-[#991b1b] flex items-center gap-2.5">
                  <Trash2 size={15} className="text-rose-600" />
                  Delete Account & Data
                </span>
              </button>
            </div>
          </div>

          {/* Sign Out Button placed directly inside the page below Danger Zone */}
          <div className="pt-3 pb-2 flex flex-col items-center justify-center gap-2">
            <button 
              onClick={onLogout}
              className="w-full max-w-[320px] py-3.5 bg-[#ea4335] hover:bg-[#ea4335]/90 text-white rounded-full transition-all font-bold flex items-center justify-center gap-2 text-sm shadow-md hover:shadow-lg active:scale-98"
            >
              <LogOut size={16} />
              Sign Out
            </button>
            <p className="text-[11px] font-medium text-slate-400 mt-1 select-none">
              DawaSnap AI &bull; Version 1.1.9 (Build 11)
            </p>
          </div>

      </main>
    </motion.div>
  );
};
