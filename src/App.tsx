import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, Share2, Trash2, Printer, Info } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  DragOverlay,
  closestCenter,
  pointerWithin,
  rectIntersection,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { preloadedDatasets } from './data/datasets';
import { Value, TierId, PersistedState, SavedList, getCanonicalCategoryOrder } from './types';
import { loadList, saveList, loadAllLists, deleteList, renameList, getCurrentListId, setCurrentListId } from './storage';
import { generateFriendlyName, generateListId } from './utils/nameGenerator';
import { debounce } from './utils/debounce';
import { encodeStateToUrl, getShareableUrl, decodeUrlToState } from './urlState';
import { useMediaQuery } from './hooks/useMediaQuery';
import { MobileLayout } from './components/mobile/MobileLayout';
import { ACTIntro } from './components/ACTIntro';
import { DatasetPicker } from './components/DatasetPicker';
import { COMPLETION_NEXT_STEPS, COMPLETION_SAVE_TEXT, SHARE_EXPLANATION_TEXT } from './constants/completionText';

// Check for reset/clear parameter BEFORE any localStorage access
const urlParams = new URLSearchParams(window.location.search);
const shouldClearCache = urlParams.has('clear');
if (shouldClearCache) {
  // Clear all localStorage immediately
  localStorage.clear();

  // Remove the query parameter from URL
  const newUrl = window.location.pathname + window.location.hash;
  window.history.replaceState(null, '', newUrl);

  // Store a flag so we can show a toast after the app loads
  sessionStorage.setItem('cache-just-cleared', 'true');
}

// Sortable value item component
interface SortableValueProps {
  value: Value;
  hoveredValue: Value | null;
  setHoveredValue: (value: Value | null) => void;
  animatingValues: Set<string>;
  isInTier?: boolean;
  containerId: string;
  activeId: string | null;
  isTouchDevice?: boolean;
}

const getValueClass = (value: Value, animatingValues: Set<string>, isInTier: boolean) => {
  // Compact chip spec: text-sm (14px), 12px horizontal padding, 8px vertical padding
  // Keep min-h-[36px] for touch targets while visual is compact
  return isInTier
    ? `relative px-3 py-2 bg-white dark:bg-gray-800 border-2 border-gray-300 dark:border-gray-600 rounded-lg cursor-move hover:shadow-md hover:border-gray-400 dark:hover:border-gray-500 transition-all select-none text-sm min-h-[36px] flex items-center ${
        animatingValues.has(value.id) ? 'animate-pulse ring-4 ring-emerald-300 dark:ring-emerald-700' : ''
      }`
    : `relative px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded cursor-move hover:bg-white dark:hover:bg-gray-600 hover:shadow-md transition-all text-sm select-none min-h-[36px] flex items-center ${
        animatingValues.has(value.id) ? 'animate-pulse ring-4 ring-emerald-300 dark:ring-emerald-700' : ''
      }`;
};

const SortableValue: React.FC<SortableValueProps> = ({
  value,
  hoveredValue,
  setHoveredValue,
  animatingValues,
  isInTier = false,
  containerId,
  activeId,
  isTouchDevice = false,
}) => {
  const valueRef = React.useRef<HTMLDivElement>(null);
  const [tooltipPosition, setTooltipPosition] = React.useState<{ top: number; left: number } | null>(null);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: value.id,
    data: {
      type: 'value',
      containerId,
      value,
    },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    touchAction: 'none', // Prevent scrolling during drag on touch devices
  };

  const baseClass = getValueClass(value, animatingValues, isInTier);

  const updateTooltipPosition = React.useCallback(() => {
    if (valueRef.current && hoveredValue?.id === value.id) {
      const rect = valueRef.current.getBoundingClientRect();
      if (isInTier) {
        // Values in tier columns: tooltip above
        setTooltipPosition({
          top: rect.top - 8, // 8px margin above
          left: rect.left,
        });
      } else {
        // Values in categories (far right): tooltip to the left to avoid cutoff
        setTooltipPosition({
          top: rect.top,
          left: rect.left - 8, // 8px margin to the left, will use transform to shift left
        });
      }
    } else {
      setTooltipPosition(null);
    }
  }, [hoveredValue?.id, value.id, isInTier]);

  React.useEffect(() => {
    updateTooltipPosition();
    window.addEventListener('scroll', updateTooltipPosition, true);
    window.addEventListener('resize', updateTooltipPosition);

    return () => {
      window.removeEventListener('scroll', updateTooltipPosition, true);
      window.removeEventListener('resize', updateTooltipPosition);
    };
  }, [updateTooltipPosition]);

  const handleClick = (e: React.MouseEvent) => {
    if (isTouchDevice) {
      // Toggle hover on tap to show description
      e.stopPropagation();
      if (hoveredValue?.id === value.id) {
        setHoveredValue(null);
      } else {
        setHoveredValue(value);
      }
    }
  };

  return (
    <>
      <div
        ref={(node) => {
          setNodeRef(node);
          valueRef.current = node;
        }}
        style={style}
        {...attributes}
        {...listeners}
        onMouseEnter={() => setHoveredValue(value)}
        onMouseLeave={() => setHoveredValue(null)}
        onClick={handleClick}
        className={`${baseClass} print-value-item`}
        data-value-id={value.id}
      >
        <span className={`${isInTier ? 'font-medium text-gray-800 dark:text-gray-200 block' : 'text-gray-800 dark:text-gray-200 font-medium'} print-value-name`}>
          {value.value}
        </span>
        {value.description && (
          <span className="hidden print:inline print-value-description">
            {value.description}
          </span>
        )}
      </div>

      {/* Render tooltip via portal to avoid clipping */}
      {hoveredValue?.id === value.id && value.description && !activeId && tooltipPosition && createPortal(
        <div
          className="fixed z-[100] p-4 bg-gray-900 dark:bg-gray-700 text-white text-sm rounded-lg shadow-xl w-96 pointer-events-none print-hide"
          style={{
            top: `${tooltipPosition.top}px`,
            left: `${tooltipPosition.left}px`,
            transform: isInTier ? 'translateY(-100%)' : 'translateX(-100%)',
          }}
        >
          {!isTouchDevice && (
            <div className="mb-1 text-emerald-300 text-xs font-semibold">
              {(() => {
                const otherTiers = ['very-important', 'somewhat-important', 'not-important']
                  .map((tierId, idx) => (tierId !== value.location ? `${idx + 1}` : null))
                  .filter(Boolean);

                if (value.location === value.category) {
                  // In category
                  return `Press ${otherTiers.join(', ').replace(/,([^,]*)$/, ', or$1')} to move to a tier`;
                } else {
                  // In tier
                  const tierText = otherTiers.length > 0
                    ? `Press ${otherTiers.join(' or ')} to move to a different tier`
                    : '';
                  const categoryText = ' (or 4 to return it)';
                  return tierText + categoryText;
                }
              })()}
            </div>
          )}
          {value.description}
          <div
            className={`absolute w-0 h-0 print-hide ${
              isInTier
                ? 'top-full left-4 border-l-8 border-r-8 border-t-8 border-transparent border-t-gray-900'
                : 'left-full top-4 border-t-8 border-b-8 border-l-8 border-transparent border-l-gray-900'
            }`}
          />
        </div>,
        document.body
      )}
    </>
  );
};

interface ValueContainerProps {
  containerId: string;
  isTier?: boolean;
  className?: string;
  children: React.ReactNode;
  highlightRingClass?: string;
  style?: React.CSSProperties;
}

const ValueContainer: React.FC<ValueContainerProps> = ({
  containerId,
  isTier = false,
  className = '',
  children,
  highlightRingClass,
  style,
}) => {
  const { setNodeRef, isOver } = useDroppable({
    id: containerId,
    data: {
      type: 'container',
      containerId,
      isTier,
    },
  });

  const baseHighlightClass = isTier ? 'ring-2 ring-emerald-300' : 'ring-2 ring-blue-300';
  const highlightClass = isOver ? (highlightRingClass ?? baseHighlightClass) : '';

  const baseClass = 'relative w-full transition-shadow';
  const sizeClass = isTier ? 'min-h-[4.5rem] flex flex-wrap gap-2 items-start p-2' : '';

  return (
    <div
      ref={setNodeRef}
      className={[baseClass, sizeClass, className, highlightClass].filter(Boolean).join(' ')}
      data-container-id={containerId}
      style={style}
    >
      {children}
    </div>
  );
};

