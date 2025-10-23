import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Value, TierId } from '../../types';
import { SwipeDirection } from '../../hooks/useSwipeGesture';
import { useUndoStack } from '../../hooks/useUndoStack';
import { QuickTargetsBar } from './QuickTargetsBar';
import { InboxSection } from './InboxSection';
import { AccordionTier } from './AccordionTier';
import { ActionSheet } from './ActionSheet';
import { ReviewMode } from './ReviewMode';
import { UndoToast } from './UndoToast';
import { SwipeHint } from './SwipeHint';
import { Eye, Share2, Printer, ChevronDown, Trash2, Info } from 'lucide-react';
import { SavedList } from '../../types';
import { SHARE_EXPLANATION_TEXT } from '../../constants/completionText';

interface MobileLayoutProps {
  values: Value[];
  tiers: Array<{
    id: TierId;
    label: string;
    icon: string;
    color: string;
    quota: number | null;
  }>;
  listName: string;
  listId: string;
  savedLists: SavedList[];
  animatingValues: Set<string>;
  onMoveValue: (valueId: string, fromLocation: string, toLocation: TierId, valueName: string) => void;
  onReorderWithinTier: (tierId: TierId, fromIndex: number, toIndex: number) => void;
  onShare: () => void;
  onPrint: () => void;
  onRenameList: (name: string) => void;
  onSwitchList: (listId: string) => void;
  onDeleteList: (listId: string) => void;
  onCreateList: () => void;
  onSwitchToDesktop: () => void;
  onShowAbout: () => void;
  showingACTIntro: boolean;
  showShareExplanation: boolean;
  onDismissShareExplanation: () => void;
  showRenameHint: boolean;
}

