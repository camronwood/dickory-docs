import { useState, useEffect, useMemo, useCallback } from "react";
import type { MermaidBlockRef } from "../utils/markdownRenderer";
import {
  filterBlocksByFile,
  galleryEmptyMessage,
  preserveIndexOnScopeChange,
  type GalleryScanStats,
  type GalleryScope,
} from "../utils/mermaidGallery";
import { MermaidCanvas } from "./MermaidCanvas";

export interface MermaidGalleryModalProps {
  isOpen: boolean;
  onClose: () => void;
  allItems: MermaidBlockRef[];
  initialIndex?: number;
  scope: GalleryScope;
  onScopeChange: (scope: GalleryScope) => void;
  currentFilePath?: string;
  canUseFileScope: boolean;
  scanStats?: GalleryScanStats;
  onOpenSource?: (filePath: string) => void;
}

export function MermaidGalleryModal({
  isOpen,
  onClose,
  allItems,
  initialIndex = 0,
  scope,
  onScopeChange,
  currentFilePath,
  canUseFileScope,
  scanStats = { markdownFiles: 0, filesUnreadable: 0 },
  onOpenSource,
}: MermaidGalleryModalProps) {
  const [index, setIndex] = useState(initialIndex);

  const displayedItems = useMemo(() => {
    if (scope === "file" && currentFilePath) {
      return filterBlocksByFile(allItems, currentFilePath);
    }
    return allItems;
  }, [allItems, scope, currentFilePath]);

  const currentItem = displayedItems[index];
  const total = displayedItems.length;

  useEffect(() => {
    if (!isOpen) return;
    const safe = Math.min(Math.max(0, initialIndex), Math.max(0, displayedItems.length - 1));
    setIndex(safe);
  }, [isOpen, initialIndex]);

  useEffect(() => {
    if (!isOpen) return;
    setIndex((prev) => Math.min(prev, Math.max(0, displayedItems.length - 1)));
  }, [displayedItems.length, isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (displayedItems.length === 0) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setIndex((prev) => (prev > 0 ? prev - 1 : displayedItems.length - 1));
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setIndex((prev) => (prev < displayedItems.length - 1 ? prev + 1 : 0));
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "unset";
    };
  }, [isOpen, onClose, displayedItems.length]);

  const handleScopeChange = useCallback(
    (next: GalleryScope) => {
      if (next === scope) return;
      const nextItems =
        next === "file" && currentFilePath
          ? filterBlocksByFile(allItems, currentFilePath)
          : allItems;
      const nextIndex = preserveIndexOnScopeChange(currentItem, nextItems);
      onScopeChange(next);
      setIndex(nextIndex);
    },
    [scope, currentItem, allItems, currentFilePath, onScopeChange]
  );

  const goPrev = () => {
    if (total === 0) return;
    setIndex((prev) => (prev > 0 ? prev - 1 : total - 1));
  };

  const goNext = () => {
    if (total === 0) return;
    setIndex((prev) => (prev < total - 1 ? prev + 1 : 0));
  };

  if (!isOpen) return null;

  const emptyMessage =
    total === 0 ? galleryEmptyMessage(scope, scanStats) : null;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/90">
      <div className="flex-shrink-0 flex items-center justify-between gap-4 px-4 py-3 border-b border-slack-border bg-slack-bgHover">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span className="text-sm font-medium text-slack-text whitespace-nowrap">
            {total === 0 ? "0 / 0" : `${index + 1} / ${total}`}
          </span>
          {currentItem && (
            <span
              className="text-sm text-slack-textMuted truncate"
              title={currentItem.filePath}
            >
              {currentItem.filePath}
              {total > 1 && ` · diagram ${currentItem.blockIndex + 1}`}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="flex rounded border border-slack-border overflow-hidden text-xs">
            <button
              type="button"
              onClick={() => handleScopeChange("workspace")}
              className={`px-3 py-1.5 transition-colors ${
                scope === "workspace"
                  ? "bg-slack-accent text-white"
                  : "bg-slack-bg text-slack-textMuted hover:text-slack-text"
              }`}
            >
              Workspace
            </button>
            <button
              type="button"
              onClick={() => handleScopeChange("file")}
              disabled={!canUseFileScope}
              className={`px-3 py-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                scope === "file"
                  ? "bg-slack-accent text-white"
                  : "bg-slack-bg text-slack-textMuted hover:text-slack-text"
              }`}
              title={canUseFileScope ? "This file only" : "Open a markdown file to filter"}
            >
              This file
            </button>
          </div>

          {currentItem && onOpenSource && (
            <button
              type="button"
              onClick={() => onOpenSource(currentItem.filePath)}
              className="px-3 py-1.5 text-xs bg-slack-bg hover:bg-slack-accent text-slack-text hover:text-white rounded border border-slack-border transition-colors"
            >
              Open file
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            className="p-2 bg-slack-bg hover:bg-slack-accent text-slack-text hover:text-white rounded transition-colors"
            title="Close (ESC)"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 relative flex flex-col">
        {total === 0 && emptyMessage ? (
          <div className="flex flex-1 items-center justify-center text-slack-textMuted p-8 text-center">
            <div>
              <p className="text-lg mb-2">{emptyMessage.title}</p>
              <p className="text-sm mb-4 max-w-md mx-auto">{emptyMessage.detail}</p>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-slack-accent hover:bg-slack-accentHover text-white rounded text-sm"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <>
            <MermaidCanvas
              key={`${currentItem?.filePath}-${currentItem?.blockIndex}-${index}`}
              content={currentItem?.content ?? ""}
              active={isOpen}
              className="flex-1"
            />

            <button
              type="button"
              onClick={goPrev}
              className="absolute left-4 top-1/2 -translate-y-1/2 z-10 p-3 bg-slack-bgHover/90 hover:bg-slack-accent text-slack-text hover:text-white rounded-full transition-colors shadow-lg"
              title="Previous (←)"
              aria-label="Previous diagram"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              type="button"
              onClick={goNext}
              className="absolute right-4 top-1/2 -translate-y-1/2 z-10 p-3 bg-slack-bgHover/90 hover:bg-slack-accent text-slack-text hover:text-white rounded-full transition-colors shadow-lg"
              title="Next (→)"
              aria-label="Next diagram"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
