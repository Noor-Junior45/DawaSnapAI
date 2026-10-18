import React, { useState, useEffect, useRef } from 'react';
import { Medicine, MedicineForm } from '../types';
import { 
  Calendar, Package, AlertTriangle, CheckCircle2, Clock, Trash2, 
  CheckSquare, Square, Layers, Edit3, XCircle, AlertCircle, 
  Filter, RefreshCw, Zap, ArrowUp, ArrowDown, ChevronRight
} from 'lucide-react';
import { motion, AnimatePresence, Reorder, useDragControls } from 'motion/react';
import { MEDICINE_FORM_ICONS, getCategoryStyle, isCategoryMatch, getMedicineCategories } from '../constants';
import { triggerLightHaptic, triggerMediumHaptic, triggerSelectionHaptic, triggerSuccessHaptic } from '../utils/haptics';
import { AdMobNativeCard } from './AdMobNativeCard';

interface MedicineListProps {
  medicines: Medicine[];
  onEdit: (medicine: Medicine) => void;
  onToggleTaken: (medicine: Medicine) => void;
  onReduceQuantity: (medicine: Medicine) => void;
  onDeleteMultiple: (ids: string[]) => void;
  lowQuantityThreshold: number;
  alertThreshold: number;
  onToggleLike?: (medicine: Medicine) => void;
  onAutoCategorize?: () => Promise<void>;
  isCategorizing?: boolean;
  onAutoAllotFormulations?: () => Promise<void>;
  isAllottingFormulations?: boolean;
  selectedCategory?: string;
  onSelectCategory?: (category: string) => void;
  isSelectionMode?: boolean;
  setIsSelectionMode?: React.Dispatch<React.SetStateAction<boolean>>;
  selectedIds?: Set<string>;
  setSelectedIds?: React.Dispatch<React.SetStateAction<Set<string>>>;
  totalMedicinesCount?: number;
  sortOrder?: 'default' | 'asc' | 'desc';
  customCardOrder?: string[];
  onSaveCustomOrder?: (newOrder: string[]) => void;
}

interface GroupedMedicine {
  groupKey: string;
  name: string;
  form?: MedicineForm;
  dosage: string;
  schedule?: string;
  usageInstructions?: string;
  imageUrl?: string;
  category?: string;
  categories?: string[];
  tags: string[];
  enableLowStockAlert?: boolean;
  lowStockThreshold?: number;
  activeBatches: Medicine[];
  expiredOrEmptyBatches: Medicine[];
  totalActiveQuantity: number;
  totalExpiredQuantity: number;
  hasActiveQuantities: boolean;
  hasExpiredQuantities: boolean;
  nearestActiveBatch?: Medicine;
  earliestExpiredBatch?: Medicine;
  allBatches: Medicine[];
  customOrder?: number;
}

