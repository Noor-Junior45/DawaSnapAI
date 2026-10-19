import React, { useState } from 'react';
import { 
  ChevronLeft, 
  Trash2, 
  Mail, 
  AlertTriangle, 
  CheckCircle2, 
  Database, 
  UserX, 
  Send, 
  Loader2, 
  LogIn
} from 'lucide-react';
import { useEdgeSwipeBack } from '../utils/mobileGestures';
import { triggerLightHaptic, triggerSuccessHaptic } from '../utils/haptics';
import { signInWithGoogleAdaptive } from '../services/nativeAuthService';
import { getApiUrl } from '../utils/apiConfig';

interface AccountDeletionPageProps {
  onBack: () => void;
  user?: { uid: string; email?: string | null; displayName?: string | null } | null;
  onExecuteAccountDeletion?: () => Promise<void>;
}

export const AccountDeletionPage: React.FC<AccountDeletionPageProps> = ({ 
  onBack, 
  user,
  onExecuteAccountDeletion
}) => {
  useEdgeSwipeBack({ onBack });

  // State for logged-in deletion confirmation
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteSuccess, setDeleteSuccess] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // State for signing in on this page
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);

  // State for external / web deletion request form
  const [requestEmail, setRequestEmail] = useState('');
  const [requestReason, setRequestReason] = useState('No longer using the application');
  const [requestConfirmed, setRequestConfirmed] = useState(false);
  const [isSubmittingForm, setIsSubmittingForm] = useState(false);
  const [submissionReference, setSubmissionReference] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSignInOnPage = async () => {
    setIsSigningIn(true);
    setSignInError(null);
    try {
      await signInWithGoogleAdaptive();
      triggerSuccessHaptic();
    } catch (err: any) {
      console.error('Sign-in on deletion page failed:', err);
      setSignInError(err?.message || 'Failed to sign in. Please use the web deletion request below.');
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleInAppDelete = async () => {
    if (!onExecuteAccountDeletion) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await onExecuteAccountDeletion();
      setDeleteSuccess(true);
      setShowConfirmModal(false);
      triggerSuccessHaptic();
    } catch (err: any) {
      console.error('Account deletion failed:', err);
      setDeleteError(err.message || 'Failed to complete account deletion. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleWebFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requestEmail.trim() || !requestConfirmed) return;

    setIsSubmittingForm(true);
    setFormError(null);

    try {
      const response = await fetch(getApiUrl('/api/account/deletion-request'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: requestEmail.trim(),
          reason: requestReason,
          confirmed: true
        })
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to record deletion request.');
      }

      setSubmissionReference(data.referenceId || `DEL-${Date.now().toString(36).toUpperCase()}`);
      triggerSuccessHaptic();
    } catch (err: any) {
      console.error('Web deletion form submission error:', err);
      setFormError(err.message || 'Server unavailable. Please try again shortly.');
    } finally {
      setIsSubmittingForm(false);
    }
  };

  const dataRetentionItems = [
    {
      category: 'Auth & Profile',
      description: 'Account UID, email, name, photo',
      action: 'Deleted immediately',
      isImmediate: true
    },
    {
      category: 'Medication Vault',
      description: 'Medicines, dosages, forms, stock, schedule',
      action: 'Deleted immediately',
      isImmediate: true
    },
    {
      category: 'Dose History & Logs',
      description: 'Taken, skipped, and snoozed history logs',
      action: 'Deleted immediately',
      isImmediate: true
    },
    {
      category: 'AI Consultations',
      description: 'Chat messages and pharmacist consultations',
      action: 'Deleted immediately',
      isImmediate: true
    },
    {
      category: 'Device Tokens & Cache',
      description: 'Push notification tokens, offline database',
      action: 'Deleted immediately',
      isImmediate: true
    },
    {
      category: 'System Logs & Backups',
      description: 'Aggregated anti-abuse logs (no health data)',
      action: 'Purged in 14–30 days',
      isImmediate: false
    }
  ];

  return (
    <div className="min-h-screen bg-[#faf8f5] text-slate-900 font-sans selection:bg-rose-500 selection:text-white flex flex-col">
      {/* Phone-optimized Clean Header */}
      <header className="sticky top-0 z-30 bg-[#faf8f5]/95 backdrop-blur-md border-b border-stone-200/80 px-4 py-3">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => {
                triggerLightHaptic();
                onBack();
              }}
              className="p-2 -ml-2 hover:bg-stone-200/60 rounded-full transition-colors text-slate-700 active:scale-95 cursor-pointer"
              title="Back"
              aria-label="Back"
            >
              <ChevronLeft size={22} />
            </button>
            <h1 className="text-base font-bold text-slate-900 tracking-tight">
              Delete Account &amp; Data
            </h1>
          </div>
        </div>
      </header>

      {/* Main Content: Phone Screen Layout (Clean, Minimalist, Less Box Design) */}
      <main className="flex-1 max-w-md mx-auto w-full px-4 py-5 space-y-7 pb-12">

        {/* 1. Direct Self-Service Deletion */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <UserX size={18} className="text-rose-600 shrink-0" />
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
              Direct Self-Service Deletion
            </h2>
          </div>
          
          <p className="text-xs text-slate-500 leading-relaxed">
            Immediately and permanently delete your account, saved medications, dose history, and notification schedules.
          </p>

          {deleteSuccess ? (
            <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200/80 text-emerald-900 space-y-1.5">
              <div className="flex items-center gap-2 font-bold text-xs">
                <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                Account &amp; Data Permanently Deleted
              </div>
              <p className="text-[11px] text-emerald-700 leading-relaxed">
                Your cloud vault and credentials have been erased. You can now safely close the app or uninstall it.
              </p>
            </div>
          ) : user ? (
            <div className="space-y-3 pt-1">
              <div className="flex items-center justify-between py-2 border-b border-stone-200">
                <div className="min-w-0 pr-3">
                  <div className="text-[11px] text-slate-500">Currently signed in as:</div>
                  <div className="text-xs font-semibold text-slate-800 truncate">
                    {user.email || user.uid}
                  </div>
                </div>
              </div>

              {deleteError && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg text-xs">
                  {deleteError}
                </div>
              )}

              <button
                onClick={() => {
                  triggerLightHaptic();
                  setShowConfirmModal(true);
                }}
                className="w-full h-11 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer shadow-xs active:scale-[0.99]"
              >
                <Trash2 size={15} />
                Delete My Account Now
              </button>
            </div>
          ) : (
            <div className="space-y-3 pt-1">
              <p className="text-xs text-slate-600">
                Sign in with Google to immediately authenticate and delete your account:
              </p>
              
              {signInError && (
                <div className="p-2.5 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg text-xs">
                  {signInError}
                </div>
              )}

              <button
                onClick={handleSignInOnPage}
                disabled={isSigningIn}
                className="w-full h-11 bg-slate-900 hover:bg-slate-800 active:bg-black text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer shadow-xs disabled:opacity-50 active:scale-[0.99]"
              >
                {isSigningIn ? <Loader2 size={15} className="animate-spin" /> : <LogIn size={15} />}
                Sign In with Google to Delete Account
              </button>
            </div>
          )}
        </section>

        {/* Subtle Divider */}
        <div className="h-px bg-stone-200" />

        {/* 2. Data Deletion & Retention Breakdown Box */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Database size={18} className="text-[#0f9d58] shrink-0" />
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
              Data Deletion &amp; Retention Breakdown
            </h2>
          </div>

          <p className="text-xs text-slate-500 leading-relaxed">
            Overview of how your personal health data is processed and permanently purged upon deletion:
          </p>

          {/* Clean phone-friendly item list (no overflowing desktop table) */}
          <div className="divide-y divide-stone-200/80 pt-1">
            {dataRetentionItems.map((item, idx) => (
              <div key={idx} className="py-2.5 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-slate-800">
                    {item.category}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                    {item.description}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <span className={`text-[11px] font-bold ${item.isImmediate ? 'text-rose-600' : 'text-amber-700'}`}>
                    {item.action}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Subtle Divider */}
        <div className="h-px bg-stone-200" />

        {/* 3. Web Deletion Request (Without App Installed) */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Mail size={18} className="text-slate-700 shrink-0" />
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
              Web Deletion Request
            </h2>
          </div>

          <p className="text-xs text-slate-500 leading-relaxed">
            If you uninstalled the app or cannot sign in with Google, submit this request. We will verify and purge all records within 7 business days.
          </p>

          {submissionReference ? (
            <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200/80 text-emerald-900 space-y-1.5">
              <div className="flex items-center gap-2 font-bold text-xs">
                <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                Request Registered Successfully
              </div>
              <p className="text-[11px] text-emerald-800">
                Reference ID: <strong className="font-mono bg-white px-1.5 py-0.5 rounded border border-emerald-300">{submissionReference}</strong>
              </p>
              <p className="text-[11px] text-emerald-700">
                All records associated with this email will be purged within 7 business days.
              </p>
            </div>
          ) : (
            <form onSubmit={handleWebFormSubmit} className="space-y-3.5 pt-1">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Registered Email Address *
                </label>
                <input
                  type="email"
                  required
                  value={requestEmail}
                  onChange={(e) => setRequestEmail(e.target.value)}
                  placeholder="yourname@gmail.com"
                  className="w-full h-11 px-3.5 rounded-xl border border-stone-300 bg-white text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0f9d58]/30 focus:border-[#0f9d58]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Reason for Deletion (Optional)
                </label>
                <select
                  value={requestReason}
                  onChange={(e) => setRequestReason(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-xl border border-stone-300 bg-white text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#0f9d58]/30 focus:border-[#0f9d58]"
                >
                  <option value="No longer using the application">No longer using the application</option>
                  <option value="Privacy concerns">Privacy concerns</option>
                  <option value="Switching medication management method">Switching medication management method</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div className="flex items-start gap-2.5 pt-0.5">
                <input
                  type="checkbox"
                  id="confirm-web-delete"
                  checked={requestConfirmed}
                  onChange={(e) => setRequestConfirmed(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-stone-300 text-[#0f9d58] focus:ring-[#0f9d58]"
                  required
                />
                <label htmlFor="confirm-web-delete" className="text-xs text-slate-600 leading-snug cursor-pointer">
                  I confirm that this action is irreversible and will permanently delete my medication records and profile.
                </label>
              </div>

              {formError && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg text-xs">
                  {formError}
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmittingForm || !requestConfirmed || !requestEmail}
                className="w-full h-11 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer shadow-xs disabled:opacity-50 active:scale-[0.99]"
              >
                {isSubmittingForm ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                Submit Web Deletion Request
              </button>
            </form>
          )}
        </section>

      </main>

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-3 sm:p-4">
          <div className="bg-white rounded-2xl p-5 max-w-sm w-full border border-stone-200 shadow-2xl space-y-4 animate-in fade-in duration-150">
            <div className="w-11 h-11 rounded-full bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center mx-auto">
              <AlertTriangle size={22} />
            </div>
            
            <div className="text-center space-y-1">
              <h3 className="text-sm font-bold text-slate-900">Confirm Irreversible Deletion</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Type <strong className="text-rose-600 font-mono">DELETE</strong> below to permanently erase your account and all medication vault records.
              </p>
            </div>

            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="Type DELETE"
              className="w-full h-11 border border-stone-300 rounded-xl text-center font-mono font-bold text-sm text-slate-900 uppercase focus:outline-none focus:ring-2 focus:ring-rose-500/30"
              autoFocus
            />

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => {
                  setShowConfirmModal(false);
                  setConfirmText('');
                }}
                disabled={isDeleting}
                className="flex-1 h-11 bg-stone-100 hover:bg-stone-200 active:bg-stone-300 text-slate-700 text-xs font-bold rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleInAppDelete}
                disabled={confirmText !== 'DELETE' || isDeleting}
                className="flex-1 h-11 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white text-xs font-bold rounded-xl transition-all shadow-xs disabled:opacity-40 cursor-pointer flex items-center justify-center gap-1.5"
              >
                {isDeleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
