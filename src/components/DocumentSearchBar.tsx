import { useEffect, useRef } from "react";

export interface DocumentSearchBarProps {
  query: string;
  onQueryChange: (value: string) => void;
  matchCount: number;
  activeIndex: number;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
  placeholder?: string;
  className?: string;
}

export function DocumentSearchBar({
  query,
  onQueryChange,
  matchCount,
  activeIndex,
  onNext,
  onPrevious,
  onClose,
  placeholder = "Find in document…",
  className = "",
}: DocumentSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const status =
    query.trim() === ""
      ? ""
      : matchCount === 0
        ? "No matches"
        : `${activeIndex + 1} / ${matchCount}`;

  return (
    <div
      className={`flex items-center gap-2 flex-shrink-0 ${className}`}
      role="search"
      onKeyDown={(e) => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey) onPrevious();
            else onNext();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
        placeholder={placeholder}
        className="w-40 sm:w-52 px-2 py-1 text-xs bg-slack-bg border border-slack-border rounded text-slack-text placeholder:text-slack-textMuted focus:outline-none focus:border-slack-accent"
        aria-label={placeholder}
      />
      <span className="text-xs text-slack-textMuted tabular-nums min-w-[4.5rem] text-center">
        {status}
      </span>
      <button
        type="button"
        onClick={onPrevious}
        disabled={matchCount === 0}
        className="p-1 rounded text-slack-textMuted hover:text-slack-text hover:bg-slack-bg disabled:opacity-40 disabled:cursor-not-allowed"
        title="Previous match (Shift+Enter)"
        aria-label="Previous match"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
        </svg>
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={matchCount === 0}
        className="p-1 rounded text-slack-textMuted hover:text-slack-text hover:bg-slack-bg disabled:opacity-40 disabled:cursor-not-allowed"
        title="Next match (Enter)"
        aria-label="Next match"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <button
        type="button"
        onClick={onClose}
        className="p-1 rounded text-slack-textMuted hover:text-slack-text hover:bg-slack-bg"
        title="Close (Escape)"
        aria-label="Close search"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