const getDiffDays = (dateStr?: string): number => {
  if (!dateStr) return 9999;
  const [year, month, day] = dateStr.split('-').map(Number);
  const expiry = new Date();
  if (year && month && day && !isNaN(year) && !isNaN(month) && !isNaN(day)) {
    expiry.setFullYear(year, month - 1, day);
  } else {
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      parsed.setHours(0, 0, 0, 0);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return Math.round((parsed.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    }
    return 9999;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  expiry.setHours(0, 0, 0, 0);
  return Math.round((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
};

const formatDisplayDate = (dateStr?: string) => {
  if (!dateStr) return 'N/A';
  const [year, month, day] = dateStr.split('-').map(Number);
  if (year && month && day && !isNaN(year) && !isNaN(month) && !isNaN(day)) {
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
};

const getExpiryStatus = (dateStr?: string, alertThreshold = 90) => {
  if (!dateStr) {
    return { label: 'No Date', color: 'text-slate-500', bg: 'bg-slate-100', Icon: Clock };
  }
  const diffDays = getDiffDays(dateStr);
  const effectiveThreshold = alertThreshold === 90 ? 92 : alertThreshold;

  if (diffDays < 0) return { label: 'Expired', color: 'text-[#ea4335]', bg: 'bg-rose-50 border border-rose-100', Icon: XCircle };
  if (diffDays === 0) return { label: 'Expiring Today', color: 'text-[#f2a154]', bg: 'bg-amber-50 border border-amber-100', Icon: AlertTriangle };
  if (diffDays <= 10) return { label: 'Expiring Soon (10d)', color: 'text-[#f2a154]', bg: 'bg-amber-50 border border-amber-100', Icon: AlertTriangle };
  if (diffDays <= effectiveThreshold) {
    const label = alertThreshold === 90 ? 'Expiring in 3mo' : `Expiring in ${alertThreshold}d`;
    return { label, color: 'text-[#ab47bc]', bg: 'bg-purple-50 border border-purple-100', Icon: Clock };
  }
  if (diffDays <= 180) return { label: 'Expiring in 6mo', color: 'text-[#1a73e8]', bg: 'bg-blue-50 border border-blue-100', Icon: Clock };
  return { label: 'Safe', color: 'text-[#0f9d58]', bg: 'bg-emerald-50 border border-emerald-100', Icon: CheckCircle2 };
};

// Hexagonal dot design SVG icon: 2 dots in 1st column, 3 dots in 2nd column, 2 dots in 3rd column
const HexagonalDotGrip: React.FC<{ className?: string }> = ({ className = "" }) => (
  <svg 
    width="15" 
    height="18" 
    viewBox="0 0 16 18" 
    fill="currentColor" 
    className={`shrink-0 ${className}`}
    aria-hidden="true"
  >
    {/* 1st column: 2 dots */}
    <circle cx="3.2" cy="6.0" r="1.35" />
    <circle cx="3.2" cy="12.0" r="1.35" />
    {/* 2nd column: 3 dots (vertical axis of hexagon) */}
    <circle cx="8.0" cy="3.0" r="1.35" />
    <circle cx="8.0" cy="9.0" r="1.35" />
    <circle cx="8.0" cy="15.0" r="1.35" />
    {/* 3rd column: 2 dots */}
    <circle cx="12.8" cy="6.0" r="1.35" />
    <circle cx="12.8" cy="12.0" r="1.35" />
  </svg>
);

// Helper to parse prominent brand name and active generic/salt formula if combined in medicine name
export function parseMedicineName(rawName: string): { brandName: string; genericName?: string } {
  if (!rawName) return { brandName: 'Unnamed Medicine' };
  const trimmed = rawName.trim();

  // Pattern 1: Brand Name (Generic / Salt Composition) or [Generic]
  const parenMatch = trimmed.match(/^([^(]+?)\s*(\(([^)]+)\)|\[([^\]]+)\])$/);
  if (parenMatch && parenMatch[1].trim().length > 0) {
    const brand = parenMatch[1].trim();
    const generic = (parenMatch[3] || parenMatch[4] || '').trim();
    if (brand.length > 0 && generic.length > 0) {
      return { brandName: brand, genericName: generic };
    }
  }

  // Pattern 2: Brand - Generic (only if separated by space hyphen space or colon with clear salt words)
  const hyphenMatch = trimmed.match(/^([^-:]+?)\s+[-:]\s+([A-Za-z0-9].*)$/);
  if (hyphenMatch && hyphenMatch[1].trim().length >= 2) {
    const brand = hyphenMatch[1].trim();
    const generic = hyphenMatch[2].trim();
    if (brand.length > 0 && generic.length > 0) {
      return { brandName: brand, genericName: generic };
    }
  }

  return { brandName: trimmed };
}

interface ActiveGroupCardProps {
  group: GroupedMedicine;
  index: number;
  totalGroups: number;
  isCustomOrderActive: boolean;
  isSelectionMode: boolean;
  selectedIds: Set<string>;
  toggleSelectGroup: (batches: Medicine[]) => void;
  onEdit: (medicine: Medicine) => void;
  onReduceQuantity: (medicine: Medicine) => void;
  lowQuantityThreshold: number;
  alertThreshold: number;
  selectedCategory: string;
  onSelectCategory?: (category: string) => void;
  onMovePosition: (groupKey: string, newPosition: number) => void;
}

const ActiveGroupCard: React.FC<ActiveGroupCardProps> = ({
  group,
  index,
  totalGroups,
  isCustomOrderActive,
  isSelectionMode,
  selectedIds,
  toggleSelectGroup,
  onEdit,
  onReduceQuantity,
  lowQuantityThreshold,
  alertThreshold,
  selectedCategory,
  onSelectCategory,
  onMovePosition
}) => {
  const dragControls = useDragControls();
  const [showOrderMenu, setShowOrderMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { brandName, genericName } = React.useMemo(() => parseMedicineName(group.name), [group.name]);

  useEffect(() => {
    if (!showOrderMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowOrderMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showOrderMenu]);

  const nearestBatch = group.nearestActiveBatch;
  const nearestExpiry = nearestBatch?.expirationDate;
  const status = getExpiryStatus(nearestExpiry, alertThreshold);
  const diffDays = getDiffDays(nearestExpiry);

  const effectiveThreshold = alertThreshold === 90 ? 92 : alertThreshold;
  const isExpiringSoon = diffDays >= 0 && diffDays <= 10;
  const isExpiringAlert = diffDays > 10 && diffDays <= effectiveThreshold;
  const isAlertEnabled = group.enableLowStockAlert !== false;
  const threshold = group.lowStockThreshold ?? lowQuantityThreshold;
  const isLowQuantity = isAlertEnabled && group.hasActiveQuantities && group.totalActiveQuantity <= threshold;
  const needsAttention = isExpiringSoon || isExpiringAlert || isLowQuantity;

  const activeBatchIds = group.activeBatches.map(b => b.id);
  const allActiveSelected = activeBatchIds.length > 0 && activeBatchIds.every(id => selectedIds.has(id));

  return (
    <Reorder.Item
      value={group}
      id={group.groupKey}
      dragListener={false}
      dragControls={dragControls}
      className={`w-full text-left relative overflow-hidden border-2 rounded-3xl p-5 transition-all shadow-sm select-none ${
        allActiveSelected ? 'bg-white border-[#0f9d58] shadow-[0_12px_40px_rgba(15,157,88,0.06)]' :
        isExpiringSoon ? 'bg-white border-orange-500 hover:border-orange-600 hover:bg-orange-50/20' :
        isExpiringAlert ? 'bg-white border-purple-500 hover:border-purple-600 hover:bg-purple-50/20' :
        isLowQuantity ? 'bg-white border-amber-500 hover:border-amber-600 hover:bg-amber-50/20' :
        'bg-white border-blue-400 hover:border-blue-500 hover:bg-blue-50/20'
      }`}
      animate={{
        ...(needsAttention && !allActiveSelected ? {
          boxShadow: isExpiringSoon 
            ? ['0px 0px 0px rgba(249,115,22,0)', '0px 0px 15px rgba(249,115,22,0.15)', '0px 0px 0px rgba(249,115,22,0)']
            : isExpiringAlert || isLowQuantity
              ? ['0px 0px 0px rgba(234,179,8,0)', '0px 0px 15px rgba(234,179,8,0.15)', '0px 0px 0px rgba(234,179,8,0)']
              : undefined,
        } : {})
      }}
      transition={{
        layout: { type: "spring", stiffness: 350, damping: 30 },
        ...(needsAttention && !allActiveSelected ? {
          boxShadow: { repeat: Infinity, duration: 2, ease: "easeInOut" }
        } : {})
      }}
    >
      {/* Card Header */}
      <div className="flex justify-between items-start mb-2">
        <div className="flex items-start gap-2.5 flex-1 overflow-hidden">
          {isSelectionMode && (
            <button 
              type="button"
              onClick={() => toggleSelectGroup(group.activeBatches)}
              className="mt-1 text-slate-400 shrink-0 hover:text-[#0f9d58] transition-colors"
            >
              {allActiveSelected ? <CheckSquare size={18} className="text-[#0f9d58]" /> : <Square size={18} />}
            </button>
          )}
          
          <div 
            className="flex-1 min-w-0 cursor-pointer"
            onClick={() => {
              triggerLightHaptic();
              if (isSelectionMode) {
                toggleSelectGroup(group.activeBatches);
              } else if (nearestBatch) {
                onEdit(nearestBatch);
              }
            }}
          >
            {/* Title Line: Hexagonal dot design handle + clear medicine name in ONE line */}
            <div className="flex items-center gap-1.5 min-w-0 w-full">
              {/* Hexagonal dot design drag handle button right in front of medicine name (shrink-0 so never wraps) */}
              <div className="relative inline-flex items-center shrink-0" ref={menuRef}>
                <button
                  type="button"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    if (isCustomOrderActive && !isSelectionMode) {
                      triggerLightHaptic();
                      dragControls.start(e);
                    }
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isCustomOrderActive && !isSelectionMode) {
                      triggerLightHaptic();
                      setShowOrderMenu(prev => !prev);
                    }
                  }}
                  className={`p-1 -ml-1 sm:p-1.5 rounded-lg text-slate-400 hover:text-slate-800 active:text-blue-600 transition-colors touch-none select-none flex items-center justify-center shrink-0 ${
                    isCustomOrderActive ? 'cursor-grab active:cursor-grabbing hover:bg-slate-100' : 'opacity-40 cursor-not-allowed'
                  }`}
                  title={isCustomOrderActive ? "Hold & drag handle up or down to reorder, or click for quick move" : "Custom drag ordering is available when no A-Z / Z-A filter is selected"}
                  aria-label="Drag up or down to customize order"
                >
                  <HexagonalDotGrip className="text-slate-500 hover:text-slate-800" />
                </button>

                {/* Quick Reorder Popover Menu */}
                {showOrderMenu && isCustomOrderActive && (
                  <div 
                    onClick={(e) => e.stopPropagation()}
                    className="absolute top-full left-0 mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-xl p-1.5 min-w-[145px] text-xs flex flex-col gap-0.5"
                  >
                    <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 mb-0.5">
                      Place #{index + 1} at:
                    </div>
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => {
                        triggerLightHaptic();
                        onMovePosition(group.groupKey, 0);
                        setShowOrderMenu(false);
                      }}
                      className="px-2 py-1.5 text-left rounded-lg hover:bg-slate-50 disabled:opacity-30 disabled:hover:bg-transparent flex items-center justify-between text-slate-700 font-medium cursor-pointer"
                    >
                      <span>Top (#1)</span>
                      <ArrowUp size={12} className="text-slate-400" />
                    </button>
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => {
                        triggerLightHaptic();
                        onMovePosition(group.groupKey, index - 1);
                        setShowOrderMenu(false);
                      }}
                      className="px-2 py-1.5 text-left rounded-lg hover:bg-slate-50 disabled:opacity-30 disabled:hover:bg-transparent flex items-center justify-between text-slate-700 font-medium cursor-pointer"
                    >
                      <span>Move Up</span>
                      <ArrowUp size={12} className="text-slate-400" />
                    </button>
                    <button
                      type="button"
                      disabled={index === totalGroups - 1}
                      onClick={() => {
                        triggerLightHaptic();
                        onMovePosition(group.groupKey, index + 1);
                        setShowOrderMenu(false);
                      }}
                      className="px-2 py-1.5 text-left rounded-lg hover:bg-slate-50 disabled:opacity-30 disabled:hover:bg-transparent flex items-center justify-between text-slate-700 font-medium cursor-pointer"
                    >
                      <span>Move Down</span>
                      <ArrowDown size={12} className="text-slate-400" />
                    </button>
                    <button
                      type="button"
                      disabled={index === totalGroups - 1}
                      onClick={() => {
                        triggerLightHaptic();
                        onMovePosition(group.groupKey, totalGroups - 1);
                        setShowOrderMenu(false);
                      }}
                      className="px-2 py-1.5 text-left rounded-lg hover:bg-slate-50 disabled:opacity-30 disabled:hover:bg-transparent flex items-center justify-between text-slate-700 font-medium cursor-pointer"
                    >
                      <span>Bottom (#{totalGroups})</span>
                      <ArrowDown size={12} className="text-slate-400" />
                    </button>
                  </div>
                )}
              </div>

              {/* Medicine Name: clean, bold, locked in ONE line with dot handle, ellipses (...) if long */}
              <h3 
                className="font-bold text-base sm:text-lg tracking-tight text-[#1f1f1f] hover:text-[#0f9d58] transition-colors truncate min-w-0 shrink leading-snug"
                title={group.name}
              >
                {brandName}
              </h3>
              <span className="shrink-0 scale-90 sm:scale-100">{group.form && MEDICINE_FORM_ICONS[group.form]}</span>
              {group.activeBatches.length > 1 && (
                <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold bg-blue-50 text-blue-600 border border-blue-100 whitespace-nowrap">
                  <Layers size={10} />
                  <span>{group.activeBatches.length}</span>
                </span>
              )}
              {group.expiredOrEmptyBatches.length > 0 && (
                <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold bg-rose-50 text-rose-600 border border-rose-100 whitespace-nowrap">
                  <XCircle size={10} />
                  <span>{group.expiredOrEmptyBatches.length} Exp</span>
                </span>
              )}
            </div>

            {/* Clean secondary subtext for generic composition / formula if combined */}
            {genericName && (
              <p 
                className="text-[11px] text-slate-500 truncate mt-0.5 pl-5.5 font-medium leading-tight" 
                title={genericName}
              >
                {genericName}
              </p>
            )}

            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className="flex items-center gap-1 text-slate-500 text-[11px] sm:text-xs">
                <Package size={12} className="text-slate-400" />
                {group.dosage}
              </span>
              {group.schedule && (
                <span className="flex items-center gap-1 text-[#1a73e8] text-[11px] sm:text-xs font-semibold">
                  <Clock size={12} className="text-[#1a73e8]" />
                  <span className="truncate max-w-[120px]">{group.schedule}</span>
                </span>
              )}
              <span className={`flex items-center gap-1 text-[9px] sm:text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${status.bg} ${status.color}`}>
                {status.label}
              </span>
            </div>

            {/* Category Badges */}
            {(() => {
              const cats = Array.from(new Set(getMedicineCategories(group)));
              if (cats.length === 0) return null;
              return (
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  {cats.map((cat, cIdx) => {
                    const style = getCategoryStyle(cat);
                    const isSelected = selectedCategory.toLowerCase() === cat.toLowerCase();
                    return (
                      <span 
                        key={`cat-${group.groupKey}-${cat.toLowerCase()}-${cIdx}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onSelectCategory) {
                            onSelectCategory(isSelected ? 'ALL' : cat);
                          }
                        }}
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border transition-all cursor-pointer hover:opacity-90 ${style.badgeBg} ${style.badgeText} ${style.badgeBorder} ${isSelected ? 'ring-1 ring-current' : ''}`}
                        title={`Filter by category: ${cat}`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${style.dotColor}`} />
                        {cat}
                      </span>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>

        {/* Right side Actions: Redesigned -1 button (Transparent circle with red text) */}
        {!isSelectionMode && (
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {nearestBatch && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (nearestBatch.quantity !== undefined && nearestBatch.quantity > 0) {
                    triggerMediumHaptic();
                    onReduceQuantity(nearestBatch);
                  }
                }}
                disabled={nearestBatch.quantity === undefined || nearestBatch.quantity <= 0}
                className={`w-8 h-8 rounded-full text-xs sm:text-[13px] font-black tracking-tight border transition-all active:scale-90 flex items-center justify-center shrink-0 ${
                  nearestBatch.quantity !== undefined && nearestBatch.quantity > 0
                    ? 'bg-transparent hover:bg-red-500/10 active:bg-red-500/20 border-red-300/80 hover:border-red-500 text-red-600 shadow-2xs cursor-pointer'
                    : 'bg-transparent border-slate-200/60 text-slate-300 cursor-not-allowed opacity-40'
                }`}
                title={nearestBatch.quantity !== undefined && nearestBatch.quantity > 0 ? "Take / Reduce 1 from nearest expiring batch" : "Stock is zero"}
                aria-label="Reduce 1"
              >
                <span className="leading-none select-none text-red-600 font-black">-1</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Outside Information Bar: Nearest Expiration & Total Active Quantity */}
      <div className={`flex items-center justify-between mt-2 pt-2 border-t border-slate-100 ${isSelectionMode ? 'ml-7' : ''}`}>
        <div className="flex items-center gap-1.5 text-slate-600 text-[11px] font-mono font-semibold">
          <Calendar size={13} className="text-slate-400" />
          <span>
            Nearest Expiry: <span className="font-bold text-[#1f1f1f]">{formatDisplayDate(nearestExpiry)}</span>
          </span>
        </div>

        {group.hasActiveQuantities && (
          <div className={`text-[10px] font-extrabold px-2.5 py-1 rounded-lg flex items-center gap-1 ${
            isLowQuantity 
              ? 'text-[#f2a154] bg-orange-50 border border-orange-100' 
              : 'text-slate-700 bg-slate-100 border border-slate-200'
          }`}>
            {isLowQuantity && <AlertCircle size={10} className="text-orange-500" />}
            <span>{group.totalActiveQuantity} LEFT</span>
          </div>
        )}
      </div>

      {/* Usage Instructions if present */}
      {group.usageInstructions && (
        <p className={`mt-2 text-slate-500 text-[10px] line-clamp-1 italic ${isSelectionMode ? 'ml-7' : ''}`}>
          {group.usageInstructions}
        </p>
      )}
    </Reorder.Item>
  );
};

export const MedicineList: React.FC<MedicineListProps> = ({ 
  medicines, onEdit, onToggleTaken, onReduceQuantity, onDeleteMultiple, 
  lowQuantityThreshold, alertThreshold, onAutoCategorize, isCategorizing = false,
  onAutoAllotFormulations, isAllottingFormulations = false,
  selectedCategory = 'ALL', onSelectCategory,
  isSelectionMode: propIsSelectionMode,
  setIsSelectionMode: propSetIsSelectionMode,
  selectedIds: propSelectedIds,
  setSelectedIds: propSetSelectedIds,
  totalMedicinesCount = 0,
  sortOrder = 'default',
  customCardOrder: propCustomCardOrder,
  onSaveCustomOrder
}) => {
  const [internalSelectedIds, setInternalSelectedIds] = useState<Set<string>>(new Set());
  const [internalIsSelectionMode, setInternalIsSelectionMode] = useState(false);

  const selectedIds = propSelectedIds !== undefined ? propSelectedIds : internalSelectedIds;
  const setSelectedIds = propSetSelectedIds !== undefined ? propSetSelectedIds : setInternalSelectedIds;
  const isSelectionMode = propIsSelectionMode !== undefined ? propIsSelectionMode : internalIsSelectionMode;
  const setIsSelectionMode = propSetIsSelectionMode !== undefined ? propSetIsSelectionMode : setInternalIsSelectionMode;

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Custom Card Drag & Drop Order State
  const [customCardOrder, setCustomCardOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('dawasnap_custom_card_order');
      if (saved) return JSON.parse(saved);
    } catch {}
    return propCustomCardOrder || [];
  });

  useEffect(() => {
    if (propCustomCardOrder && Array.isArray(propCustomCardOrder) && propCustomCardOrder.length > 0) {
      setCustomCardOrder(propCustomCardOrder);
    }
  }, [propCustomCardOrder]);

  const isCustomOrderActive = sortOrder !== 'asc' && sortOrder !== 'desc';

  const toggleSelectGroup = (groupBatches: Medicine[]) => {
    const groupIds = groupBatches.map(b => b.id);
    const allSelected = groupIds.every(id => selectedIds.has(id));
    const newSelected = new Set(selectedIds);

    if (allSelected) {
      groupIds.forEach(id => newSelected.delete(id));
    } else {
      groupIds.forEach(id => newSelected.add(id));
    }

    setSelectedIds(newSelected);
    if (newSelected.size === 0) {
      setIsSelectionMode(false);
    }
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === medicines.length) {
      setSelectedIds(new Set());
      setIsSelectionMode(false);
    } else {
      setSelectedIds(new Set(medicines.map(m => m.id)));
      setIsSelectionMode(true);
    }
  };

  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) return;
    setShowDeleteConfirm(true);
  };

  const confirmDelete = () => {
    onDeleteMultiple(Array.from(selectedIds));
    setSelectedIds(new Set());
    setIsSelectionMode(false);
    setShowDeleteConfirm(false);
  };

  // Group medicines by normalized name
  const groupedMedicinesMap = React.useMemo(() => {
    const map = new Map<string, GroupedMedicine>();

    medicines.forEach((med, medIdx) => {
      const rawName = (med.name || '').trim().toLowerCase();
      const groupKey = rawName || `med-${med.id || medIdx}`;
      const diffDays = getDiffDays(med.expirationDate);
      const isExpired = diffDays < 0;
      const isEmpty = med.quantity !== undefined && med.quantity <= 0;
      const isTaken = med.taken === true;
      const isInactive = isExpired || isEmpty || isTaken;

      let group = map.get(groupKey);
      if (!group) {
        group = {
          groupKey,
          name: (med.name || 'Unnamed Medicine').trim(),
          form: med.form,
          dosage: med.dosage,
          schedule: med.schedule,
          usageInstructions: med.usageInstructions,
          imageUrl: med.imageUrl,
          category: med.category,
          tags: Array.isArray(med.tags) ? [...med.tags] : [],
          enableLowStockAlert: med.enableLowStockAlert,
          lowStockThreshold: med.lowStockThreshold,
          activeBatches: [],
          expiredOrEmptyBatches: [],
          totalActiveQuantity: 0,
          totalExpiredQuantity: 0,
          hasActiveQuantities: false,
          hasExpiredQuantities: false,
          allBatches: [],
          customOrder: med.customOrder
        };
        map.set(groupKey, group);
      }

      group.allBatches.push(med);
      if (med.customOrder !== undefined && (group.customOrder === undefined || med.customOrder < group.customOrder)) {
        group.customOrder = med.customOrder;
      }
      if (!group.form && med.form) group.form = med.form;
      if (!group.schedule && med.schedule) group.schedule = med.schedule;
      if (!group.usageInstructions && med.usageInstructions) group.usageInstructions = med.usageInstructions;
      if (!group.imageUrl && med.imageUrl) group.imageUrl = med.imageUrl;

      if (!group.categories) group.categories = [];
      const medCats = getMedicineCategories(med);
      medCats.forEach(c => {
        if (!group.categories!.includes(c)) {
          group.categories!.push(c);
        }
      });
      group.category = group.categories.join(', ');

      if (med.tags && Array.isArray(med.tags)) {
        med.tags.forEach(t => {
          const clean = t.trim();
          if (clean && !group.tags.includes(clean)) {
            group.tags.push(clean);
          }
        });
      }

      if (med.enableLowStockAlert !== undefined) {
        group.enableLowStockAlert = med.enableLowStockAlert;
      }
      if (med.lowStockThreshold !== undefined) {
        group.lowStockThreshold = med.lowStockThreshold;
      }

      if (isInactive) {
        group.expiredOrEmptyBatches.push(med);
        if (med.quantity !== undefined) {
          group.totalExpiredQuantity += Math.max(0, med.quantity);
          group.hasExpiredQuantities = true;
        }
      } else {
        group.activeBatches.push(med);
        if (med.quantity !== undefined) {
          group.totalActiveQuantity += Math.max(0, med.quantity);
          group.hasActiveQuantities = true;
        }
      }
    });

    map.forEach(group => {
      group.activeBatches.sort((a, b) => getDiffDays(a.expirationDate) - getDiffDays(b.expirationDate));

      const genuinelyExpired = group.expiredOrEmptyBatches.filter(b => getDiffDays(b.expirationDate) < 0);
      const otherInactive = group.expiredOrEmptyBatches.filter(b => getDiffDays(b.expirationDate) >= 0);

      genuinelyExpired.sort((a, b) => getDiffDays(a.expirationDate) - getDiffDays(b.expirationDate));
      otherInactive.sort((a, b) => getDiffDays(a.expirationDate) - getDiffDays(b.expirationDate));

      group.expiredOrEmptyBatches = [...genuinelyExpired, ...otherInactive];

      if (group.activeBatches.length > 0) {
        group.nearestActiveBatch = group.activeBatches[0];
      }
      if (group.expiredOrEmptyBatches.length > 0) {
        group.earliestExpiredBatch = group.expiredOrEmptyBatches[0];
      }
    });

    return map;
  }, [medicines]);

  const uncategorizedCount = React.useMemo(() => {
    return medicines.filter(m => !m.isDeleted && (
      !m.category ||
      m.category.trim() === '' ||
      m.category.toLowerCase() === 'uncategorized'
    )).length;
  }, [medicines]);

  const unallottedFormulationCount = React.useMemo(() => {
    return medicines.filter(m => !m.isDeleted && (
      !m.form ||
      m.form === 'other' ||
      m.form.trim() === ''
    )).length;
  }, [medicines]);

  const totalUnallocatedCount = React.useMemo(() => {
    return unallottedFormulationCount + uncategorizedCount;
  }, [unallottedFormulationCount, uncategorizedCount]);

  const hasUnallocatedItems = totalUnallocatedCount > 0;

  const matchesFilter = (group: GroupedMedicine) => {
    if (selectedCategory !== 'ALL') {
      return isCategoryMatch(group, selectedCategory);
    }
    return true;
  };

  // Active groups sorted by A-Z, Z-A or custom order
  const activeGroups = React.useMemo(() => {
    const list = Array.from(groupedMedicinesMap.values())
      .filter(g => g.activeBatches.length > 0)
      .filter(matchesFilter);

    return list.sort((a, b) => {
      // 1. When A-Z or Z-A is active, sort alphabetically
      if (sortOrder === 'asc') {
        return (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase());
      }
      if (sortOrder === 'desc') {
        return (b.name || '').toLowerCase().localeCompare((a.name || '').toLowerCase());
      }

      // 2. Custom Order is active (no filter choice like A-Z, Z-A)
      if (customCardOrder && customCardOrder.length > 0) {
        const idxA = customCardOrder.indexOf(a.groupKey);
        const idxB = customCardOrder.indexOf(b.groupKey);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
      }

      // 3. Fallback to medicine's customOrder field if present
      if (a.customOrder !== undefined && b.customOrder !== undefined) {
        return a.customOrder - b.customOrder;
      }
      if (a.customOrder !== undefined) return -1;
      if (b.customOrder !== undefined) return 1;

      // 4. Default fallback: sort by nearest active expiration date
      const diffA = a.nearestActiveBatch ? getDiffDays(a.nearestActiveBatch.expirationDate) : 9999;
      const diffB = b.nearestActiveBatch ? getDiffDays(b.nearestActiveBatch.expirationDate) : 9999;
      return diffA - diffB;
    });
  }, [groupedMedicinesMap, selectedCategory, sortOrder, customCardOrder]);

  const expiredGroups = React.useMemo(() => {
    return Array.from(groupedMedicinesMap.values())
      .filter(g => g.expiredOrEmptyBatches.length > 0)
      .filter(matchesFilter)
      .sort((a, b) => {
        if (sortOrder === 'desc') {
          return (b.name || '').toLowerCase().localeCompare((a.name || '').toLowerCase());
        }
        return (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase());
      });
  }, [groupedMedicinesMap, selectedCategory, sortOrder]);

  // Handle reorder from drag & drop
  const handleReorderActiveGroups = (newGroups: GroupedMedicine[]) => {
    const newOrderKeys = newGroups.map(g => g.groupKey);
    setCustomCardOrder(newOrderKeys);
    try {
      localStorage.setItem('dawasnap_custom_card_order', JSON.stringify(newOrderKeys));
    } catch {}
    if (onSaveCustomOrder) {
      onSaveCustomOrder(newOrderKeys);
    }
  };

  // Handle moving a card to a specific position (1, 2, 3, 4...)
  const handleMovePosition = (groupKey: string, newPosition: number) => {
    const currentKeys = activeGroups.map(g => g.groupKey);
    const oldIndex = currentKeys.indexOf(groupKey);
    if (oldIndex === -1) return;

    const clampedPos = Math.max(0, Math.min(newPosition, currentKeys.length - 1));
    if (oldIndex === clampedPos) return;

    const nextKeys = [...currentKeys];
    const [moved] = nextKeys.splice(oldIndex, 1);
    nextKeys.splice(clampedPos, 0, moved);

    setCustomCardOrder(nextKeys);
    try {
      localStorage.setItem('dawasnap_custom_card_order', JSON.stringify(nextKeys));
    } catch {}
    if (onSaveCustomOrder) {
      onSaveCustomOrder(nextKeys);
    }
  };

  // Render an Expired Group Card (Shown in Expired Section)
  const renderExpiredGroupCard = (group: GroupedMedicine, index: number) => {
    const earliestBatch = group.earliestExpiredBatch || group.expiredOrEmptyBatches[0];
    const groupBatchIds = group.expiredOrEmptyBatches.map(b => b.id);
    const allGroupSelected = groupBatchIds.length > 0 && groupBatchIds.every(id => selectedIds.has(id));
    const { brandName, genericName } = parseMedicineName(group.name);

    return (
      <motion.div
        layout
        key={`expired-group-${group.groupKey}`}
        initial={{ opacity: 0, scale: 0.96, y: 15 }}
        animate={{ 
          opacity: 0.85, 
          scale: 1, 
          y: 0,
          transition: {
            layout: { type: "spring", stiffness: 350, damping: 30 },
            duration: 0.25
          }
        }}
        exit={{ 
          opacity: 0, 
          scale: 0.94, 
          y: -15,
          transition: { duration: 0.2 }
        }}
        transition={{ delay: index * 0.03 }}
        className={`w-full text-left relative overflow-hidden border-2 rounded-3xl p-5 transition-all bg-white border-red-400 hover:border-red-500 shadow-sm ${
          allGroupSelected ? 'bg-red-50/50 border-red-500' : ''
        }`}
      >
        <div className="flex justify-between items-start mb-2">
          <div className="flex items-start gap-2.5 flex-1 overflow-hidden">
            {isSelectionMode && (
              <button 
                type="button"
                onClick={() => toggleSelectGroup(group.expiredOrEmptyBatches)}
                className="mt-1 text-slate-400 shrink-0 hover:text-red-500 transition-colors"
              >
                {allGroupSelected ? <CheckSquare size={18} className="text-red-500" /> : <Square size={18} />}
              </button>
            )}
            
            <div 
              className="flex-1 min-w-0 cursor-pointer"
              onClick={() => {
                if (isSelectionMode) {
                  toggleSelectGroup(group.expiredOrEmptyBatches);
                } else if (earliestBatch) {
                  onEdit(earliestBatch);
                }
              }}
            >
              <div className="flex items-center gap-1.5 min-w-0 w-full">
                <h3 className="font-bold text-base sm:text-lg tracking-tight text-slate-600 truncate min-w-0 shrink leading-snug" title={group.name}>
                  <span className="line-through">{brandName}</span>
                </h3>
                <span className="shrink-0 scale-90 sm:scale-100">{group.form && MEDICINE_FORM_ICONS[group.form]}</span>
                {group.expiredOrEmptyBatches.length > 1 && (
                  <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold bg-rose-50 text-rose-600 border border-rose-100 whitespace-nowrap">
                    <Layers size={10} />
                    <span>{group.expiredOrEmptyBatches.length} Expired</span>
                  </span>
                )}
              </div>

              {genericName && (
                <p className="text-[11px] text-slate-400 truncate mt-0.5 font-medium leading-tight" title={genericName}>
                  {genericName}
                </p>
              )}

              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <span className="flex items-center gap-1 text-slate-500 text-[11px] sm:text-xs">
                  <Package size={12} className="text-slate-400" />
                  {group.dosage}
                </span>
                <span className="flex items-center gap-1 text-[9px] sm:text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-rose-50 border border-rose-100 text-[#ea4335]">
                  <XCircle size={10} /> {getDiffDays(earliestBatch?.expirationDate) < 0 ? 'Expired Stock' : earliestBatch?.taken ? 'Finished Stock' : 'Out of Stock'}
                </span>
              </div>

              {/* Category Badges */}
              {(() => {
                const cats = Array.from(new Set(getMedicineCategories(group)));
                if (cats.length === 0) return null;
                return (
                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    {cats.map((cat, cIdx) => {
                      const style = getCategoryStyle(cat);
                      const isSelected = selectedCategory.toLowerCase() === cat.toLowerCase();
                      return (
                        <span 
                          key={`cat-exp-${group.groupKey}-${cat.toLowerCase()}-${cIdx}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (onSelectCategory) {
                              onSelectCategory(isSelected ? 'ALL' : cat);
                            }
                          }}
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border transition-all cursor-pointer hover:opacity-90 ${style.badgeBg} ${style.badgeText} ${style.badgeBorder} ${isSelected ? 'ring-1 ring-current' : ''}`}
                          title={`Filter by category: ${cat}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${style.dotColor}`} />
                          {cat}
                        </span>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>

          {!isSelectionMode && earliestBatch && (
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(earliestBatch);
                }}
                className="p-2 bg-slate-50 border border-slate-200 rounded-full text-slate-500 hover:text-slate-800 transition-all cursor-pointer"
                title="Edit medicine"
              >
                <Edit3 size={16} />
              </button>
            </div>
          )}
        </div>

        {/* Outside Information for Expired Stock */}
        <div className={`flex items-center justify-between mt-2 pt-2 border-t border-slate-100 ${isSelectionMode ? 'ml-7' : ''}`}>
          <div className="flex items-center gap-1.5 text-slate-500 text-[11px] font-mono font-medium">
            <Calendar size={13} className="text-slate-400" />
            <span>
              {getDiffDays(earliestBatch?.expirationDate) < 0 ? 'Expired: ' : 'Finished: '}
              <strong className="text-rose-600 font-bold">{formatDisplayDate(earliestBatch?.expirationDate)}</strong>
            </span>
          </div>

          <div className="text-[10px] font-bold px-2.5 py-0.5 rounded-md bg-rose-50 border border-rose-100 text-[#ea4335]">
            {getDiffDays(earliestBatch?.expirationDate) < 0
              ? (group.hasExpiredQuantities || group.totalExpiredQuantity > 0 ? `${group.totalExpiredQuantity} EXPIRED` : 'EXPIRED')
              : earliestBatch?.taken ? 'FINISHED' : 'OUT OF STOCK'}
          </div>
        </div>
      </motion.div>
    );
  };

  if (medicines.length === 0) {
    if (totalMedicinesCount && totalMedicinesCount > 0) {
      return (
        <div className="py-16 text-center bg-white rounded-3xl border border-dashed border-slate-200 p-6 my-6 mx-2 shadow-xs">
          <div className="w-14 h-14 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3.5">
            <Filter size={24} />
          </div>
          <h4 className="text-base font-bold text-slate-800">No medicines match this filter</h4>
          <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto">
            No medications found under "{selectedCategory !== 'ALL' ? selectedCategory : 'selected filter'}".
          </p>
          <button
            type="button"
            onClick={() => onSelectCategory?.('ALL')}
            className="mt-4 px-5 py-2 rounded-full bg-slate-900 text-white text-xs font-bold hover:bg-black transition-all active:scale-95 shadow-xs cursor-pointer"
          >
            Show All Medicines
          </button>
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center py-20 text-center px-6">
        <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center mb-6 border border-[#e3e2e0] shadow-sm">
          <Package className="text-slate-400" size={32} />
        </div>
        <h3 className="text-[#1f1f1f] font-semibold text-lg mb-2">No medicines tracked</h3>
        <p className="text-[#5f6368] text-sm max-w-[240px]">
          Start by scanning a medicine label or adding one manually.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 px-2 sm:px-4 pb-24">
      {/* Top Selection Actions Toolbar (shown when selection mode is active) */}
      <AnimatePresence>
        {isSelectionMode && (
          <motion.div 
            key="selection-mode-toolbar"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="flex justify-between items-center mb-3 px-2 overflow-hidden"
          >
            <button 
              type="button"
              onClick={() => {
                setIsSelectionMode(false);
                setSelectedIds(new Set());
              }}
              className="text-xs text-slate-500 hover:text-slate-800 font-bold transition-colors cursor-pointer"
            >
              Cancel Selection
            </button>
            
            <div className="flex items-center gap-3">
              <button 
                type="button"
                onClick={toggleSelectAll}
                className="text-xs text-slate-600 hover:text-slate-900 font-semibold transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                {selectedIds.size === medicines.length ? <CheckSquare size={15} className="text-[#0f9d58]" /> : <Square size={15} />}
                All
              </button>
              {selectedIds.size > 0 && (
                <button 
                  type="button"
                  onClick={handleDeleteSelected}
                  className="text-xs text-red-600 hover:text-red-700 transition-colors flex items-center gap-1.5 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-full border border-red-100 font-bold cursor-pointer shadow-xs active:scale-95"
                >
                  <Trash2 size={13} />
                  Delete ({selectedIds.size})
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Dr Jack Auto-Allot Banner */}
      {hasUnallocatedItems && (onAutoCategorize || onAutoAllotFormulations) && (
        <div className="mx-1 mb-3.5 p-4 rounded-2xl bg-gradient-to-r from-blue-50/90 via-teal-50/80 to-emerald-50/90 border border-teal-200/80 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3.5 relative">
          <div className="flex items-start md:items-center gap-3 pr-2">
            <div className="w-9 h-9 rounded-xl bg-teal-600/15 text-teal-700 flex items-center justify-center shrink-0 mt-0.5 md:mt-0 shadow-2xs">
              <Zap size={18} className="text-teal-700" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-extrabold text-slate-900 text-sm tracking-tight flex items-center gap-1.5">
                  Dr Jack
                </span>
                {unallottedFormulationCount > 0 && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 shadow-2xs">
                    {unallottedFormulationCount} Formulation{unallottedFormulationCount > 1 ? 's' : ''}
                  </span>
                )}
                {uncategorizedCount > 0 && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-800 border border-blue-200 shadow-2xs">
                    {uncategorizedCount} Categor{uncategorizedCount > 1 ? 'ies' : 'y'}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-600 mt-0.5 font-normal">
                Auto-allot missing dosage forms and clinical categories.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap self-start md:self-center shrink-0">
            <button
              type="button"
              onClick={async () => {
                triggerMediumHaptic();
                try {
                  if (onAutoAllotFormulations && unallottedFormulationCount > 0) {
                    await onAutoAllotFormulations();
                  }
                  if (onAutoCategorize && uncategorizedCount > 0) {
                    await onAutoCategorize();
                  }
                } catch (e) {
                  console.error("Auto allot error:", e);
                }
              }}
              disabled={isAllottingFormulations || isCategorizing}
              className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 active:scale-95 text-white text-xs font-bold shadow-xs flex items-center justify-center gap-1.5 transition-all shrink-0 disabled:opacity-50 touch-manipulation cursor-pointer"
            >
              {isAllottingFormulations || isCategorizing ? (
                <>
                  <RefreshCw size={13} className="animate-spin" />
                  <span>Auto-Allotting...</span>
                </>
              ) : (
                <>
                  <Zap size={14} />
                  <span>Auto Allot</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Filtered Empty State */}
      {activeGroups.length === 0 && expiredGroups.length === 0 && medicines.length > 0 && (
        <div className="py-12 text-center bg-white rounded-3xl border border-dashed border-slate-200 p-6 my-4">
          <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
            <Filter size={20} />
          </div>
          <h4 className="text-sm font-bold text-slate-800">No medicines match this filter</h4>
          <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto">
            No items under "{selectedCategory !== 'ALL' ? selectedCategory : 'selected filter'}".
          </p>
          <button
            type="button"
            onClick={() => onSelectCategory?.('ALL')}
            className="mt-3 px-4 py-1.5 rounded-full bg-slate-900 text-white text-xs font-bold hover:bg-black transition-colors cursor-pointer"
          >
            Show All Medicines
          </button>
        </div>
      )}

      {/* Active & Safe Medications Section */}
      {activeGroups.length > 0 && (
        <div className="flex items-center justify-between mt-4 mb-2.5 px-2 select-none">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#0f9d58]" />
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
              Active & Safe ({activeGroups.length})
            </span>
          </div>
        </div>
      )}

      {/* Drag & Drop Reorder Group for Active Cards */}
      <Reorder.Group 
        axis="y" 
        values={activeGroups} 
        onReorder={isCustomOrderActive ? handleReorderActiveGroups : () => {}}
        className="space-y-3"
      >
        {activeGroups.map((group, index) => (
          <ActiveGroupCard 
            key={`active-group-${group.groupKey}`}
            group={group}
            index={index}
            totalGroups={activeGroups.length}
            isCustomOrderActive={isCustomOrderActive}
            isSelectionMode={isSelectionMode}
            selectedIds={selectedIds}
            toggleSelectGroup={toggleSelectGroup}
            onEdit={onEdit}
            onReduceQuantity={onReduceQuantity}
            lowQuantityThreshold={lowQuantityThreshold}
            alertThreshold={alertThreshold}
            selectedCategory={selectedCategory}
            onSelectCategory={onSelectCategory}
            onMovePosition={handleMovePosition}
          />
        ))}
      </Reorder.Group>

      {/* AdMob Native Section Divider Ad Unit: DawaSnap_ExpiredSection_Native (ca-app-pub-5865716270182311/6125203379) */}
      {expiredGroups.length > 0 && (
        <AdMobNativeCard adUnitId="ca-app-pub-5865716270182311/6125203379" />
      )}

      {/* Expired Medications Section */}
      {expiredGroups.length > 0 && (
        <div className="flex items-center gap-2 mt-6 mb-2.5 px-2 select-none">
          <span className="w-1.5 h-1.5 rounded-full bg-[#ea4335]" />
          <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
            Expired, Empty, or Finished Stock ({expiredGroups.length})
          </span>
        </div>
      )}

      <AnimatePresence mode="popLayout">
        {expiredGroups.map((group, index) => renderExpiredGroupCard(group, index))}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <div key="delete-confirm-modal" className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setShowDeleteConfirm(false)}
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-sm bg-[#1a1a1a] border border-white/10 rounded-3xl p-6 shadow-2xl"
            >
              <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mb-4 mx-auto">
                <Trash2 className="text-red-500" size={24} />
              </div>
              <h3 className="text-xl font-medium text-white text-center mb-2">Delete Medicines?</h3>
              <p className="text-white/60 text-sm text-center mb-6">
                Are you sure you want to delete {selectedIds.size} selected medicine record(s)? This action cannot be undone.
              </p>
              <div className="flex gap-3">
                <button 
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 py-3 rounded-xl bg-white/5 hover:bg-white/10 text-white font-medium transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button 
                  onClick={confirmDelete}
                  className="flex-1 py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white font-medium transition-colors shadow-lg shadow-red-500/20 cursor-pointer"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
