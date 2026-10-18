import React from 'react';
import { ExternalLink, ShieldCheck, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';
import { DEFAULT_NATIVE_DIVIDER_ID } from '../services/admobService';

interface AdMobNativeCardProps {
  className?: string;
  adUnitId?: string;
}

export const AdMobNativeCard: React.FC<AdMobNativeCardProps> = ({
  className = '',
  adUnitId = DEFAULT_NATIVE_DIVIDER_ID
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      id="admob-native-expired-section"
      data-ad-unit={adUnitId}
      className={`my-5 rounded-3xl bg-white border border-[#e3e2e0] p-4 shadow-xs relative overflow-hidden transition-all hover:shadow-sm ${className}`}
      aria-label="Sponsored advertisement"
    >
      {/* Decorative subtle background gradient */}
      <div className="absolute -top-16 -right-16 w-36 h-36 bg-gradient-to-br from-emerald-100/50 to-teal-50/20 rounded-full blur-2xl pointer-events-none" />

      {/* Header with Mandatory AdMob Policy Attribution */}
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <div className="flex items-center gap-2">
          {/* Official High-Visibility "Ad" Badge per Google AdMob Native Policy */}
          <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-amber-100 text-amber-900 border border-amber-300 select-none shadow-2xs">
            Ad
          </span>
          <span className="text-[11px] font-bold text-slate-500 flex items-center gap-1">
            <ShieldCheck size={12} className="text-[#0f9d58]" />
            Sponsored &bull; SmartRun
          </span>
        </div>
        <span className="text-[10px] text-slate-400 font-mono tracking-tight">
          smartrun.in
        </span>
      </div>

      {/* Main Ad Content Card */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3.5 pt-0.5">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-[#0f9d58] to-emerald-500 flex items-center justify-center text-white shrink-0 shadow-xs">
            <Sparkles size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="text-sm sm:text-base font-bold text-slate-900 tracking-tight leading-snug">
              SmartRun: Delivery in 60mins
            </h4>
            <p className="text-xs text-slate-600 line-clamp-2 mt-0.5 leading-relaxed">
              Order electrical products and construction materials delivered directly to your site in just 60 minutes.
            </p>
          </div>
        </div>

        {/* Action Button */}
        <div className="w-full sm:w-auto shrink-0 flex items-center justify-end">
          <a
            href="https://smartrun.in"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-2xl bg-slate-900 hover:bg-black text-white text-xs font-bold transition-all active:scale-95 shadow-xs cursor-pointer"
          >
            <span>Order Now</span>
            <ExternalLink size={12} />
          </a>
        </div>
      </div>
    </motion.div>
  );
};
