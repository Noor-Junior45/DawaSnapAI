import React, { useState } from 'react';
import { ChevronLeft, ChevronDown, HelpCircle, Sparkles, Shield, BookOpen, Scale, Mail } from 'lucide-react';
import { useEdgeSwipeBack } from '../utils/mobileGestures';
import { triggerLightHaptic } from '../utils/haptics';

interface FaqPageProps {
  onBack: () => void;
  isLoggedIn?: boolean;
}

export const FaqPage: React.FC<FaqPageProps> = ({ onBack, isLoggedIn = false }) => {
  useEdgeSwipeBack({ onBack });
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  const faqs = [
    {
      q: 'What is DawaSnap AI (and is it also searchable as DawaLens AI)?',
      a: 'DawaSnap AI (also indexed and searchable as DawaLens AI / DawaLens) is an intelligent medicine management system. It uses smartphone and web cameras combined with vision AI (Gemini 2.5) to instantly identify pills, analyze medicine packaging/blister strips, log active ingredients, calculate expiration countdowns, and verify drug-to-drug interactions.'
    },
    {
      q: 'Which domains are official for DawaSnap AI?',
      a: 'Our primary web application domain is noorpos.in. Mirror and secondary official domains include dawasnap.cloud.run, dawalens.cloud.run, dawasnap.vercel.app, and dawalens.vercel.app. All domains are synchronized, verified, and safe to use.'
    },
    {
      q: 'How does the AI medicine and expiry date scanner work?',
      a: 'Simply tap the camera icon in the app and snap a photo of any medicine packaging, bottle label, blister foil, or doctor prescription. The on-device OCR and Gemini vision engine instantly extracts the brand name, salt/chemical composition, dosage (e.g., 500mg), manufacturer, and expiration date (e.g., EXP 10/2027).'
    },
    {
      q: 'How does the app protect my private health information?',
      a: 'Privacy and data sovereignty are fundamental to our architecture. We strictly comply with GDPR, the Indian Digital Personal Data Protection (DPDP) Act 2023, and Google Play Data Safety policies. All Personally Identifiable Information (PII) is stripped prior to AI processing, images are kept client-side by default, and communications are encrypted via SSL/TLS.'
    },
    {
      q: 'How do expiration alerts work?',
      a: 'Once a medicine is saved to your vault, DawaSnap AI continuously tracks its expiration timeline. You receive color-coded badges (Green = Safe, Amber = Expiring within 30 days, Red = Expired) along with browser push notifications, local Android alerts, and automated scheduled daily email checks.'
    },
    {
      q: 'How does multi-batch inventory tracking work?',
      a: 'Unlike basic pill reminder apps, DawaSnap AI supports multi-batch medicine tracking. If you buy multiple packages of Paracetamol with different batch numbers, manufacturing dates, and expiry dates, you can track each batch independently under the same medication group.'
    },
    {
      q: 'Can I export my medicines to Google Sheets or CSV?',
      a: 'Yes! DawaSnap AI includes one-click export to standard CSV spreadsheets and direct real-time synchronization with Google Sheets via secure Google OAuth integration.'
    },
    {
      q: 'Is DawaSnap AI free to use?',
      a: 'Yes, DawaSnap AI is free to use for patients, caregivers, and pharmacies. Standard medication tracking, camera OCR scanning, and expiration alerts are included at no cost.'
    },
    {
      q: 'Who develops DawaSnap AI and how do I contact support?',
      a: 'DawaSnap AI is engineered by DawaSnap (MD Noor Hassan). If you have questions, feedback, or need pharmacy partnership support, you can reach the engineering team directly at newluckypharmacy@gmail.com.'
    }
  ];

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
              FAQ
            </h1>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-10 sm:py-14 space-y-10">
        {/* Banner */}
        <div className="bg-gradient-to-br from-[#e6f4ea] via-white to-[#f0f9f4] border border-[#ceead6] rounded-3xl p-6 sm:p-10 shadow-sm relative overflow-hidden">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/90 border border-[#a8dab5] text-[#0f9d58] text-xs font-extrabold tracking-wide">
              <HelpCircle size={14} />
              <span>Support &amp; Answers</span>
            </div>
            <h1 className="text-2xl sm:text-4xl font-extrabold text-slate-900 tracking-tight leading-tight">
              Frequently Asked Questions (FAQ)
            </h1>
            <p className="text-sm sm:text-base text-slate-600 max-w-2xl leading-relaxed">
              Find answers to common questions about DawaSnap AI, camera OCR accuracy, expiration detection, privacy safeguards, and multi-domain access.
            </p>
          </div>
        </div>

        {/* FAQ List */}
        <section className="space-y-3">
          {faqs.map((faq, idx) => {
            const isOpen = openIdx === idx;
            return (
              <div
                key={idx}
                className="bg-white border border-[#e3e2e0] rounded-2xl overflow-hidden transition-all duration-200 shadow-2xs"
              >
                <button
                  type="button"
                  onClick={() => setOpenIdx(isOpen ? null : idx)}
                  className="w-full px-5 py-4 text-left font-bold text-sm sm:text-base text-slate-900 flex items-center justify-between gap-4 hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <span>{faq.q}</span>
                  <ChevronDown
                    size={18}
                    className={`text-slate-400 shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180 text-[#0f9d58]' : ''}`}
                  />
                </button>
                {isOpen && (
                  <div className="px-5 pb-5 text-xs sm:text-sm text-slate-600 leading-relaxed border-t border-slate-100 pt-3.5 bg-slate-50/40">
                    {faq.a}
                  </div>
                )}
              </div>
            );
          })}
        </section>

        {/* Still Have Questions Box */}
        <section className="bg-white border border-[#e3e2e0] rounded-3xl p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h3 className="font-bold text-base text-slate-900">Still have a question or need pharmacy support?</h3>
            <p className="text-xs text-slate-500">Our engineering and clinical safety team is here to assist.</p>
          </div>
          <a
            href="mailto:newluckypharmacy@gmail.com"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#0f9d58] hover:bg-[#0b8043] text-white text-xs font-bold transition-all shadow-xs"
          >
            <Mail size={15} />
            <span>Contact Support</span>
          </a>
        </section>

        {/* Sitelink Footer navigation */}
        <div className="pt-4 flex flex-wrap items-center justify-center gap-4 text-xs font-semibold text-slate-600">
          <a href="/?page=about" className="hover:text-[#0f9d58] transition-colors">About Us</a>
          <span className="text-slate-300">&bull;</span>
          <a href="/?page=guide" className="hover:text-[#0f9d58] transition-colors">User Guide</a>
          <span className="text-slate-300">&bull;</span>
          <a href="/?page=privacy" className="hover:text-[#0f9d58] transition-colors">Privacy Policy</a>
          <span className="text-slate-300">&bull;</span>
          <a href="/?page=terms" className="hover:text-[#0f9d58] transition-colors">Terms of Service</a>
        </div>
      </main>
    </div>
  );
};
