import React, { useState } from 'react';
import { Medicine } from '../types';
import { ChevronLeft, Trash2, RotateCcw, CheckSquare, Check, AlertTriangle, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useEdgeSwipeBack } from '../utils/mobileGestures';
import { triggerLightHaptic, triggerSuccessHaptic } from '../utils/haptics';

interface RecentlyDeletedPageProps {
  deletedMedicines: Medicine[];
  onRestore: (id: string) => Promise<void> | void;
  onPermanentDelete: (id: string) => Promise<void> | void;
  onPermanentDeleteMultiple?: (ids: string[]) => Promise<void> | void;
  onBack: () => void;
}

function getDaysRemainingText(deletedAt?: number): string {
  if (!deletedAt) return 'Pending deletion';
  const elapsedDays = Math.floor((Date.now() - deletedAt) / (1000 * 60 * 60 * 24));
  const remainingDays = Math.max(0, 15 - elapsedDays);
  if (remainingDays === 0) return 'Purging today';
  if (remainingDays === 1) return '1 day left';
  return `${remainingDays} days left`;
}

export const RecentlyDeletedPage: React.FC<RecentlyDeletedPageProps> = ({
  deletedMedicines,
  onRestore,
  onPermanentDelete,
  onPermanentDeleteMultiple,
  onBack,
}) => {
  // Mobile Edge-Swipe from left to navigate back
  useEdgeSwipeBack({ onBack });

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [isDeletingBatch, setIsDeletingBatch] = useState(false);
  const [confirmDeleteMedicine, setConfirmDeleteMedicine] = useState<Medicine | null>(null);
  const [showBatchConfirmModal, setShowBatchConfirmModal] = useState(false);

  // Toggle selection for a single medicine
  const toggleSelect = (id: string) => {
    triggerLightHaptic();
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  // Toggle select all
  const handleSelectAll = () => {
    triggerLightHaptic();
    if (selectedIds.length === deletedMedicines.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(deletedMedicines.map(m => m.id));
    }
  };

  // Execute single permanent delete
  const handleConfirmSingleDelete = async () => {
    if (!confirmDeleteMedicine) return;
    const medId = confirmDeleteMedicine.id;
    try {
      setDeletingId(medId);
      await onPermanentDelete(medId);
      setSelectedIds(prev => prev.filter(id => id !== medId));
      setConfirmDeleteMedicine(null);
      triggerSuccessHaptic();
    } catch (err) {
      console.error('Failed to permanently delete medicine:', err);
    } finally {
      setDeletingId(null);
    }
  };

  // Execute batch permanent delete
  const handleConfirmBatchDelete = async () => {
    if (selectedIds.length === 0) return;
    try {
      setIsDeletingBatch(true);
      if (onPermanentDeleteMultiple) {
        await onPermanentDeleteMultiple(selectedIds);
      } else {
        for (const id of selectedIds) {
          await onPermanentDelete(id);
        }
      }
      setSelectedIds([]);
      setShowBatchConfirmModal(false);
      triggerSuccessHaptic();
    } catch (err) {
      console.error('Failed to batch delete medicines:', err);
    } finally {
      setIsDeletingBatch(false);
    }
  };

  // Restore single medicine
  const handleRestoreClick = async (id: string) => {
    try {
      setRestoringId(id);
      triggerSuccessHaptic();
      await onRestore(id);
      setSelectedIds(prev => prev.filter(item => item !== id));
    } catch (err) {
      console.error('Failed to restore medicine:', err);
    } finally {
      setRestoringId(null);
    }
  };

  const hasSelection = selectedIds.length > 0;
  const isAllSelected = deletedMedicines.length > 0 && selectedIds.length === deletedMedicines.length;

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 bg-[#faf8f5] text-slate-800 flex flex-col overflow-hidden"
    >
      {/* Sticky Clean Header with Select All -> Delete All pill conversion */}
      <header className="sticky top-0 z-10 bg-white/95 backdrop-blur-md border-b border-[#e3e2e0] px-4 py-3 flex items-center justify-between shrink-0 shadow-2xs">
        <div className="flex items-center min-w-0">
          <button
            type="button"
            onClick={() => {
              triggerLightHaptic();
              onBack();
            }}
            className="p-2 -ml-2 mr-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-full transition-colors cursor-pointer shrink-0"
            aria-label="Back"
          >
            <ChevronLeft size={20} />
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="text-base sm:text-lg font-bold text-[#1f1f1f] leading-tight truncate">
              Recently Deleted
            </h1>
            {deletedMedicines.length > 0 && (
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 shrink-0">
                {deletedMedicines.length}
              </span>
            )}
          </div>
        </div>

        {/* Action Button: Pill-shape Select All that converts to Delete All when items selected */}
        {deletedMedicines.length > 0 && (
          <div className="flex items-center gap-2 shrink-0">
            {hasSelection ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    triggerLightHaptic();
                    setSelectedIds([]);
                  }}
                  className="px-2.5 py-1.5 rounded-full text-xs font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <motion.button
                  key="delete-all-pill"
                  initial={{ scale: 0.92, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  type="button"
                  onClick={() => {
                    triggerLightHaptic();
                    setShowBatchConfirmModal(true);
                  }}
                  disabled={isDeletingBatch}
                  className="rounded-full px-3.5 py-1.5 text-xs font-bold bg-[#ea4335] hover:bg-rose-700 text-white shadow-sm transition-all flex items-center gap-1.5 active:scale-95 cursor-pointer disabled:opacity-50"
                >
                  {isDeletingBatch ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Trash2 size={13} />
                  )}
                  <span>
                    {isAllSelected ? 'Delete All' : `Delete (${selectedIds.length})`}
                  </span>
                </motion.button>
              </>
            ) : (
              <motion.button
                key="select-all-pill"
                initial={{ scale: 0.92, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                type="button"
                onClick={handleSelectAll}
                className="rounded-full px-3.5 py-1.5 text-xs font-bold bg-[#faf8f5] hover:bg-[#f3ede1] text-[#1f1f1f] border border-[#d6d3d1] transition-all flex items-center gap-1.5 active:scale-95 cursor-pointer shadow-2xs"
              >
                <CheckSquare size={13} className="text-slate-600" />
                <span>Select All</span>
              </motion.button>
            )}
          </div>
        )}
      </header>

      {/* Product List Content */}
      <main className="flex-1 overflow-y-auto p-4 sm:p-6 custom-scrollbar">
        <div className="max-w-2xl mx-auto space-y-3">
          {deletedMedicines.length === 0 ? (
            <div className="text-center py-20 px-4 bg-white rounded-2xl border border-[#e3e2e0] space-y-3 shadow-2xs">
              <div className="w-12 h-12 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mx-auto">
                <Trash2 size={24} />
              </div>
              <h2 className="text-sm font-bold text-slate-700">No recently deleted products</h2>
              <p className="text-xs text-slate-400 max-w-xs mx-auto">
                Medicines you remove from your inventory stay here for 15 days before permanent cleanup.
              </p>
            </div>
          ) : (
            deletedMedicines.map((med, idx) => {
              const isSelected = selectedIds.includes(med.id);
              const isItemDeleting = deletingId === med.id;
              const isItemRestoring = restoringId === med.id;

              return (
                <div
                  key={`recently-deleted-${med.id || idx}-${idx}`}
                  className={`bg-white rounded-2xl border p-4 flex items-center justify-between gap-3 shadow-2xs transition-all ${
                    isSelected 
                      ? 'border-[#ea4335]/60 bg-rose-50/20 ring-1 ring-[#ea4335]/30' 
                      : 'border-[#e3e2e0] hover:border-slate-300'
                  }`}
                >
                  {/* Item Info section with selection checkbox (matches CSS hierarchy) */}
                  <div 
                    onClick={() => toggleSelect(med.id)}
                    className="min-w-0 flex-1 flex items-center gap-3 cursor-pointer select-none"
                  >
                    {/* Pill / Rounded Checkbox */}
                    <div 
                      className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-all ${
                        isSelected 
                          ? 'bg-[#ea4335] border-[#ea4335] text-white shadow-2xs' 
                          : 'border-slate-300 bg-white hover:border-slate-400'
                      }`}
                      aria-label={isSelected ? 'Deselect item' : 'Select item'}
                    >
                      {isSelected && <Check size={13} strokeWidth={3} />}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm sm:text-base font-bold text-[#1f1f1f] truncate">
                          {med.name}
                        </h3>
                        {med.form && (
                          <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 shrink-0">
                            {med.form}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500">
                        {med.dosage && <span className="truncate">{med.dosage}</span>}
                        {med.deletedAt && (
                          <>
                            <span className="text-slate-300">•</span>
                            <span className="text-[11px] text-slate-400 shrink-0">
                              {getDaysRemainingText(med.deletedAt)}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions Container: button 1 = Restore, button 2 = Delete (matches exact CSS selectors) */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={isItemRestoring || isItemDeleting || isDeletingBatch}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRestoreClick(med.id);
                      }}
                      className="px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold rounded-xl border border-emerald-200 transition-all flex items-center gap-1.5 active:scale-95 cursor-pointer disabled:opacity-50"
                      title="Restore product to inventory"
                    >
                      {isItemRestoring ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <RotateCcw size={14} />
                      )}
                      <span>Restore</span>
                    </button>
                    <button
                      type="button"
                      disabled={isItemDeleting || isItemRestoring || isDeletingBatch}
                      onClick={(e) => {
                        e.stopPropagation();
                        triggerLightHaptic();
                        setConfirmDeleteMedicine(med);
                      }}
                      className="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold rounded-xl border border-rose-200 transition-all flex items-center gap-1.5 active:scale-95 cursor-pointer disabled:opacity-50"
                      title="Delete permanently from Firestore & Supabase"
                    >
                      {isItemDeleting ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Trash2 size={14} />
                      )}
                      <span>Delete</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </main>

      {/* Confirmation Modal: Single Item Permanent Deletion */}
      <AnimatePresence>
        {confirmDeleteMedicine && (
          <div className="fixed inset-0 z-60 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-slate-200 space-y-4"
            >
              <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
                <AlertTriangle size={24} />
              </div>

              <div className="text-center space-y-1.5">
                <h3 className="text-base font-bold text-slate-900">
                  Permanently Delete Product?
                </h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Are you sure you want to completely erase <span className="font-semibold text-slate-800">{confirmDeleteMedicine.name}</span>? This will permanently delete it from Cloud Firestore and Supabase backup storage. This cannot be undone.
                </p>
              </div>

              <div className="flex gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setConfirmDeleteMedicine(null)}
                  disabled={deletingId !== null}
                  className="flex-1 py-2.5 px-4 rounded-xl border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmSingleDelete}
                  disabled={deletingId !== null}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-[#ea4335] hover:bg-rose-700 text-white text-xs font-bold transition-all shadow-sm active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {deletingId ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Trash2 size={14} />
                  )}
                  <span>Delete</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Confirmation Modal: Batch Permanent Deletion */}
      <AnimatePresence>
        {showBatchConfirmModal && (
          <div className="fixed inset-0 z-60 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-slate-200 space-y-4"
            >
              <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
                <Trash2 size={24} />
              </div>

              <div className="text-center space-y-1.5">
                <h3 className="text-base font-bold text-slate-900">
                  {selectedIds.length === deletedMedicines.length ? 'Delete All Products?' : `Delete ${selectedIds.length} Selected Products?`}
                </h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  {selectedIds.length} product{selectedIds.length > 1 ? 's' : ''} will be permanently removed from Cloud Firestore and Supabase backup storage. You will not be able to restore them.
                </p>
              </div>

              <div className="flex gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowBatchConfirmModal(false)}
                  disabled={isDeletingBatch}
                  className="flex-1 py-2.5 px-4 rounded-xl border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmBatchDelete}
                  disabled={isDeletingBatch}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-[#ea4335] hover:bg-rose-700 text-white text-xs font-bold transition-all shadow-sm active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {isDeletingBatch ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Trash2 size={14} />
                  )}
                  <span>{selectedIds.length === deletedMedicines.length ? 'Delete All' : `Delete (${selectedIds.length})`}</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