const ValuesTierList = () => {
  const [values, setValues] = useState<Value[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hoveredValue, setHoveredValue] = useState<Value | null>(null);
  const [animatingValues, setAnimatingValues] = useState(new Set<string>());
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [selectedDataset, setSelectedDataset] = useState<string>(() => {
    // Default to last used dataset or 'act-50' for new users
    return localStorage.getItem('value-tier-last-dataset') || 'act-50';
  });
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showACTIntro, setShowACTIntro] = useState(() => {
    // Show intro on first visit
    const hasSeenIntro = localStorage.getItem('value-tier-seen-intro');
    return !hasSeenIntro;
  });
  const [listId, setListId] = useState<string>('');
  const [listName, setListName] = useState<string>('');
  const [savedLists, setSavedLists] = useState<SavedList[]>([]);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [showListDropdown, setShowListDropdown] = useState(false);
  const [showRenameHint, setShowRenameHint] = useState(false);
  const [showShareExplanation, setShowShareExplanation] = useState(false);
  const [showDatasetPicker, setShowDatasetPicker] = useState(false);
  const lastKnownModified = useRef<number>(0);
  const currentFragmentRef = useRef<string | null>(null);
  const initializedRef = useRef<boolean>(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Mobile layout detection
  const isMobileScreen = useMediaQuery('(max-width: 767px)');
  const [forcedMode, setForcedMode] = useState<'mobile' | 'desktop' | null>(() => {
    const saved = localStorage.getItem('value-tier-forced-mode');
    return saved === 'mobile' || saved === 'desktop' ? saved : null;
  });

  // Detect touch capability
  const hasTouchCapability = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  // Layout choice based on screen size only (not touch detection)
  const isMobileLayout = forcedMode === 'desktop' ? false :
                         forcedMode === 'mobile' ? true :
                         isMobileScreen;

  // Determine the natural mode (what mode would be without forcing)
  const naturalMode = isMobileScreen ? 'mobile' : 'desktop';

  // Helper to switch modes - only force if switching away from natural mode
  const switchToMode = (targetMode: 'mobile' | 'desktop') => {
    if (targetMode === naturalMode) {
      // Switching to natural mode - clear any forcing
      setForcedMode(null);
    } else {
      // Switching away from natural mode - force the target mode
      setForcedMode(targetMode);
    }
  };

  // Persist forced mode to localStorage
  useEffect(() => {
    if (forcedMode) {
      localStorage.setItem('value-tier-forced-mode', forcedMode);
    } else {
      localStorage.removeItem('value-tier-forced-mode');
    }
  }, [forcedMode]);

  // Touch devices now work well on both desktop and mobile layouts
  // Desktop uses touch drag, mobile uses swipe gestures

  // Simple throttling: track if update is already scheduled
  const updateScheduled = useRef(false);

  // Configure sensors for drag and drop
  const sensors = useSensors(
    // Mouse for desktop
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 8, // 8px movement required before drag starts
      },
    }),
    // Touch for mobile/tablet - responsive drag and drop
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 60,       // 60ms hold before drag starts
        tolerance: 5,    // 5px tolerance during delay (prevents accidental drags)
      },
    }),
    // Keyboard for accessibility
    useSensor(KeyboardSensor)
  );

  const prioritizeValues = useCallback((collisions: ReturnType<typeof pointerWithin>) => {
    if (!collisions || collisions.length === 0) {
      return collisions;
    }

    const valueCollision = collisions.find((collision) => {
      const container = collision.data?.droppableContainer;
      const type = container?.data?.current?.type;
      return type === 'value';
    });

    return valueCollision ? [valueCollision] : collisions;
  }, []);

  const collisionDetection = useCallback((args: Parameters<typeof closestCenter>[0]) => {
    const pointerCollisions = prioritizeValues(pointerWithin(args));
    if (pointerCollisions && pointerCollisions.length > 0) {
      return pointerCollisions;
    }

    const intersections = prioritizeValues(rectIntersection(args));
    if (intersections && intersections.length > 0) {
      return intersections;
    }

    return prioritizeValues(closestCenter(args));
  }, [prioritizeValues]);

  const reorderValuesForDrag = useCallback((
    prevValues: Value[],
    activeId: string,
    overId: string,
    activeData: Record<string, any> | undefined,
    overData: Record<string, any> | undefined
  ): Value[] => {
    if (activeId === overId) {
      return prevValues;
    }

    const activeValue = prevValues.find(value => value.id === activeId);
    if (!activeValue) {
      return prevValues;
    }

    const activeContainer = activeData?.containerId ?? activeValue.location;

    let overContainer: string | undefined;
    const overType = overData?.type;
    if (overType === 'container') {
      overContainer = overData?.containerId;
    } else if (overType === 'value') {
      overContainer = overData?.containerId;
    } else {
      const overValue = prevValues.find(value => value.id === overId);
      overContainer = overValue?.location;
    }

    if (!overContainer) {
      return prevValues;
    }

    const tierLocations: TierId[] = ['very-important', 'somewhat-important', 'not-important'];

    // Check if source and destination are both categories (not tiers)
    const sourceIsTier = tierLocations.includes(activeContainer as TierId);
    const destIsTier = tierLocations.includes(overContainer as TierId);
    const sourceIsCategory = !sourceIsTier;
    const destIsCategory = !destIsTier;

    // RESTRICTION: Cannot drag within a category (reordering within category)
    if (sourceIsCategory && activeContainer === overContainer) {
      return prevValues;
    }

    // RESTRICTION: Cannot drag from one category to another category
    // Can only drag: category → tier, or tier → category (home), or tier → tier
    if (sourceIsCategory && destIsCategory && activeContainer !== overContainer) {
      // Only allow if going back to home category
      if (overContainer !== activeValue.category) {
        return prevValues;
      }
    }

    // SPECIAL: When dragging from tier to ANY category, send it to home category
    if (sourceIsTier && destIsCategory) {
      // Override the destination to always be the home category
      overContainer = activeValue.category;
    }
    const containerMap = new Map<string, Value[]>();
    for (const value of prevValues) {
      const list = containerMap.get(value.location) ?? [];
      list.push(value);
      containerMap.set(value.location, list);
    }

    const sourceItems = [...(containerMap.get(activeContainer) ?? [])];
    const activeIndex = sourceItems.findIndex(value => value.id === activeId);
    if (activeIndex === -1) {
      return prevValues;
    }

    const [removedValue] = sourceItems.splice(activeIndex, 1);
    containerMap.set(activeContainer, sourceItems);

    const destinationItems = activeContainer === overContainer
      ? sourceItems
      : [...(containerMap.get(overContainer) ?? [])];

    let targetIndex = destinationItems.length;
    if (overType === 'container') {
      targetIndex = destinationItems.length;
    } else if (overData?.sortable) {
      targetIndex = overData.sortable.index ?? destinationItems.length;
      if (activeContainer === overContainer && targetIndex > activeIndex) {
        targetIndex -= 1;
      }
    } else {
      const fallbackIndex = destinationItems.findIndex(value => value.id === overId);
      if (fallbackIndex >= 0) {
        targetIndex = fallbackIndex;
      }
    }

    if (activeContainer === overContainer && targetIndex === activeIndex) {
      return prevValues;
    }

    const updatedActiveValue: Value = { ...removedValue, location: overContainer };
    const clampedIndex = Math.min(Math.max(targetIndex, 0), destinationItems.length);
    destinationItems.splice(clampedIndex, 0, updatedActiveValue);
    containerMap.set(overContainer, destinationItems);

    const orderedLocations: string[] = [...tierLocations, ...categories];
    const seen = new Set<string>();
    const nextValues: Value[] = [];

    for (const location of orderedLocations) {
      const items = containerMap.get(location);
      if (!items || items.length === 0) {
        continue;
      }
      seen.add(location);
      nextValues.push(...items);
    }

    for (const [location, items] of containerMap.entries()) {
      if (items.length === 0 || seen.has(location)) {
        continue;
      }
      nextValues.push(...items);
    }

    const hasChanged = nextValues.length !== prevValues.length
      || nextValues.some((value, index) => {
        const previous = prevValues[index];
        return value.id !== previous.id || value.location !== previous.location;
      });

    return hasChanged ? nextValues : prevValues;
  }, [categories]);

  // Simple throttled update during drag - prevents too many re-renders
  const scheduleReorder = useCallback((
    activeId: string,
    overId: string,
    activeData?: Record<string, any>,
    overData?: Record<string, any>
  ) => {
    // Skip if update already scheduled
    if (updateScheduled.current) return;

    updateScheduled.current = true;
    requestAnimationFrame(() => {
      setValues(prevValues => {
        const nextValues = reorderValuesForDrag(prevValues, activeId, overId, activeData, overData);
        return nextValues === prevValues ? prevValues : nextValues;
      });
      updateScheduled.current = false;
    });
  }, [reorderValuesForDrag]);

  const tiers = [
    { id: 'very-important' as TierId, label: 'Very Important to Me', color: 'bg-emerald-50 border-emerald-200', icon: '💎', quota: 10 },
    { id: 'somewhat-important' as TierId, label: 'Somewhat Important to Me', color: 'bg-blue-50 border-blue-200', icon: '⭐', quota: null },
    { id: 'not-important' as TierId, label: 'Not Important to Me', color: 'bg-gray-50 border-gray-200', icon: '○', quota: null }
  ];

  const tierHighlightClass: Record<TierId, string> = {
    'very-important': 'ring-2 ring-emerald-200',
    'somewhat-important': 'ring-2 ring-blue-200',
    'not-important': 'ring-2 ring-gray-200',
    'uncategorized': 'ring-2 ring-blue-300',
  };

  const tierKeys: Record<string, TierId> = {
    '1': 'very-important',
    '2': 'somewhat-important',
    '3': 'not-important'
  };

  // Convert runtime state to persisted format
  const serializeState = useCallback((): PersistedState => {
    const dataset = preloadedDatasets[selectedDataset];
    const tierOrder: TierId[] = ['very-important', 'somewhat-important', 'not-important'];
    const tiers: Record<TierId, number[]> = {
      'very-important': [],
      'somewhat-important': [],
      'not-important': [],
      'uncategorized': [],
    };

    for (const tier of tierOrder) {
      const tierValues = values.filter(value => value.location === tier);
      tiers[tier] = tierValues.map(value => parseInt(value.id.replace('value-', ''), 10));
    }

    // Values not in tiers remain uncategorized
    const uncategorizedValues = values.filter(
      value => !tierOrder.includes(value.location as TierId)
    );
    tiers['uncategorized'] = uncategorizedValues.map(value => parseInt(value.id.replace('value-', ''), 10));

    return {
      listId,
      listName,
      datasetName: selectedDataset,
      datasetVersion: dataset.version,
      tiers,
      categoryOrder: categories,
      collapsedCategories,
      timestamp: Date.now()
    };
  }, [values, categories, collapsedCategories, selectedDataset, listId, listName]);

  // Refresh saved lists
  const refreshSavedLists = useCallback(() => {
    const result = loadAllLists();
    setSavedLists(result.lists);
    if (result.error) {
      showToast(result.error, 5000);
    }
  }, []);

  // Detect if this is a touch device
  useEffect(() => {
    const checkTouch = () => {
      const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      setIsTouchDevice(hasTouch);
    };
    checkTouch();
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowListDropdown(false);
      }
    };

    if (showListDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showListDropdown]);

  const debouncedSaveList = useMemo(
    () =>
      debounce((list: SavedList) => {
        saveList(list);
        lastKnownModified.current = list.lastModified;
      }, 150),
    []
  );

  const debouncedRenameList = useMemo(
    () =>
      debounce((id: string, newName: string) => {
        renameList(id, newName);
        // Update lastKnownModified to prevent conflict detection
        const result = loadList(id);
        if (result.list) {
          lastKnownModified.current = result.list.lastModified;
        }
        if (result.error) {
          showToast(result.error, 5000);
        }
        const allListsResult = loadAllLists();
        setSavedLists(allListsResult.lists);
        if (allListsResult.error) {
          showToast(allListsResult.error, 5000);
        }
      }, 300),
    []
  );

  // Load dataset from data file
  const loadDataset = useCallback((datasetKey: string, preserveState = false) => {
    const dataset = preloadedDatasets[datasetKey];
    if (!dataset) return;

    const importedValues: Value[] = dataset.data.map((item, idx) => ({
      id: `value-${idx}`,
      value: item.name,
      name: item.name,
      description: item.description,
      category: item.category,
      location: preserveState ? 'uncategorized' : item.category
    }));

    const uniqueCategories = [...new Set(importedValues.map(v => v.category))];

    if (!preserveState) {
      setValues(importedValues);
      setCategories(uniqueCategories);
      setCollapsedCategories({});
    }

    return { importedValues, uniqueCategories };
  }, []);

  // Hydrate state from persisted data
  const hydrateState = useCallback((persisted: PersistedState) => {
    const dataset = preloadedDatasets[persisted.datasetName];

    // Always use act-shorter dataset
    if (!dataset || dataset.version !== persisted.datasetVersion) {
      loadDataset('act-shorter');
      return;
    }

    // Set selectedDataset FIRST to ensure all downstream effects use the correct dataset
    setSelectedDataset(persisted.datasetName);
    localStorage.setItem('value-tier-last-dataset', persisted.datasetName);

    // Create values from dataset
    const importedValues: Value[] = dataset.data.map((item, idx) => ({
      id: `value-${idx}`,
      value: item.name,
      name: item.name,
      description: item.description,
      category: item.category,
      location: item.category // default to category, will be overridden if in a tier
    }));

    const tierOrder: TierId[] = ['very-important', 'somewhat-important', 'not-important'];

    // Apply saved tier assignments and preserve the saved ordering for each tier
    const orderedValues: Value[] = [];
    const usedIds = new Set<string>();

    for (const tier of tierOrder) {
      const indices = persisted.tiers?.[tier] ?? [];
      for (const idx of indices) {
        const value = importedValues[idx];
        if (!value || usedIds.has(value.id)) continue;
        value.location = tier;
        orderedValues.push(value);
        usedIds.add(value.id);
      }
    }

    // Append uncategorized values in the saved order (falls back to dataset order)
    const uncategorizedIndices = persisted.tiers?.['uncategorized'] ?? [];
    for (const idx of uncategorizedIndices) {
      const value = importedValues[idx];
      if (!value || usedIds.has(value.id)) continue;
      value.location = value.category;
      orderedValues.push(value);
      usedIds.add(value.id);
    }

    // Append any remaining values (shouldn't happen, but keep dataset order as fallback)
    for (const value of importedValues) {
      if (usedIds.has(value.id)) continue;
      value.location = value.category;
      orderedValues.push(value);
      usedIds.add(value.id);
    }

    const uniqueCategories = [...new Set(importedValues.map(v => v.category))];

    setValues(orderedValues);
    setCategories(persisted.categoryOrder.length > 0 ? persisted.categoryOrder : uniqueCategories);
    setCollapsedCategories(persisted.collapsedCategories);
    setListId(persisted.listId);
    setListName(persisted.listName);
  }, [loadDataset]);

  // Create a new list with specified dataset
  const createNewList = useCallback((datasetKey: string) => {
    const newId = generateListId();
    const newName = generateFriendlyName();

    setListId(newId);
    setListName(newName);
    setCurrentListId(newId);
    lastKnownModified.current = Date.now();

    // Update selectedDataset and persist to localStorage
    setSelectedDataset(datasetKey);
    localStorage.setItem('value-tier-last-dataset', datasetKey);

    loadDataset(datasetKey);

    // Create initial empty state and save it immediately so it appears in the list picker
    const dataset = preloadedDatasets[datasetKey];
    const canonicalCategoryOrder = getCanonicalCategoryOrder(dataset);
    const initialState: PersistedState = {
      listId: newId,
      listName: newName,
      datasetName: datasetKey,
      datasetVersion: dataset.version,
      tiers: {
        'very-important': [],
        'somewhat-important': [],
        'not-important': [],
        'uncategorized': []
      },
      categoryOrder: canonicalCategoryOrder,
      collapsedCategories: {},
      timestamp: Date.now()
    };

    const initialHash = encodeStateToUrl(initialState, dataset.data.length, canonicalCategoryOrder);
    const newList: SavedList = {
      id: newId,
      name: newName,
      datasetName: datasetKey,
      fragment: initialHash,
      lastModified: Date.now(),
      createdAt: Date.now()
    };

    saveList(newList);
    refreshSavedLists();
  }, [loadDataset, refreshSavedLists]);

  // Load state on mount - check URL first, then current list, then create new
  useEffect(() => {
    // Prevent duplicate initialization (React StrictMode, hot reload)
    if (initializedRef.current) {
      return;
    }

    initializedRef.current = true;

    let mounted = true;

    const initializeApp = () => {
      if (!mounted) return;

      // Check if cache was just cleared (set at module level)
      const cacheCleared = sessionStorage.getItem('cache-just-cleared');
      if (cacheCleared) {
        sessionStorage.removeItem('cache-just-cleared');
        showToast('✓ Cache cleared! App reset successfully.', 4000);
        // Show dataset picker after clearing (user has seen intro before)
        const hasSeenIntro = localStorage.getItem('value-tier-seen-intro');
        if (hasSeenIntro) {
          setShowDatasetPicker(true);
        } else {
          // First time after clear - will show ACTIntro first
          setShowACTIntro(true);
        }
        return;
      }

      const hash = window.location.hash;

      // Try URL first (for shared links)
      if (hash && hash.length > 1) {
        // First decode to get the dataset name from URL
        const tempDataset = preloadedDatasets['act-shorter']; // Use temporary dataset for initial decode
        const tempCanonicalOrder = getCanonicalCategoryOrder(tempDataset);
        const persistedFromHash = decodeUrlToState(hash, tempDataset.data.length, tempCanonicalOrder);

        if (persistedFromHash && persistedFromHash.listId) {
          currentFragmentRef.current = hash;

          // Get the correct dataset from the decoded state
          const datasetName = persistedFromHash.datasetName || 'act-shorter';
          const dataset = preloadedDatasets[datasetName];

          if (!dataset) {
            showToast(`Unknown dataset: ${datasetName}. Please choose a dataset.`, 5000);
            setShowDatasetPicker(true);
            return;
          }

          // Re-decode with correct dataset
          const canonicalOrder = getCanonicalCategoryOrder(dataset);
          const correctPersisted = decodeUrlToState(hash, dataset.data.length, canonicalOrder);

          if (!correctPersisted || !correctPersisted.listId) {
            showToast('Failed to load data from URL. Starting with a new list.', 5000);
            setShowDatasetPicker(true);
            return;
          }

          // Save this list to storage if it's new
          const result = loadList(correctPersisted.listId);
          if (result.error) {
            showToast(result.error, 5000);
            setShowDatasetPicker(true);
            return;
          }

          if (!result.list) {
            const newList: SavedList = {
              id: correctPersisted.listId,
              name: correctPersisted.listName || 'Shared List',
              datasetName: datasetName,
              fragment: hash,
              lastModified: Date.now(),
              createdAt: Date.now()
            };
            saveList(newList);
          }

          // Update selectedDataset to match the loaded list
          setSelectedDataset(datasetName);
          localStorage.setItem('value-tier-last-dataset', datasetName);

          hydrateState(correctPersisted as PersistedState);
          setCurrentListId(correctPersisted.listId);
          lastKnownModified.current = Date.now();
          refreshSavedLists();

          // Clear the URL hash after loading to prevent accidental sharing
          const cleanUrl = `${window.location.origin}${window.location.pathname}${window.location.search}`;
          window.history.replaceState(null, '', cleanUrl);

          return;
        } else {
          // Failed to decode URL state
          showToast('Failed to load data from URL. Please choose a dataset.', 5000);
          setShowDatasetPicker(true);
          return;
        }
      }

      // Try loading current list
      const currentId = getCurrentListId();
      if (currentId) {
        const result = loadList(currentId);
        if (result.error) {
          showToast(result.error, 5000);
          setShowDatasetPicker(true);
          return;
        }

        if (result.list) {
          const dataset = preloadedDatasets[result.list.datasetName];
          if (dataset) {
            const canonicalOrder = getCanonicalCategoryOrder(dataset);
            const persisted = decodeUrlToState(result.list.fragment, dataset.data.length, canonicalOrder);
            if (persisted) {
              currentFragmentRef.current = result.list.fragment;

              // Update selectedDataset to match the loaded list
              setSelectedDataset(result.list.datasetName);
              localStorage.setItem('value-tier-last-dataset', result.list.datasetName);

              hydrateState(persisted as PersistedState);
              lastKnownModified.current = result.list.lastModified;
              refreshSavedLists();
              return;
            } else {
              showToast('Failed to decode list data. Please choose a dataset.', 5000);
            }
          }
        }
      }

      // No URL state and no current list
      // Only show dataset picker if not showing ACT intro (first-time user flow)
      const hasSeenIntro = localStorage.getItem('value-tier-seen-intro');
      if (hasSeenIntro) {
        setShowDatasetPicker(true);
      }
      // Otherwise, ACTIntro will show first, then dataset picker on close
    };

    initializeApp();

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps - only run once on mount

  // Save state when it changes (to localStorage only, not URL)
  useEffect(() => {
    if (values.length > 0 && listId) {
      const state = serializeState();
      const dataset = preloadedDatasets[selectedDataset];
      const canonicalCategoryOrder = getCanonicalCategoryOrder(dataset);
      const newHash = encodeStateToUrl(state, dataset.data.length, canonicalCategoryOrder);

      // Save to localStorage
      if (currentFragmentRef.current !== newHash) {
        currentFragmentRef.current = newHash;
        const listToSave: SavedList = {
          id: listId,
          name: listName,
          datasetName: selectedDataset,
          fragment: newHash,
          lastModified: Date.now(),
          createdAt: loadList(listId).list?.createdAt || Date.now()
        };
        debouncedSaveList(listToSave);
      }
    }
  }, [values, categories, collapsedCategories, selectedDataset, listId, listName, serializeState, debouncedSaveList]);

  // Listen for storage changes from other tabs and auto-reload
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      // Only handle changes to our saved lists
      if (e.key !== 'value-tier-saved-lists' || !e.newValue) return;

      // Reload the current list from storage
      const result = loadList(listId);
      if (result.error) {
        showToast(result.error, 5000);
        return;
      }

      if (result.list) {
        const dataset = preloadedDatasets[result.list.datasetName];
        if (dataset) {
          const canonicalOrder = getCanonicalCategoryOrder(dataset);
          const persisted = decodeUrlToState(result.list.fragment, dataset.data.length, canonicalOrder);
          if (persisted) {
            hydrateState(persisted as PersistedState);
            lastKnownModified.current = result.list.lastModified;
            currentFragmentRef.current = result.list.fragment;
          } else {
            showToast('Failed to decode list data from another tab.', 5000);
          }
        }
      }

      // Also refresh the saved lists dropdown
      refreshSavedLists();
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [listId, hydrateState, refreshSavedLists]);

  const showToast = (message: string, duration = 3000) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), duration);
  };

  const handleShare = async () => {
    try {
      // Check if using default generated name
      const hasDefaultName = listName.startsWith('My values - ');

      if (hasDefaultName) {
        // Show hint and focus title input
        setShowRenameHint(true);
        titleInputRef.current?.focus();
        titleInputRef.current?.select();

        // Auto-hide hint after 4 seconds
        setTimeout(() => setShowRenameHint(false), 4000);
        return;
      }

      const state = serializeState();
      const dataset = preloadedDatasets[selectedDataset];
      const canonicalCategoryOrder = getCanonicalCategoryOrder(dataset);
      const shareUrl = getShareableUrl(state, dataset.data.length, canonicalCategoryOrder);

      if (navigator.clipboard) {
        await navigator.clipboard.writeText(shareUrl);
        showToast('✓ Link copied to clipboard!');
      } else {
        // Fallback for older browsers
        prompt('Copy this URL to share:', shareUrl);
      }

      // Show explanation popover on first share
      const hasSeenExplanation = localStorage.getItem('value-tier-share-explained');
      if (!hasSeenExplanation) {
        setShowShareExplanation(true);
        localStorage.setItem('value-tier-share-explained', 'true');
        // Auto-hide after 8 seconds
        setTimeout(() => setShowShareExplanation(false), 8000);
      }
    } catch (error) {
      showToast('✗ Failed to copy link');
    }
  };

  // Track mouse position
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({ x: e.clientX, y: e.clientY });
    };
    document.addEventListener('mousemove', handleMouseMove);
    return () => document.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // Update hover after value positions change
  const updateHoverFromMousePosition = () => {
    setTimeout(() => {
      const element = document.elementFromPoint(mousePosition.x, mousePosition.y);
      if (element) {
        const valueElement = element.closest('[data-value-id]');
        if (valueElement) {
          const valueId = valueElement.getAttribute('data-value-id');
          const value = values.find(v => v.id === valueId);
          if (value) {
            setHoveredValue(value);
          }
        }
      }
    }, 50);
  };

  // Keyboard shortcut handler
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input field
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      if (hoveredValue && (tierKeys[e.key] || e.key === '4')) {
        let targetLocation: string;

        if (e.key === '4') {
          targetLocation = hoveredValue.category;
        } else {
          targetLocation = tierKeys[e.key];
        }

        const tierOrder: string[] = ['very-important', 'somewhat-important', 'not-important'];
        const currentlyInCategory = !tierOrder.includes(hoveredValue.location);
        const targetIsCategory = !tierOrder.includes(targetLocation);

        // Don't do anything if item is in a category and target is the same category
        // (categories have immutable order)
        if (currentlyInCategory && targetIsCategory && hoveredValue.location === targetLocation) {
          return;
        }

        // Trigger animation and move with minimal move logic
        const valueId = hoveredValue.id;

        setValues(prev => {
          // Remove the value from its current position
          const filtered = prev.filter(v => v.id !== valueId);

          // Update the value's location
          const updatedValue = { ...hoveredValue, location: targetLocation };

          // Determine if this is a "minimal move" (up, down, or same tier)
          const fromTierIndex = tierOrder.indexOf(hoveredValue.location);
          const toTierIndex = tierOrder.indexOf(targetLocation);

          // Minimal move logic:
          // - Moving UP (lower index = higher tier): insert at BOTTOM/END
          // - Moving DOWN or SAME tier: insert at TOP/START
          const insertAtStart = fromTierIndex <= toTierIndex && fromTierIndex !== -1;

          if (toTierIndex !== -1) {
            // It's a tier
            let insertIndex = 0;
            // Skip all tiers before this one
            for (let i = 0; i < toTierIndex; i++) {
              const tierCount = filtered.filter(v => v.location === tierOrder[i]).length;
              insertIndex += tierCount;
            }

            // If inserting at start of tier, use current index
            // If inserting at end, add the count of items in target tier
            if (!insertAtStart) {
              const targetTierCount = filtered.filter(v => v.location === targetLocation).length;
              insertIndex += targetTierCount;
            }

            filtered.splice(insertIndex, 0, updatedValue);
          } else {
            // It's a category - find position among categories (after all tiers)
            const tiersCount = filtered.filter(v => tierOrder.includes(v.location)).length;
            const categoryIndex = categories.indexOf(targetLocation);

            let insertIndex = tiersCount;
            // Skip all categories before this one
            for (let i = 0; i < categoryIndex; i++) {
              const catCount = filtered.filter(v => v.location === categories[i]).length;
              insertIndex += catCount;
            }
            // Add count of items in target category (to get to the end)
            const targetCatCount = filtered.filter(v => v.location === targetLocation).length;
            insertIndex += targetCatCount;

            filtered.splice(insertIndex, 0, updatedValue);
          }

          return filtered;
        });

        setAnimatingValues(prev => new Set(prev).add(valueId));
        setTimeout(() => {
          setAnimatingValues(prev => {
            const newSet = new Set(prev);
            newSet.delete(valueId);
            return newSet;
          });
        }, 500);

        setHoveredValue(null);
        updateHoverFromMousePosition();
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, [hoveredValue, mousePosition, values, tierKeys, categories]);

  const findValueById = useCallback(
    (id: string) => values.find(value => value.id === id) ?? null,
    [values]
  );

  const activeValue = useMemo(() => (activeId ? findValueById(activeId) : null), [activeId, findValueById]);

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const id = String(active.id);
    setActiveId(id);
    setHoveredValue(null);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;

    if (!over) {
      setHoveredValue(null);
      return;
    }

    if (over.data?.current?.type === 'value') {
      const value = findValueById(String(over.id));
      if (value) {
        setHoveredValue(value);
      }
    } else {
      setHoveredValue(null);
    }

    const activeId = String(active.id);
    let overId = String(over.id);

    // Redirect header drops to the main tier container
    if (overId.endsWith('-header')) {
      overId = overId.replace('-header', '');
    }

    if (activeId === overId) {
      return;
    }

    const activeData = active.data?.current as Record<string, any> | undefined;
    let overData = over.data?.current as Record<string, any> | undefined;

    // Update container ID if dropping on header
    if (overData?.containerId?.endsWith('-header')) {
      overData = {
        ...overData,
        containerId: overData.containerId.replace('-header', '')
      };
    }

    scheduleReorder(activeId, overId, activeData, overData);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over) {
      setHoveredValue(null);
      return;
    }

    const activeId = String(active.id);
    let overId = String(over.id);

    // Redirect header drops to the main tier container
    if (overId.endsWith('-header')) {
      overId = overId.replace('-header', '');
    }

    if (activeId === overId) {
      setHoveredValue(null);
      return;
    }

    const activeData = active.data?.current as Record<string, any> | undefined;
    let overData = over.data?.current as Record<string, any> | undefined;

    // Update container ID if dropping on header
    if (overData?.containerId?.endsWith('-header')) {
      overData = {
        ...overData,
        containerId: overData.containerId.replace('-header', '')
      };
    }

    setValues(prevValues => {
      const nextValues = reorderValuesForDrag(prevValues, activeId, overId, activeData, overData);
      return nextValues === prevValues ? prevValues : nextValues;
    });

    setHoveredValue(null);
  };

  const handleDragCancel = () => {
    setActiveId(null);
    setHoveredValue(null);
  };

  const toggleCategory = (category: string) => {
    setCollapsedCategories(prev => ({
      ...prev,
      [category]: !prev[category]
    }));
  };

  const getValuesByLocation = (location: string) => {
    return values.filter(v => v.location === location);
  };

  // Helper for mobile layout to move values
  const handleMoveValueMobile = useCallback((valueId: string, fromLocation: string, toLocation: TierId, valueName: string) => {
    const tierOrder: TierId[] = ['very-important', 'somewhat-important', 'not-important'];

    setValues(prevValues => {
      const filtered = prevValues.filter(v => v.id !== valueId);
      const value = prevValues.find(v => v.id === valueId);

      if (!value) return prevValues;

      const updatedValue = { ...value, location: toLocation };

      // Determine if this is a "minimal move" (up, down, or same tier)
      const fromTierIndex = tierOrder.indexOf(fromLocation as TierId);
      const toTierIndex = tierOrder.indexOf(toLocation);

      // Minimal move logic:
      // - Moving UP (lower index = higher tier): insert at BOTTOM/END
      // - Moving DOWN or SAME tier: insert at TOP/START
      const insertAtStart = fromTierIndex <= toTierIndex && fromTierIndex !== -1;

      if (toTierIndex !== -1) {
        // It's a tier
        let insertIndex = 0;
        for (let i = 0; i < toTierIndex; i++) {
          insertIndex += filtered.filter(v => v.location === tierOrder[i]).length;
        }

        // If inserting at start of tier, use current index
        // If inserting at end, add the count of items in target tier
        if (!insertAtStart) {
          insertIndex += filtered.filter(v => v.location === toLocation).length;
        }

        filtered.splice(insertIndex, 0, updatedValue);
      } else {
        // It's a category - insert at the end of categories
        const tiersCount = filtered.filter(v => tierOrder.includes(v.location as TierId)).length;
        const categoryIndex = categories.indexOf(toLocation);

        let insertIndex = tiersCount;
        for (let i = 0; i < categoryIndex; i++) {
          insertIndex += filtered.filter(v => v.location === categories[i]).length;
        }
        insertIndex += filtered.filter(v => v.location === toLocation).length;

        filtered.splice(insertIndex, 0, updatedValue);
      }

      return filtered;
    });

    // Trigger animation
    setAnimatingValues(prev => new Set(prev).add(valueId));
    setTimeout(() => {
      setAnimatingValues(prev => {
        const newSet = new Set(prev);
        newSet.delete(valueId);
        return newSet;
      });
    }, 500);
  }, [categories]);

  // Helper for mobile review mode to reorder within a tier
  const handleReorderWithinTier = useCallback((tierId: TierId, fromIndex: number, toIndex: number) => {
    setValues(prevValues => {
      const tierValues = prevValues.filter(v => v.location === tierId);

      if (fromIndex < 0 || fromIndex >= tierValues.length || toIndex < 0 || toIndex >= tierValues.length) {
        return prevValues;
      }

      // Remove the value from the tier list
      const [movedValue] = tierValues.splice(fromIndex, 1);
      // Insert it at the new position
      tierValues.splice(toIndex, 0, movedValue);

      // Reconstruct the full values array with the reordered tier
      const tierOrder: TierId[] = ['very-important', 'somewhat-important', 'not-important'];
      const result: Value[] = [];

      for (const tier of tierOrder) {
        if (tier === tierId) {
          result.push(...tierValues);
        } else {
          result.push(...prevValues.filter(v => v.location === tier));
        }
      }

      // Add remaining values (categories)
      result.push(...prevValues.filter(v => !tierOrder.includes(v.location as TierId)));

      return result;
    });
  }, []);

  return (
    <>
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
      accessibility={{
        announcements: {
          onDragStart: () => '',
          onDragOver: () => '',
          onDragEnd: () => '',
          onDragCancel: () => '',
        },
        screenReaderInstructions: {
          draggable: '',
        },
      }}
    >
      {/* Mobile layout - show on mobile screens, hide on print */}
      {isMobileLayout && (
        <div className="print:hidden">
          <MobileLayout
            values={values}
            tiers={tiers}
            listName={listName}
            listId={listId}
            savedLists={savedLists}
            animatingValues={animatingValues}
            onMoveValue={handleMoveValueMobile}
            onReorderWithinTier={handleReorderWithinTier}
            onShare={handleShare}
            onPrint={() => window.print()}
            onRenameList={(newName) => {
              setListName(newName);
              debouncedRenameList(listId, newName);
              // Hide hint once user starts typing
              if (showRenameHint) {
                setShowRenameHint(false);
              }
            }}
            showShareExplanation={showShareExplanation}
            onDismissShareExplanation={() => setShowShareExplanation(false)}
            showRenameHint={showRenameHint}
            onSwitchList={(switchToListId) => {
              // Save current list immediately before switching to avoid losing changes
              if (switchToListId !== listId && values.length > 0 && listId) {
                const state = serializeState();
                const currentDataset = preloadedDatasets[selectedDataset];
                const currentCanonicalOrder = getCanonicalCategoryOrder(currentDataset);
                const currentHash = encodeStateToUrl(state, currentDataset.data.length, currentCanonicalOrder);
                const listToSave: SavedList = {
                  id: listId,
                  name: listName,
                  datasetName: selectedDataset,
                  fragment: currentHash,
                  lastModified: Date.now(),
                  createdAt: loadList(listId).list?.createdAt || Date.now()
                };
                saveList(listToSave);
              }

              const result = loadList(switchToListId);
              if (result.error) {
                showToast(result.error, 5000);
                return;
              }

              if (result.list) {
                const dataset = preloadedDatasets[result.list.datasetName];
                if (dataset) {
                  const canonicalOrder = getCanonicalCategoryOrder(dataset);
                  const persisted = decodeUrlToState(result.list.fragment, dataset.data.length, canonicalOrder);
                  if (persisted) {
                    currentFragmentRef.current = result.list.fragment;
                    hydrateState(persisted as PersistedState);
                    setCurrentListId(switchToListId);
                    lastKnownModified.current = result.list.lastModified;
                  } else {
                    showToast('Failed to decode the selected list.', 5000);
                  }
                }
              }
            }}
            onDeleteList={(deleteListId) => {
              deleteList(deleteListId);
              refreshSavedLists();

              const remainingListsResult = loadAllLists();
              if (remainingListsResult.error) {
                showToast(remainingListsResult.error, 5000);
                createNewList(selectedDataset);
                return;
              }

              if (remainingListsResult.lists.length > 0) {
                const nextList = remainingListsResult.lists[0];
                const dataset = preloadedDatasets[nextList.datasetName];
                if (dataset) {
                  const canonicalOrder = getCanonicalCategoryOrder(dataset);
                  const persisted = decodeUrlToState(nextList.fragment, dataset.data.length, canonicalOrder);
                  if (persisted) {
                    const nextUrl = `${window.location.origin}${window.location.pathname}${window.location.search}${nextList.fragment}`;
                    window.history.replaceState(null, '', nextUrl);
                    currentFragmentRef.current = nextList.fragment;
                    hydrateState(persisted as PersistedState);
                    setCurrentListId(nextList.id);
                    lastKnownModified.current = nextList.lastModified;
                  } else {
                    showToast('Failed to decode list data. Creating a new list.', 5000);
                    createNewList(selectedDataset);
                  }
                }
              } else {
                createNewList(selectedDataset);
              }
            }}
            onCreateList={() => {
              setShowDatasetPicker(true);
            }}
            onSwitchToDesktop={() => switchToMode('desktop')}
            onShowAbout={() => setShowACTIntro(true)}
            showingACTIntro={showACTIntro}
          />
        </div>
      )}

      {/* Desktop layout - show on desktop screens OR when printing from mobile */}
      <div className={isMobileLayout ? "hidden print:block" : "block"}>
      <div className="h-screen bg-gradient-to-br from-blue-50 to-green-50 dark:from-gray-900 dark:to-gray-800 p-3 md:p-6 overflow-hidden">
      <div className="max-w-7xl mx-auto h-full flex flex-col">

        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 mb-4 print-header flex-shrink-0 relative z-50">
          <div className="flex flex-col gap-3">
            {/* Consolidated title with dropdown */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                {/* Print-only: simple title */}
                <h1 className="hidden print:block text-xl font-semibold text-gray-800 print-main-heading">
                  {listName || 'Values Tier List'}
                </h1>

                {/* Screen: editable title with dropdown button */}
                <div className="print-hide relative" ref={dropdownRef}>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <input
                        ref={titleInputRef}
                        type="text"
                        value={listName}
                        onChange={(e) => {
                          const newName = e.target.value;
                          setListName(newName);
                          debouncedRenameList(listId, newName);
                          // Hide hint once user starts typing
                          if (showRenameHint) {
                            setShowRenameHint(false);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.currentTarget.blur();
                          }
                        }}
                        className={`text-xl font-semibold text-gray-800 dark:text-gray-200 bg-transparent border-2 ${
                          showRenameHint
                            ? 'border-blue-500 dark:border-blue-400 ring-2 ring-blue-200 dark:ring-blue-900'
                            : 'border-transparent hover:border-gray-300 dark:hover:border-gray-600'
                        } focus:border-emerald-500 dark:focus:border-emerald-400 focus:outline-none rounded px-2 py-1 flex-1 transition-all`}
                        placeholder="Enter list name..."
                      />
                    <button
                      type="button"
                      onClick={() => setShowListDropdown(!showListDropdown)}
                      className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                      title="Switch list"
                    >
                      <ChevronDown size={24} className={`dark:text-gray-300 transition-transform ${showListDropdown ? 'rotate-180' : ''}`} aria-hidden="true" />
                    </button>
                  </div>

                  {/* Rename hint */}
                  {showRenameHint && (
                    <div className="text-sm text-blue-600 dark:text-blue-400 font-medium px-2 animate-fade-in-up">
                      <span aria-hidden="true">💡</span> Give your list a descriptive name before sharing!
                    </div>
                  )}
                  </div>

                  {/* Dropdown menu */}
                  {showListDropdown && (
                    <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-gray-800 border-2 border-gray-300 dark:border-gray-600 rounded-lg shadow-xl z-50 max-h-80 overflow-y-auto print-hide">
                      <div className="p-2">
                        {savedLists.map((list) => (
                          <div
                            key={list.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => {
                              if (list.id !== listId) {
                                // Save current list immediately before switching to avoid losing changes
                                if (values.length > 0 && listId) {
                                  const state = serializeState();
                                  const currentDataset = preloadedDatasets[selectedDataset];
                                  const currentCanonicalOrder = getCanonicalCategoryOrder(currentDataset);
                                  const currentHash = encodeStateToUrl(state, currentDataset.data.length, currentCanonicalOrder);
                                  const listToSave: SavedList = {
                                    id: listId,
                                    name: listName,
                                    datasetName: selectedDataset,
                                    fragment: currentHash,
                                    lastModified: Date.now(),
                                    createdAt: loadList(listId).list?.createdAt || Date.now()
                                  };
                                  saveList(listToSave);
                                }

                                // Load fresh from localStorage (not stale React state)
                                const result = loadList(list.id);
                                if (result.error) {
                                  showToast(result.error, 5000);
                                  return;
                                }

                                if (result.list) {
                                  const dataset = preloadedDatasets[result.list.datasetName];
                                  if (dataset) {
                                    const canonicalOrder = getCanonicalCategoryOrder(dataset);
                                    const persisted = decodeUrlToState(result.list.fragment, dataset.data.length, canonicalOrder);
                                    if (persisted) {
                                      currentFragmentRef.current = result.list.fragment;
                                      hydrateState(persisted as PersistedState);
                                      setCurrentListId(list.id);
                                      lastKnownModified.current = result.list.lastModified;
                                    } else {
                                      showToast('Failed to decode the selected list.', 5000);
                                    }
                                  }
                                }
                              }
                              setShowListDropdown(false);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                if (list.id !== listId) {
                                  // Save current list immediately before switching to avoid losing changes
                                  if (values.length > 0 && listId) {
                                    const state = serializeState();
                                    const currentDataset = preloadedDatasets[selectedDataset];
                                    const currentCanonicalOrder = getCanonicalCategoryOrder(currentDataset);
                                    const currentHash = encodeStateToUrl(state, currentDataset.data.length, currentCanonicalOrder);
                                    const listToSave: SavedList = {
                                      id: listId,
                                      name: listName,
                                      datasetName: selectedDataset,
                                      fragment: currentHash,
                                      lastModified: Date.now(),
                                      createdAt: loadList(listId).list?.createdAt || Date.now()
                                    };
                                    saveList(listToSave);
                                  }

                                  // Load fresh from localStorage (not stale React state)
                                  const result = loadList(list.id);
                                  if (result.error) {
                                    showToast(result.error, 5000);
                                    return;
                                  }

                                  if (result.list) {
                                    const dataset = preloadedDatasets[result.list.datasetName];
                                    if (dataset) {
                                      const canonicalOrder = getCanonicalCategoryOrder(dataset);
                                      const persisted = decodeUrlToState(result.list.fragment, dataset.data.length, canonicalOrder);
                                      if (persisted) {
                                        currentFragmentRef.current = result.list.fragment;
                                        hydrateState(persisted as PersistedState);
                                        setCurrentListId(list.id);
                                        lastKnownModified.current = result.list.lastModified;
                                      } else {
                                        showToast('Failed to decode the selected list.', 5000);
                                      }
                                    }
                                  }
                                }
                                setShowListDropdown(false);
                              }
                            }}
                            className={`w-full text-left px-3 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center justify-between cursor-pointer ${
                              list.id === listId ? 'bg-emerald-50 dark:bg-emerald-900/30 font-medium' : ''
                            }`}
                          >
                            <span className="dark:text-gray-200">{list.name}</span>
                            {list.id === listId && savedLists.length > 1 && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (confirm(`Delete "${list.name}"? This cannot be undone.`)) {
                                    deleteList(list.id);
                                    refreshSavedLists();

                                    // Load another list or create new one
                                    const remainingListsResult = loadAllLists();
                                    if (remainingListsResult.error) {
                                      showToast(remainingListsResult.error, 5000);
                                      createNewList(selectedDataset);
                                      setShowListDropdown(false);
                                      return;
                                    }

                                    if (remainingListsResult.lists.length > 0) {
                                      const nextList = remainingListsResult.lists[0];
                                      const dataset = preloadedDatasets[nextList.datasetName];
                                      if (dataset) {
                                        const canonicalOrder = getCanonicalCategoryOrder(dataset);
                                        const persisted = decodeUrlToState(nextList.fragment, dataset.data.length, canonicalOrder);
                                        if (persisted) {
                                          currentFragmentRef.current = nextList.fragment;
                                          hydrateState(persisted as PersistedState);
                                          setCurrentListId(nextList.id);
                                          lastKnownModified.current = nextList.lastModified;
                                        } else {
                                          showToast('Failed to decode list data. Creating a new list.', 5000);
                                          createNewList(selectedDataset);
                                        }
                                      }
                                    } else {
                                      createNewList(selectedDataset);
                                    }
                                    setShowListDropdown(false);
                                  }
                                }}
                                className="p-1 text-red-600 dark:text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-colors"
                                title="Delete this list"
                                aria-label={`Delete ${list.name}`}
                              >
                                <Trash2 size={16} aria-hidden="true" />
                              </button>
                            )}
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => {
                            setShowListDropdown(false);
                            setShowDatasetPicker(true);
                          }}
                          className="w-full text-left px-3 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-emerald-600 dark:text-emerald-400 font-medium"
                        >
                          + New List
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex gap-2 print-hide">
                <button
                  type="button"
                  onClick={() => setShowACTIntro(true)}
                  className="flex items-center justify-center gap-2 px-3 py-2 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 rounded-lg hover:bg-emerald-200 dark:hover:bg-emerald-900/50 font-medium transition-colors"
                  title="About this exercise"
                >
                  <Info size={18} aria-hidden="true" />
                  <span className="hidden md:inline">About</span>
                </button>
                <div className="relative">
                  <button
                    type="button"
                    onClick={handleShare}
                    className="flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 dark:bg-blue-700 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 font-medium transition-colors"
                    title="Share"
                  >
                    <Share2 size={18} aria-hidden="true" />
                    <span className="hidden md:inline">Share</span>
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
                        onClick={() => setShowShareExplanation(false)}
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
                  onClick={() => window.print()}
                  className="flex items-center justify-center gap-2 px-3 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 font-medium transition-colors"
                  title="Print"
                >
                  <Printer size={18} aria-hidden="true" />
                  <span className="hidden md:inline">Print</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Main content area with tiers and categories */}
        <div className="grid grid-cols-4 gap-4 print:static overflow-visible flex-1 min-h-0">
          {/* Three tier columns */}
          {tiers.map((tier, index) => {
            const tierValues = getValuesByLocation(tier.id);
            const isOverQuota = tier.quota && tierValues.length > tier.quota;

            return (
              <SortableContext
                key={tier.id}
                id={tier.id}
                items={tierValues.map(value => value.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="flex flex-col border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden print-tier bg-white dark:bg-gray-800 h-full @container">
                  {/* Sticky header - droppable area */}
                  <div
                    className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10"
                  >
                    <ValueContainer
                      containerId={`${tier.id}-header`}
                      isTier
                      className="p-4"
                      highlightRingClass={tierHighlightClass[tier.id]}
                    >
                      <div className="w-full">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-lg print-hide">{tier.icon}</span>
                          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200 print-tier-heading flex-1">
                            {tier.label}
                          </h2>
                          <span className={`text-xs font-mono bg-white dark:bg-gray-700 px-2 py-1 rounded border border-gray-300 dark:border-gray-600 print-hide transition-opacity ${
                            hoveredValue ? 'text-gray-600 dark:text-gray-300 opacity-100' : 'text-gray-400 dark:text-gray-500 opacity-40'
                          }`}>
                            {index + 1}
                          </span>
                        </div>

                        {/* Quota indicator */}
                        {tier.quota && (
                          <div className="flex items-center gap-2 text-xs print-hide">
                            {isOverQuota && (
                              <span className="text-red-600" aria-hidden="true">⚠</span>
                            )}
                            <span className={`font-semibold ${isOverQuota ? 'text-red-600' : 'text-gray-700'}`}>
                              {tierValues.length}
                            </span>
                            <span className="text-gray-500 font-medium">
                              (max {tier.quota})
                            </span>
                          </div>
                        )}

                        {!tier.quota && (
                          <div className="text-xs text-gray-600 print-hide">
                            {tierValues.length} {tierValues.length === 1 ? 'value' : 'values'}
                          </div>
                        )}
                      </div>
                    </ValueContainer>
                  </div>

                  {/* Scrollable content area */}
                  <div className="flex-1 overflow-y-auto rounded-b-lg">
                    <ValueContainer
                      containerId={tier.id}
                      isTier
                      className="p-4 grid grid-cols-1 @[18.75rem]:grid-cols-2 gap-2 print-value-list"
                      highlightRingClass={tierHighlightClass[tier.id]}
                    >
                      {tierValues.length === 0 && (
                        <div className="text-sm text-gray-500 italic select-none print-hide text-center py-8">
                          Drop values here
                        </div>
                      )}
                      {tierValues.map(value => (
                        <SortableValue
                          key={value.id}
                          value={value}
                          hoveredValue={hoveredValue}
                          setHoveredValue={setHoveredValue}
                          animatingValues={animatingValues}
                          isInTier
                          containerId={tier.id}
                          activeId={activeId}
                          isTouchDevice={isTouchDevice}
                        />
                      ))}
                    </ValueContainer>
                  </div>
                </div>
              </SortableContext>
            );
          })}

          {/* Categories sidebar - fourth column on desktop */}
          <div className="relative flex-1 min-h-0 print-hide-sidebar">
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl h-full flex flex-col">
            <div className="px-4 py-4 border-b border-gray-200 dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-800 z-10">
              <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200 flex items-center justify-between">
                <span>Value Categories</span>
                {!isTouchDevice && (
                  <span className={`text-xs font-mono bg-white dark:bg-gray-700 px-2 py-1 rounded border border-gray-300 dark:border-gray-600 print-hide transition-opacity ${
                    hoveredValue ? 'text-gray-600 dark:text-gray-300 opacity-100' : 'text-gray-400 dark:text-gray-500 opacity-40'
                  }`}>
                    4
                  </span>
                )}
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 print-hide mt-1">
                {(() => {
                  const tierOrder: TierId[] = ['very-important', 'somewhat-important', 'not-important'];
                  const totalInCategories = values.filter(v => !tierOrder.includes(v.location as TierId)).length;
                  return isTouchDevice
                    ? `${totalInCategories} values • Drag to tiers`
                    : `${totalInCategories} values • Drag to rank them`;
                })()}
              </p>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {(() => {
                const tierOrder: TierId[] = ['very-important', 'somewhat-important', 'not-important'];
                const totalInCategories = values.filter(v => !tierOrder.includes(v.location as TierId)).length;
                const totalValues = values.length;

                // Show completion message if all values are categorized
                if (totalInCategories === 0 && totalValues > 0) {
                  // Check if "very important" tier is over quota
                  const veryImportantTier = tiers.find(t => t.id === 'very-important');
                  const veryImportantValues = values.filter(v => v.location === 'very-important');
                  const isOverQuota = veryImportantTier?.quota && veryImportantValues.length > veryImportantTier.quota;

                  return (
                    <div className="flex flex-col items-center justify-center h-full text-center px-6">
                      {!isOverQuota && (
                        <h3 className="text-xl font-bold text-gray-800 dark:text-gray-200 mb-2">All done! <span aria-hidden="true">🎉</span></h3>
                      )}
                      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                        {isOverQuota ? (
                          <>
                            You've categorized all {totalValues} values with {veryImportantValues.length} "very important" values. We suggest trimming to just 10.
                          </>
                        ) : (
                          <>You've categorized all {totalValues} values</>
                        )}
                      </p>

                      <div className="bg-emerald-50 dark:bg-emerald-900/30 border-2 border-emerald-200 dark:border-emerald-700 rounded-xl p-4 max-w-sm mb-4">
                        <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-200 mb-1"><span className="text-xs" aria-hidden="true">✨</span> Next Steps</p>
                        <p className="text-xs text-emerald-800 dark:text-emerald-300 text-left">
                          {COMPLETION_NEXT_STEPS}
                        </p>
                      </div>
                      <div className="bg-amber-50 dark:bg-amber-900/30 border-2 border-amber-300 dark:border-amber-700 rounded-xl p-4 max-w-sm">
                        <p className="text-sm font-semibold text-amber-900 dark:text-amber-200 mb-1"><span aria-hidden="true">💾</span> Save for later</p>
                        <p className="text-xs text-amber-800 dark:text-amber-300">
                          {COMPLETION_SAVE_TEXT}
                        </p>
                      </div>
                      <div className="flex gap-3 mt-4">
                        <div className="relative">
                          <button
                            type="button"
                            onClick={handleShare}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-600 dark:bg-blue-700 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 font-medium transition-colors"
                          >
                            <Share2 size={18} aria-hidden="true" />
                            <span>Share Link</span>
                          </button>

                          {/* Share explanation popover */}
                          {showShareExplanation && (
                            <div
                              className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-80 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-4 z-60 animate-fade-in-up"
                              role="status"
                              aria-live="polite"
                            >
                              <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-4 h-4 bg-white dark:bg-gray-800 border-r border-b border-gray-200 dark:border-gray-700 transform rotate-45" />
                              <button
                                type="button"
                                onClick={() => setShowShareExplanation(false)}
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
                          onClick={() => window.print()}
                          className="flex items-center gap-2 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 font-medium transition-colors"
                        >
                          <Printer size={18} aria-hidden="true" />
                          <span>Print</span>
                        </button>
                      </div>
                    </div>
                  );
                }

                return (
                  <div className="space-y-2">
                    {[...categories]
                      .sort((a, b) => {
                        const aCount = getValuesByLocation(a).length;
                        const bCount = getValuesByLocation(b).length;
                        if (aCount > 0 && bCount === 0) return -1;
                        if (aCount === 0 && bCount > 0) return 1;
                        return categories.indexOf(a) - categories.indexOf(b);
                      })
                      .map(category => {
                        const categoryValues = getValuesByLocation(category);
                        const isCollapsed = collapsedCategories[category];

                        return (
                          <div key={category} className="border rounded print-avoid-break">
                            <button
                              type="button"
                              onClick={() => toggleCategory(category)}
                              className="w-full flex items-center justify-between px-2 py-1.5 hover:bg-gray-50 cursor-pointer print-hide"
                            >
                              <span className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                                {isCollapsed ? <ChevronRight size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
                                {category}
                                <span className="text-sm font-normal text-gray-500">
                                  ({categoryValues.length})
                                </span>
                              </span>
                            </button>

                            <h3 className="hidden print:block font-medium text-gray-700 px-3 pt-3 pb-1">
                              {category} ({categoryValues.length})
                            </h3>

                            {!isCollapsed && (
                              <SortableContext
                                id={category}
                                items={categoryValues.map(value => value.id)}
                                strategy={verticalListSortingStrategy}
                              >
                                <ValueContainer containerId={category} className="p-2 pt-0 flex flex-wrap gap-2 print:block">
                                  {categoryValues.length === 0 && (
                                    <div className="text-sm text-gray-400 italic select-none">
                                      No values left
                                    </div>
                                  )}
                                  {categoryValues.map(value => (
                                    <SortableValue
                                      key={value.id}
                                      value={value}
                                      hoveredValue={hoveredValue}
                                      setHoveredValue={setHoveredValue}
                                      animatingValues={animatingValues}
                                      containerId={category}
                                      activeId={activeId}
                                      isTouchDevice={isTouchDevice}
                                    />
                                  ))}
                                </ValueContainer>
                              </SortableContext>
                            )}
                          </div>
                        );
                      })}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
        </div>

        {/* QR code - only visible when printing, at end of content */}
          <div className="hidden print:block print-qr-code">
            <QRCodeSVG
              value={(() => {
                const state = serializeState();
                const dataset = preloadedDatasets[selectedDataset];
                const canonicalOrder = getCanonicalCategoryOrder(dataset);
                return getShareableUrl(state, dataset.data.length, canonicalOrder);
              })()}
              size={80}
              level="M"
            />
            <p className="text-xs text-gray-600 mt-1 text-center">Scan to edit</p>
          </div>

        {/* Footer */}
        <div className="text-center py-3 text-xs text-gray-500 print-hide">
          <a
            href="https://github.com/ericphanson/valuetier.org"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-gray-700 hover:underline"
          >
            Open source
          </a>
          {' • Your data stays private in your browser • Share and save links • '}
          <a
            href="https://ericphanson.com/contact"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-gray-700 hover:underline"
          >
            Contact
          </a>
          {' • '}
          <button
            type="button"
            onClick={() => switchToMode('mobile')}
            className="hover:text-gray-700 hover:underline"
          >
            Mobile mode
          </button>
          {' • '}
          <span className="text-gray-400 dark:text-gray-500" title="Git commit hash">
            {__GIT_HASH__}
          </span>
        </div>
        </div>

        {/* Toast notification */}
        {toastMessage && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 md:top-auto md:bottom-4 md:left-auto md:right-4 md:translate-x-0 bg-gray-800 text-white px-4 py-3 rounded-lg shadow-lg animate-fade-in-up z-50 print-hide max-w-md text-center md:text-left">
            {toastMessage}
          </div>
        )}


      </div>
      </div>

      <DragOverlay>
        {activeValue ? (
          <div
            className={getValueClass(
              activeValue,
              animatingValues,
              tiers.some(tier => tier.id === activeValue.location)
            )}
          >
            <span className="font-medium text-gray-800 block">{activeValue.value}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>

    {/* ACT Intro overlay - outside DndContext so it works in both mobile and desktop layouts */}
    {showACTIntro && <ACTIntro onClose={() => {
      setShowACTIntro(false);
      localStorage.setItem('value-tier-seen-intro', 'true');
      // If no list is loaded yet (first time user), show dataset picker
      if (!listId) {
        setShowDatasetPicker(true);
      }
    }} />}

    {/* Dataset Picker modal */}
    {showDatasetPicker && (
      <DatasetPicker
        onSelect={(datasetKey) => {
          setShowDatasetPicker(false);
          createNewList(datasetKey);
        }}
        onCancel={() => {
          setShowDatasetPicker(false);
          // If no list exists and user cancels, default to act-50
          if (!listId) {
            createNewList('act-50');
          }
        }}
      />
    )}
    </>
  );
};

export default ValuesTierList;
