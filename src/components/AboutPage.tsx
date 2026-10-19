import React from 'react';
import { ChevronLeft, Shield, Globe, Award, Sparkles, HeartPulse, CheckCircle2, Mail, ExternalLink, BookOpen, Scale, FileText } from 'lucide-react';
import { useEdgeSwipeBack } from '../utils/mobileGestures';
import { triggerLightHaptic } from '../utils/haptics';

interface AboutPageProps {
  onBack: () => void;
  isLoggedIn?: boolean;
}

export const AboutPage: React.FC<AboutPageProps> = ({ onBack, isLoggedIn = false }) => {
  useEdgeSwipeBack({ onBack });

  return (
    <div className="min-h-screen bg-[#faf8f5] text-[#1f1f1f] font-sans antialiased selection:bg-[#0f9d58] selection:text-white">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-[#e3e2e0] shadow-2xs px-4 sm:px-6 py-3.5">
        <div className="max-w-4xl mx-auto flex items-center">
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => {
                triggerLightHaptic();
                onBack();
              }}
              className="p-2 -ml-2 hover:bg-slate-100 rounded-full transition-colors text-slate-700 active:scale-95 cursor-pointer"
              aria-label="Go back"
              title="Back"
            >
              <ChevronLeft size={22} />
            </button>
            <h1 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
              About DawaSnap AI
            </h1>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-10 sm:py-14 space-y-10">
        {/* Hero Banner */}
        <div className="bg-gradient-to-br from-[#e6f4ea] via-white to-[#f0f9f4] border border-[#ceead6] rounded-3xl p-6 sm:p-10 shadow-sm relative overflow-hidden">
          <div className="relative z-10 space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/90 border border-[#a8dab5] text-[#0f9d58] text-xs font-extrabold tracking-wide">
              <Sparkles size={14} />
              <span>Official About & Brand Overview</span>
            </div>
            <h1 className="text-2xl sm:text-4xl font-extrabold text-slate-900 tracking-tight leading-tight">
              About DawaSnap AI
            </h1>
            <p className="text-sm sm:text-base text-slate-600 max-w-2xl leading-relaxed">
              <strong>DawaSnap AI</strong> (also indexed as DawaLens AI) is a high-precision, privacy-first medication management suite. We combine on-device camera OCR recognition, Gemini vision intelligence, automated expiration tracking, and multi-batch pharmacy inventory to prevent adverse drug events and safeguard personal and community health.
            </p>
          </div>
        </div>

        {/* Brand Recognition & Connected Domains */}
        <section id="connected-domains" className="bg-white border border-[#e3e2e0] rounded-3xl p-6 sm:p-8 space-y-5 shadow-2xs">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-[#e6f4ea] text-[#0f9d58]">
              <Globe size={22} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 tracking-tight">Official Connected Domains &amp; Mirrors</h2>
              <p className="text-xs text-slate-500">All following domains are verified, official deployments of the same unified platform:</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <a
              href="https://noorpos.in"
              target="_blank"
              rel="noopener noreferrer"
              className="p-4 rounded-2xl border border-[#ceead6] bg-[#f8fcf9] hover:border-[#0f9d58] transition-all flex items-center justify-between group"
            >
              <div>
                <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wider block">Primary Production Domain</span>
                <span className="font-extrabold text-sm text-slate-900 group-hover:text-[#0f9d58] transition-colors">noorpos.in</span>
              </div>
              <ExternalLink size={16} className="text-slate-400 group-hover:text-[#0f9d58]" />
            </a>

            <a
              href="https://dawasnap.cloud.run"
              target="_blank"
              rel="noopener noreferrer"
              className="p-4 rounded-2xl border border-slate-200 bg-slate-50/60 hover:border-[#0f9d58] transition-all flex items-center justify-between group"
            >
              <div>
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Google Cloud Run Service</span>
                <span className="font-extrabold text-sm text-slate-900 group-hover:text-[#0f9d58] transition-colors">dawasnap.cloud.run</span>
              </div>
              <ExternalLink size={16} className="text-slate-400 group-hover:text-[#0f9d58]" />
            </a>

            <a
              href="https://dawalens.cloud.run"
              target="_blank"
              rel="noopener noreferrer"
              className="p-4 rounded-2xl border border-slate-200 bg-slate-50/60 hover:border-[#0f9d58] transition-all flex items-center justify-between group"
            >
              <div>
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Google Cloud Run Alias</span>
                <span className="font-extrabold text-sm text-slate-900 group-hover:text-[#0f9d58] transition-colors">dawalens.cloud.run</span>
              </div>
              <ExternalLink size={16} className="text-slate-400 group-hover:text-[#0f9d58]" />
            </a>

            <a
              href="https://dawasnap.vercel.app"
              target="_blank"
              rel="noopener noreferrer"
              className="p-4 rounded-2xl border border-slate-200 bg-slate-50/60 hover:border-[#0f9d58] transition-all flex items-center justify-between group"
            >
              <div>
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Vercel Global Edge Mirror</span>
                <span className="font-extrabold text-sm text-slate-900 group-hover:text-[#0f9d58] transition-colors">dawasnap.vercel.app</span>
              </div>
              <ExternalLink size={16} className="text-slate-400 group-hover:text-[#0f9d58]" />
            </a>

            <a
              href="https://dawalens.vercel.app"
              target="_blank"
              rel="noopener noreferrer"
              className="p-4 rounded-2xl border border-slate-200 bg-slate-50/60 hover:border-[#0f9d58] transition-all flex items-center justify-between group sm:col-span-2"
            >
              <div>
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Vercel Secondary Alias</span>
                <span className="font-extrabold text-sm text-slate-900 group-hover:text-[#0f9d58] transition-colors">dawalens.vercel.app</span>
              </div>
              <ExternalLink size={16} className="text-slate-400 group-hover:text-[#0f9d58]" />
            </a>
          </div>
        </section>

        {/* Core Pillars */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div className="bg-white border border-[#e3e2e0] rounded-2xl p-6 space-y-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
              <Sparkles size={20} />
            </div>
            <h3 className="font-bold text-base text-slate-900">Instant AI Camera OCR</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Scan medicine blister packs, syrup bottles, pill boxes, or handwritten doctor prescriptions. Extracts brand name, generic composition, dosage, and expiry dates automatically.
            </p>
          </div>

          <div className="bg-white border border-[#e3e2e0] rounded-2xl p-6 space-y-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
              <HeartPulse size={20} />
            </div>
            <h3 className="font-bold text-base text-slate-900">Drug Interaction Safety</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Clinical-grade cross-verification of medications to warn you immediately against hazardous drug-to-drug interactions, duplicate therapies, or dangerous ingredient conflicts.
            </p>
          </div>

          <div className="bg-white border border-[#e3e2e0] rounded-2xl p-6 space-y-3">
            <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center font-bold">
              <Shield size={20} />
            </div>
            <h3 className="font-bold text-base text-slate-900">Zero-Telemetry Privacy</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              All scans are processed with full adherence to GDPR, Google Play Data Safety, and DPDP Act 2023. No medical images or personal identifiers are stored without explicit user consent.
            </p>
          </div>
        </section>

        {/* Developer & Legal Entity */}
        <section className="bg-white border border-[#e3e2e0] rounded-3xl p-6 sm:p-8 space-y-5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-amber-50 text-amber-600">
              <Award size={22} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 tracking-tight">Publisher &amp; Leadership</h2>
              <p className="text-xs text-slate-500">Engineering and healthcare safety compliance details</p>
            </div>
          </div>

          <div className="space-y-4 text-xs sm:text-sm text-slate-600 leading-relaxed">
            <p>
              DawaSnap AI is developed and maintained by <strong>DawaSnap (MD Noor Hassan)</strong>.
              Designed in collaboration with practicing pharmacists, the platform serves thousands of individual patients, caregivers, and local pharmacy owners across India and internationally.
            </p>
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <span className="font-bold text-slate-900 block">Lead Engineer &amp; Contact:</span>
                <span className="text-slate-600 text-xs">MD Noor Hassan &bull; DawaSnap</span>
              </div>
              <a
                href="mailto:newluckypharmacy@gmail.com"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-slate-300 text-slate-700 hover:text-[#0f9d58] font-bold text-xs transition-colors self-start sm:self-auto"
              >
                <Mail size={14} />
                <span>newluckypharmacy@gmail.com</span>
              </a>
            </div>
          </div>
        </section>

        {/* Quick Sitelink Navigation */}
        <section className="bg-white border border-[#e3e2e0] rounded-3xl p-6 sm:p-8 space-y-4">
          <h2 className="text-lg font-bold text-slate-900 tracking-tight">Explore Key Sections &amp; Documentation</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            <a
              href="/?page=guide"
              className="p-3.5 rounded-2xl border border-slate-200 hover:border-[#0f9d58] hover:bg-emerald-50/30 transition-all flex items-center gap-2.5 text-xs font-bold text-slate-800"
            >
              <BookOpen size={16} className="text-[#0f9d58]" />
              <span>User Guide &amp; Docs</span>
            </a>
            <a
              href="/?page=faq"
              className="p-3.5 rounded-2xl border border-slate-200 hover:border-[#0f9d58] hover:bg-emerald-50/30 transition-all flex items-center gap-2.5 text-xs font-bold text-slate-800"
            >
              <FileText size={16} className="text-[#0f9d58]" />
              <span>Frequently Asked Questions</span>
            </a>
            <a
              href="/?page=privacy"
              className="p-3.5 rounded-2xl border border-slate-200 hover:border-[#0f9d58] hover:bg-emerald-50/30 transition-all flex items-center gap-2.5 text-xs font-bold text-slate-800"
            >
              <Shield size={16} className="text-[#0f9d58]" />
              <span>Privacy Policy</span>
            </a>
            <a
              href="/?page=terms"
              className="p-3.5 rounded-2xl border border-slate-200 hover:border-[#0f9d58] hover:bg-emerald-50/30 transition-all flex items-center gap-2.5 text-xs font-bold text-slate-800"
            >
              <Scale size={16} className="text-[#0f9d58]" />
              <span>Terms of Service</span>
            </a>
            <a
              href="/?page=delete-account"
              className="p-3.5 rounded-2xl border border-slate-200 hover:border-rose-400 hover:bg-rose-50/30 transition-all flex items-center gap-2.5 text-xs font-bold text-slate-800"
            >
              <CheckCircle2 size={16} className="text-rose-500" />
              <span>Account Deletion Portal</span>
            </a>
            <a
              href="/"
              onClick={(e) => { e.preventDefault(); onBack(); }}
              className="p-3.5 rounded-2xl border border-[#0f9d58] bg-[#e6f4ea] text-[#0f9d58] hover:bg-[#d6f0df] transition-all flex items-center gap-2.5 text-xs font-extrabold cursor-pointer"
            >
              <Sparkles size={16} />
              <span>Open Medicine Vault</span>
            </a>
          </div>
        </section>

        {/* Disclaimer */}
        <p className="text-center text-[11px] text-slate-500 leading-normal max-w-xl mx-auto">
          Medical Disclaimer: DawaSnap AI is designed for organizational, inventory, and informational tracking purposes only. It is not a substitute for professional medical diagnosis or clinical healthcare consultation. Always consult a certified physician or pharmacist before taking medications.
        </p>
      </main>
    </div>
  );
};