export const MobileLayout: React.FC<MobileLayoutProps> = ({
  values,
  tiers,
  listName,
  listId,
  savedLists,
  animatingValues,
  onMoveValue,
  onReorderWithinTier,
  onShare,
  onPrint,
  onRenameList,
  onSwitchList,
  onDeleteList,
  onCreateList,
  onSwitchToDesktop,
  onShowAbout,
  showingACTIntro,
  showShareExplanation,
  onDismissShareExplanation,
  showRenameHint,
}) => {
  const [expandedTier, setExpandedTier] = useState<TierId | null>('very-important');
  const [actionSheetValue, setActionSheetValue] = useState<Value | null>(null);
  const [reviewMode, setReviewMode] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [showUndoToast, setShowUndoToast] = useState(false);
  const [showListDropdown, setShowListDropdown] = useState(false);
  const [shareToast, setShareToast] = useState(false);
  const [isTouchDevice, setIsTouchDevice] = useState(true); // Default to true, detect on mount
  const undoStack = useUndoStack(10);
  const prevShowingIntroRef = useRef(showingACTIntro);

  // Detect if this is a touch device
  useEffect(() => {
    const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    setIsTouchDevice(hasTouch);
  }, []);

  // Show hint after ACT intro is dismissed - coupled to About button
  useEffect(() => {
    if (prevShowingIntroRef.current && !showingACTIntro) {
      // ACT intro just closed, show the hint
      setShowHint(true);
    } else if (showingACTIntro) {
      // Don't show hint while ACT intro is showing
      setShowHint(false);
    }

    prevShowingIntroRef.current = showingACTIntro;
  }, [showingACTIntro]);

  const handleDismissHint = () => {
    setShowHint(false);
    // No longer storing in localStorage - hint is coupled to About button
  };

  // Get inbox values (not in any tier)
  const tierIds: TierId[] = ['very-important', 'somewhat-important', 'not-important'];
  const inboxValues = values.filter(v => !tierIds.includes(v.location as TierId));

  const getValuesByTier = useCallback((tierId: TierId) => {
    return values.filter(v => v.location === tierId);
  }, [values]);

  const totalValues = values.length;
  const categorizedCount = values.filter(v => tierIds.includes(v.location as TierId)).length;

  const handleSwipe = useCallback((value: Value, direction: SwipeDirection) => {
    let targetTier: TierId | null = null;

    switch (direction) {
      case 'right':
        targetTier = 'very-important';
        break;
      case 'left':
        targetTier = 'somewhat-important';
        break;
      case 'up':
        targetTier = 'not-important';
        break;
      default:
        return;
    }

    if (targetTier) {
      onMoveValue(value.id, value.location, targetTier, value.value);
      undoStack.addAction({
        valueId: value.id,
        valueName: value.value,
        fromLocation: value.location,
        toLocation: targetTier,
      });
      setShowUndoToast(true);
      setTimeout(() => setShowUndoToast(false), 4000);
    }
  }, [onMoveValue, undoStack]);

  const handleTapValue = useCallback((value: Value) => {
    setActionSheetValue(value);
  }, []);

  const handleSelectTier = useCallback((tierId: TierId) => {
    if (actionSheetValue) {
      onMoveValue(actionSheetValue.id, actionSheetValue.location, tierId, actionSheetValue.value);
      undoStack.addAction({
        valueId: actionSheetValue.id,
        valueName: actionSheetValue.value,
        fromLocation: actionSheetValue.location,
        toLocation: tierId,
      });
      setActionSheetValue(null);
      setShowUndoToast(true);
      setTimeout(() => setShowUndoToast(false), 4000);
    }
  }, [actionSheetValue, onMoveValue, undoStack]);

  const handleRemoveValue = useCallback((value: Value) => {
    onMoveValue(value.id, value.location, value.category as TierId, value.value);
    undoStack.addAction({
      valueId: value.id,
      valueName: value.value,
      fromLocation: value.location,
      toLocation: value.category,
    });
    setShowUndoToast(true);
    setTimeout(() => setShowUndoToast(false), 4000);
  }, [onMoveValue, undoStack]);

  const handleUndo = useCallback(() => {
    const action = undoStack.undo();
    if (action) {
      // Reverse the action
      onMoveValue(action.valueId, action.toLocation, action.fromLocation as TierId, action.valueName);
    }
    setShowUndoToast(false);
  }, [undoStack, onMoveValue]);

  const handleJumpToTier = useCallback((tierId: TierId) => {
    setExpandedTier(tierId);
    // Scroll to tier after a brief delay
    setTimeout(() => {
      const element = document.getElementById(`tier-${tierId}`);
      element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }, []);

  // Keyboard shortcuts for non-touch devices (only in inbox mode, not review mode)
  useEffect(() => {
    if (isTouchDevice || reviewMode) return; // Only for non-touch devices and not in review mode

    const handleKeyPress = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input field
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      // Get the first inbox value
      const tierIds: TierId[] = ['very-important', 'somewhat-important', 'not-important'];
      const inboxValues = values.filter(v => !tierIds.includes(v.location as TierId));

      if (inboxValues.length === 0) return;

      const firstValue = inboxValues[0];

      // Map keys to tiers
      const tierKeys: Record<string, TierId> = {
        '1': 'very-important',
        '2': 'somewhat-important',
        '3': 'not-important'
      };

      if (tierKeys[e.key]) {
        const targetTier = tierKeys[e.key];
        onMoveValue(firstValue.id, firstValue.location, targetTier, firstValue.value);
        undoStack.addAction({
          valueId: firstValue.id,
          valueName: firstValue.value,
          fromLocation: firstValue.location,
          toLocation: targetTier,
        });
        setShowUndoToast(true);
        setTimeout(() => setShowUndoToast(false), 4000);
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, [isTouchDevice, reviewMode, values, onMoveValue, undoStack]);

  if (reviewMode) {
    return (
      <ReviewMode
        tiers={tiers}
        getValuesByTier={getValuesByTier}
        onExit={() => setReviewMode(false)}
        onJumpToTier={handleJumpToTier}
        onMoveValue={onMoveValue}
        onReorderWithinTier={onReorderWithinTier}
      />
    );
  }

  const handleShare = () => {
    onShare();

    // Only show toast if user has already seen the explanation and not using default name
    const hasDefaultName = listName.startsWith('My values - ');
    const hasSeenExplanation = localStorage.getItem('value-tier-share-explained');
    if (hasSeenExplanation && !hasDefaultName) {
      setShareToast(true);
      setTimeout(() => setShareToast(false), 3000);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-gradient-to-br from-blue-50 to-green-50 dark:from-gray-900 dark:to-gray-800 overflow-x-hidden">
      {/* Compact header */}
      <div className="flex-shrink-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center justify-between gap-2 relative z-50">
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <input
            type="text"
            value={listName}
            onChange={(e) => onRenameList(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur();
              }
            }}
            className={`text-lg font-bold text-gray-800 dark:text-gray-200 bg-transparent border-b-2 ${
              showRenameHint
                ? 'border-blue-500 dark:border-blue-400'
                : 'border-transparent hover:border-gray-300 dark:hover:border-gray-600'
            } focus:border-emerald-500 dark:focus:border-emerald-400 focus:outline-none px-1 flex-1 min-w-0`}
            placeholder="List name..."
          />
          <button
            type="button"
            onClick={() => setShowListDropdown(!showListDropdown)}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors flex-shrink-0"
            title="Switch list"
          >
            <ChevronDown size={20} className={`text-gray-600 dark:text-gray-400 transition-transform ${showListDropdown ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>
        </div>

        <div className="flex gap-1 flex-shrink-0">
          <button
            type="button"
            onClick={onShowAbout}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            title="About"
          >
            <Info size={18} className="text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setReviewMode(true)}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            title="Review all"
          >
            <Eye size={18} className="text-gray-600 dark:text-gray-400" aria-hidden="true" />
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={handleShare}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              title="Share"
            >
              <Share2 size={18} className="text-blue-600 dark:text-blue-400" aria-hidden="true" />
            </button>

            {/* Share explanation popover */}
            {showShareExplanation && (
              <div
                className="absolute top-full mt-2 right-0 w-72 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-4 z-60 animate-fade-in-up"
                role="status"
                aria-live="polite"
              >
                <div className="absolute -top-2 right-4 w-4 h-4 bg-white dark:bg-gray-800 border-l border-t border-gray-200 dark:border-gray-700 transform rotate-45" />
                <button
                  type="button"
                  onClick={onDismissShareExplanation}
                  className="absolute top-2 right-2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                  aria-label="Close"
                >
                  <span aria-hidden="true">✕</span>
                </button>
                <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed pr-4">
                  {SHARE_EXPLANATION_TEXT}
                </p>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onPrint}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            title="Print"
          >
            <Printer size={18} className="text-gray-600 dark:text-gray-400" aria-hidden="true" />
          </button>
        </div>

        {/* List dropdown */}
        {showListDropdown && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border-2 border-gray-300 dark:border-gray-600 rounded-lg shadow-xl z-50 max-h-60 overflow-y-auto">
            <div className="p-2">
              {savedLists.map((list) => (
                <button
                  type="button"
                  key={list.id}
                  onClick={() => {
                    if (list.id !== listId) {
                      onSwitchList(list.id);
                    }
                    setShowListDropdown(false);
                  }}
                  className={`w-full text-left px-3 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center justify-between ${
                    list.id === listId ? 'bg-emerald-50 dark:bg-emerald-900/30 font-medium' : ''
                  }`}
                >
                  <span className="truncate dark:text-gray-200">{list.name}</span>
                  {list.id === listId && savedLists.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Delete "${list.name}"?`)) {
                          onDeleteList(list.id);
                          setShowListDropdown(false);
                        }
                      }}
                      className="p-1 text-red-600 dark:text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-colors flex-shrink-0"
                      title="Delete"
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  )}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  onCreateList();
                  setShowListDropdown(false);
                }}
                className="w-full text-left px-3 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-emerald-600 dark:text-emerald-400 font-medium"
              >
                + New List
              </button>
            </div>
          </div>
        )}

        {/* Rename hint */}
        {showRenameHint && (
          <div className="absolute top-full left-0 right-0 px-4 py-2 bg-blue-50 dark:bg-blue-900/30 border-b border-blue-200 dark:border-blue-700 z-40 animate-fade-in-up">
            <p className="text-sm text-blue-700 dark:text-blue-300 font-medium">
              <span aria-hidden="true">💡</span> Give your list a descriptive name before sharing!
            </p>
          </div>
        )}
      </div>

      {/* Progress bar only - targets are now framing the value */}
      <div className="sticky top-0 z-20 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="h-2 bg-gray-200 dark:bg-gray-700 relative overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-500 to-blue-500 transition-all duration-300"
            style={{ width: `${totalValues > 0 ? (categorizedCount / totalValues) * 100 : 0}%` }}
          />
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {/* Inbox - no padding so frame sits against progress bar and extends to edges */}
        <InboxSection
          values={inboxValues}
          totalValues={totalValues}
          onTapValue={handleTapValue}
          onSwipeValue={handleSwipe}
          animatingValues={animatingValues}
          isTouchDevice={isTouchDevice}
          onReviewMode={() => setReviewMode(true)}
          onShare={handleShare}
          onPrint={onPrint}
          tierCounts={{
            'very-important': getValuesByTier('very-important').length,
            'somewhat-important': getValuesByTier('somewhat-important').length,
            'not-important': getValuesByTier('not-important').length,
          }}
          tierQuotas={{
            'very-important': tiers.find(t => t.id === 'very-important')?.quota ?? null,
            'somewhat-important': tiers.find(t => t.id === 'somewhat-important')?.quota ?? null,
            'not-important': tiers.find(t => t.id === 'not-important')?.quota ?? null,
          }}
          showShareExplanation={showShareExplanation}
          onDismissShareExplanation={onDismissShareExplanation}
        />

        {/* Tiers (accordion) - with padding */}
        <div className="p-4 space-y-4">
          {tiers.map(tier => {
            const tierValues = getValuesByTier(tier.id);
            const isOverQuota = tier.quota && tierValues.length > tier.quota;

            return (
              <div key={tier.id} id={`tier-${tier.id}`}>
                <AccordionTier
                  tier={tier}
                  values={tierValues}
                  isExpanded={expandedTier === tier.id}
                  onToggle={() => {
                    setExpandedTier(expandedTier === tier.id ? null : tier.id);
                  }}
                  onRemoveValue={handleRemoveValue}
                  animatingValues={animatingValues}
                  isOverQuota={!!isOverQuota}
                />
              </div>
            );
          })}
        </div>

        {/* Bottom padding for safe scrolling */}
        <div className="h-4" />

        {/* Footer */}
        <div className="text-center py-4 px-4 text-xs text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          <a
            href="https://github.com/ericphanson/valuetier.org"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-gray-700 dark:hover:text-gray-200 hover:underline"
          >
            Open source
          </a>
          {' • Your data stays private in your browser • Share and save links • '}
          <a
            href="https://ericphanson.com/contact"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-gray-700 dark:hover:text-gray-200 hover:underline"
          >
            Contact
          </a>
          {' • '}
          <button
            type="button"
            onClick={onSwitchToDesktop}
            className="hover:text-gray-700 dark:hover:text-gray-200 hover:underline"
          >
            Desktop mode
          </button>
          {' • '}
          <span className="text-gray-400 dark:text-gray-500" title="Git commit hash">
            {__GIT_HASH__}
          </span>
        </div>
      </div>

      {/* Action sheet */}
      {actionSheetValue && (
        <ActionSheet
          valueName={actionSheetValue.value}
          onSelectTier={handleSelectTier}
          onDismiss={() => setActionSheetValue(null)}
        />
      )}

      {/* Undo toast */}
      {showUndoToast && undoStack.lastAction && (
        <UndoToast
          action={undoStack.lastAction}
          onUndo={handleUndo}
          onDismiss={() => setShowUndoToast(false)}
        />
      )}

      {/* Swipe hint */}
      {showHint && <SwipeHint onDismiss={handleDismissHint} isTouchDevice={isTouchDevice} />}

      {/* Share toast */}
      {shareToast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 bg-gray-800 dark:bg-gray-700 text-white px-4 py-3 rounded-lg shadow-xl z-50 animate-fade-in">
          ✓ Link copied to clipboard!
        </div>
      )}
    </div>
  );
};
