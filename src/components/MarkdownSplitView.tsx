import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { extractTitle } from "../utils/markdownRenderer";
import {
  checkDiskForExternalChanges,
  useMarkdownEditorStore,
} from "../stores/markdownEditorStore";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { MarkdownEditorPane } from "./MarkdownEditorPane";
import {
  MarkdownPreviewBody,
  type OpenGalleryFromPreviewOptions,
} from "./MarkdownPreviewBody";
import { DocumentSearchBar } from "./DocumentSearchBar";
import { MermaidModal } from "./MermaidModal";
import {
  loadEditorVisiblePreference,
  saveEditorVisiblePreference,
} from "../config/editorVisibilityPreference";

const SPLIT_STORAGE_KEY = "markdown-split-editor-ratio";
const MIN_EDITOR_RATIO = 0.2;
const MAX_EDITOR_RATIO = 0.8;
const DEFAULT_EDITOR_RATIO = 0.45;

interface MarkdownSplitViewProps {
  workspaceId: string;
  workspaceRoot: string;
  filePath: string;
  onOpenGallery?: (opts: OpenGalleryFromPreviewOptions) => void;
  onOpenMarkdownFile?: (relativePath: string) => void;
}

export function MarkdownSplitView({
  workspaceId,
  workspaceRoot,
  filePath,
  onOpenGallery,
  onOpenMarkdownFile,
}: MarkdownSplitViewProps) {
  const relPath = filePath.replace(/^\/+/, "");
  const filename = relPath.split("/").pop() || "Unknown";

  const content = useMarkdownEditorStore((s) => s.content);
  const isDirty = useMarkdownEditorStore((s) => s.isDirty);
  const saving = useMarkdownEditorStore((s) => s.saving);
  const error = useMarkdownEditorStore((s) => s.error);
  const externalChangePending = useMarkdownEditorStore((s) => s.externalChangePending);
  const openMarkdown = useMarkdownEditorStore((s) => s.openMarkdown);
  const save = useMarkdownEditorStore((s) => s.save);
  const reloadFromDisk = useMarkdownEditorStore((s) => s.reloadFromDisk);
  const applyDiskContent = useMarkdownEditorStore((s) => s.applyDiskContent);
  const dismissExternalChange = useMarkdownEditorStore((s) => s.dismissExternalChange);
  const matchesFile = useMarkdownEditorStore((s) => s.matchesFile);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [docSearchOpen, setDocSearchOpen] = useState(false);
  const [docSearchQuery, setDocSearchQuery] = useState("");
  const [docSearchActiveIndex, setDocSearchActiveIndex] = useState(0);
  const [docSearchMatchCount, setDocSearchMatchCount] = useState(0);
  const [expandedDiagram, setExpandedDiagram] = useState<string | null>(null);
  const [expandedBlockIndex, setExpandedBlockIndex] = useState<number | undefined>();

  const [editorVisible, setEditorVisible] = useState(loadEditorVisiblePreference);
  const [editorRatio, setEditorRatio] = useState(() => {
    const saved = localStorage.getItem(SPLIT_STORAGE_KEY);
    const n = saved ? parseFloat(saved) : DEFAULT_EDITOR_RATIO;
    if (Number.isNaN(n)) return DEFAULT_EDITOR_RATIO;
    return Math.max(MIN_EDITOR_RATIO, Math.min(MAX_EDITOR_RATIO, n));
  });
  const splitRef = useRef<HTMLDivElement>(null);
  const resizeStartX = useRef(0);
  const resizeStartRatio = useRef(0);

  const debouncedPreviewContent = useDebouncedValue(content, 300);
  const title = extractTitle(content);

  const loadFile = useCallback(async () => {
    if (!workspaceRoot.trim()) {
      setLoadError("Workspace is not available.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(null);

    try {
      const fileContent = await invoke<string>("read_file_text", {
        root: workspaceRoot,
        relativePath: relPath,
      });
      openMarkdown(workspaceId, workspaceRoot, relPath, fileContent);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load file";
      setLoadError(message);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, workspaceRoot, relPath, openMarkdown]);

  useEffect(() => {
    if (!matchesFile(workspaceId, relPath)) {
      void loadFile();
    } else {
      setLoading(false);
      setLoadError(null);
    }
    setDocSearchOpen(false);
    setDocSearchQuery("");
    setDocSearchActiveIndex(0);
  }, [workspaceId, workspaceRoot, relPath, matchesFile, loadFile]);

  useEffect(() => {
    if (loading || isDirty) return;

    const id = window.setInterval(() => {
      void checkDiskForExternalChanges();
    }, 2000);

    return () => window.clearInterval(id);
  }, [loading, isDirty, workspaceRoot, relPath]);

  const toggleEditorVisible = () => {
    setEditorVisible((prev) => {
      const next = !prev;
      saveEditorVisiblePreference(next);
      return next;
    });
  };

  useEffect(() => {
    setDocSearchActiveIndex(0);
  }, [docSearchQuery]);

  const editorRatioRef = useRef(editorRatio);
  editorRatioRef.current = editorRatio;

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    resizeStartX.current = e.clientX;
    resizeStartRatio.current = editorRatio;
    const onMove = (ev: MouseEvent) => {
      const el = splitRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const delta = ev.clientX - resizeStartX.current;
      const ratio = resizeStartRatio.current + delta / rect.width;
      const clamped = Math.max(MIN_EDITOR_RATIO, Math.min(MAX_EDITOR_RATIO, ratio));
      editorRatioRef.current = clamped;
      setEditorRatio(clamped);
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      localStorage.setItem(SPLIT_STORAGE_KEY, String(editorRatioRef.current));
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const handleSave = async () => {
    const ok = await save();
    if (ok) {
      setSaveMessage("Saved");
      window.setTimeout(() => setSaveMessage(null), 2000);
    }
  };

  const handleReloadExternal = async () => {
    const fileContent = await invoke<string>("read_file_text", {
      root: workspaceRoot,
      relativePath: relPath,
    });
    applyDiskContent(fileContent);
  };

  if (loading && !content) {
    return (
      <div className="flex flex-1 min-h-[200px] items-center justify-center bg-slack-bg">
        <div className="flex items-center gap-3 text-slack-text">
          <div className="w-6 h-6 border-2 border-slack-accent border-t-transparent rounded-full animate-spin" />
          <span>Loading markdown…</span>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-1 min-h-[200px] items-center justify-center bg-slack-bg p-6">
        <div className="text-center">
          <h2 className="text-xl font-bold text-slack-text mb-2">Failed to load file</h2>
          <p className="text-slack-textMuted mb-4">{loadError}</p>
          <button
            type="button"
            onClick={() => void loadFile()}
            className="px-4 py-2 bg-slack-accent hover:bg-slack-accentHover text-white rounded transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col flex-1 min-h-0 h-full bg-slack-bg">
      <div className="flex-shrink-0 bg-slack-bgHover border-b border-slack-border px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="text-2xl flex-shrink-0">📝</div>
          <div className="min-w-0">
            <h1 className="font-bold text-slack-text truncate">{filename}</h1>
            <p className="text-sm text-slack-textMuted truncate">{relPath}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
          {isDirty && (
            <span className="text-xs text-yellow-500" title="Unsaved changes">
              Unsaved
            </span>
          )}
          {saving && <span className="text-xs text-slack-textMuted">Saving…</span>}
          {saveMessage && <span className="text-xs text-green-500">{saveMessage}</span>}
          {error && (
            <span className="text-xs text-red-400 max-w-[12rem] truncate" title={error}>
              {error}
            </span>
          )}
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!isDirty || saving}
            className="px-3 py-1 text-xs bg-slack-accent hover:bg-slack-accentHover text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Save (⌘S / Ctrl+S)"
          >
            Save
          </button>
          {!isDirty && (
            <button
              type="button"
              onClick={() => void reloadFromDisk()}
              className="px-3 py-1 text-xs bg-slack-bg hover:bg-slack-accent text-slack-text hover:text-white rounded border border-slack-border transition-colors"
              title="Reload from disk"
            >
              Reload
            </button>
          )}
          {docSearchOpen ? (
            <DocumentSearchBar
              query={docSearchQuery}
              onQueryChange={setDocSearchQuery}
              matchCount={docSearchMatchCount}
              activeIndex={docSearchActiveIndex}
              onNext={() => {
                if (docSearchMatchCount > 0) {
                  setDocSearchActiveIndex((i) => (i + 1) % docSearchMatchCount);
                }
              }}
              onPrevious={() => {
                if (docSearchMatchCount > 0) {
                  setDocSearchActiveIndex(
                    (i) => (i - 1 + docSearchMatchCount) % docSearchMatchCount
                  );
                }
              }}
              onClose={() => {
                setDocSearchOpen(false);
                setDocSearchQuery("");
                setDocSearchActiveIndex(0);
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => setDocSearchOpen(true)}
              className="px-3 py-1 text-xs bg-slack-bg hover:bg-slack-accent text-slack-text hover:text-white rounded border border-slack-border transition-colors"
              title="Find in preview (⌘F / Ctrl+F)"
            >
              Find
            </button>
          )}
          {onOpenGallery && (
            <button
              type="button"
              onClick={() => onOpenGallery({ scope: "file" })}
              className="px-3 py-1 text-xs bg-slack-bg hover:bg-slack-accent text-slack-text hover:text-white rounded border border-slack-border transition-colors"
            >
              Gallery
            </button>
          )}
          <button
            type="button"
            onClick={toggleEditorVisible}
            className="px-3 py-1 text-xs bg-slack-bg hover:bg-slack-accent text-slack-text hover:text-white rounded border border-slack-border transition-colors"
            title={editorVisible ? "Hide editor (preview only)" : "Show editor"}
          >
            {editorVisible ? "Hide editor" : "Show editor"}
          </button>
        </div>
      </div>

      {externalChangePending && (
        <div className="flex-shrink-0 px-4 py-2 bg-yellow-500/10 border-b border-yellow-500/30 text-sm text-yellow-200 flex items-center justify-between gap-3">
          <span>File changed on disk.</span>
          <div className="flex gap-2">
            <button
              type="button"
              className="px-2 py-1 text-xs bg-slack-accent text-white rounded"
              onClick={() => void handleReloadExternal()}
            >
              Reload
            </button>
            <button
              type="button"
              className="px-2 py-1 text-xs border border-slack-border rounded text-slack-text"
              onClick={dismissExternalChange}
            >
              Keep editing
            </button>
          </div>
        </div>
      )}

      <div ref={splitRef} className="flex flex-1 min-h-0 flex-row">
        {editorVisible && (
          <>
            <div
              className="min-w-0 min-h-0 flex flex-col border-r border-slack-border"
              style={{ width: `${editorRatio * 100}%` }}
            >
              <div className="flex-shrink-0 px-3 py-1.5 text-xs text-slack-textMuted border-b border-slack-border bg-slack-bgHover">
                Editor
              </div>
              <div className="flex-1 min-h-0">
                <MarkdownEditorPane />
              </div>
            </div>

            <div
              className="w-1 flex-shrink-0 cursor-col-resize bg-slack-border hover:bg-slack-accent/50 transition-colors relative z-10"
              onMouseDown={handleResizeStart}
              role="separator"
              aria-label="Resize editor and preview"
            />
          </>
        )}

        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          <div className="flex-shrink-0 px-3 py-1.5 text-xs text-slack-textMuted border-b border-slack-border bg-slack-bgHover">
            Preview · {title}
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
            <MarkdownPreviewBody
              content={debouncedPreviewContent}
              filePath={relPath}
              onOpenGallery={onOpenGallery}
              onOpenMarkdownFile={onOpenMarkdownFile}
              onExpandDiagram={(diagramContent, blockIndex) => {
                setExpandedBlockIndex(blockIndex);
                setExpandedDiagram(diagramContent);
              }}
              docSearchOpen={docSearchOpen}
              docSearchQuery={docSearchQuery}
              docSearchActiveIndex={docSearchActiveIndex}
              onDocSearchMatchCount={setDocSearchMatchCount}
            />
          </div>
        </div>
      </div>

      <MermaidModal
        isOpen={expandedDiagram !== null}
        onClose={() => {
          setExpandedDiagram(null);
          setExpandedBlockIndex(undefined);
        }}
        content={expandedDiagram || ""}
        onViewInGallery={
          onOpenGallery
            ? () => {
                setExpandedDiagram(null);
                onOpenGallery({
                  scope: "file",
                  blockIndex: expandedBlockIndex,
                  content: expandedDiagram ?? undefined,
                });
              }
            : undefined
        }
      />
    </div>
  );
}
