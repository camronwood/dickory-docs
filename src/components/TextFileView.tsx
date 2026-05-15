import { useEffect, useRef, useState } from "react";
import { DocumentSearchBar } from "./DocumentSearchBar";
import {
  clearDocumentHighlights,
  highlightDocumentMatches,
} from "../utils/documentSearch";

export function TextFileView({ path, content }: { path: string; content: string }) {
  const name = path.split("/").pop() || path;
  const bodyRef = useRef<HTMLPreElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchActiveIndex, setSearchActiveIndex] = useState(0);
  const [searchMatchCount, setSearchMatchCount] = useState(0);

  useEffect(() => {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchActiveIndex(0);
    setSearchMatchCount(0);
  }, [path]);

  useEffect(() => {
    setSearchActiveIndex(0);
  }, [searchQuery]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const root = bodyRef.current;
    if (!root) return;

    if (searchOpen && searchQuery.trim()) {
      const count = highlightDocumentMatches(root, searchQuery, searchActiveIndex);
      setSearchMatchCount(count);
      return;
    }

    clearDocumentHighlights(root);
    setSearchMatchCount(0);
  }, [content, searchOpen, searchQuery, searchActiveIndex]);

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full bg-slack-bg">
      <div className="flex-shrink-0 bg-slack-bgHover border-b border-slack-border px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-bold text-slack-text truncate">{name}</h1>
          <p className="text-sm text-slack-textMuted truncate">{path}</p>
        </div>
        {searchOpen ? (
          <DocumentSearchBar
            query={searchQuery}
            onQueryChange={setSearchQuery}
            matchCount={searchMatchCount}
            activeIndex={searchActiveIndex}
            onNext={() => {
              if (searchMatchCount > 0) {
                setSearchActiveIndex((i) => (i + 1) % searchMatchCount);
              }
            }}
            onPrevious={() => {
              if (searchMatchCount > 0) {
                setSearchActiveIndex(
                  (i) => (i - 1 + searchMatchCount) % searchMatchCount
                );
              }
            }}
            onClose={() => {
              setSearchOpen(false);
              setSearchQuery("");
              setSearchActiveIndex(0);
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="px-3 py-1 text-xs bg-slack-bg hover:bg-slack-accent text-slack-text hover:text-white rounded border border-slack-border transition-colors flex-shrink-0"
            title="Find in document (⌘F / Ctrl+F)"
          >
            Find
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-4">
        <pre
          ref={bodyRef}
          className="text-sm text-slack-text font-mono whitespace-pre-wrap break-words bg-slack-bgHover border border-slack-border rounded p-4"
        >
          {content}
        </pre>
      </div>
    </div>
  );
}
