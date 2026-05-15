import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import {
  assignHeadingIds,
  extractTitle,
  getContentHash,
  renderMarkdown,
  scrollToHeading,
  splitMarkdownAndMermaid,
  type MarkdownSegment,
} from "../utils/markdownRenderer";
import { renderMermaidSvg } from "../utils/mermaidConfig";
import { MermaidModal } from "./MermaidModal";
import { ErrorBoundary } from "./ErrorBoundary";
import { DocumentSearchBar } from "./DocumentSearchBar";
import {
  clearDocumentHighlights,
  highlightDocumentMatches,
} from "../utils/documentSearch";

interface MermaidDiagramProps {
  content: string;
  blockIndex: number;
  onExpand: (content: string) => void;
  onOpenGallery?: (opts: OpenGalleryFromPreviewOptions) => void;
}

function MermaidDiagram({ content, blockIndex, onExpand, onOpenGallery }: MermaidDiagramProps) {
  const svgTargetRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  const [isRendering, setIsRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const renderDiagram = useCallback(async () => {
    if (!svgTargetRef.current) return;

    setIsRendering(true);
    setRenderError(null);

    try {
      svgTargetRef.current.innerHTML = "";
      const svg = await renderMermaidSvg(content);

      if (!mountedRef.current || !svgTargetRef.current) return;
      svgTargetRef.current.innerHTML = svg;

      requestAnimationFrame(() => {
        if (!mountedRef.current || !svgTargetRef.current) return;
        const svgEl = svgTargetRef.current.querySelector("svg");
        if (svgEl) {
          svgEl.style.maxWidth = "none";
          svgEl.style.width = "auto";
          svgEl.style.display = "block";
          if (svgEl.getAttribute("width")?.includes("%")) {
            svgEl.removeAttribute("width");
          }
        }
      });

      setRetryCount(0);
    } catch (err) {
      if (!mountedRef.current) return;
      console.error("Mermaid rendering error:", err);
      setRenderError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mountedRef.current) setIsRendering(false);
    }
  }, [content]);

  const handleRetry = () => {
    setRetryCount((prev) => prev + 1);
    renderDiagram();
  };

  useEffect(() => {
    if (svgTargetRef.current) {
      renderDiagram();
    }
  }, [renderDiagram, retryCount]);

  return (
    <div className="mermaid-diagram w-full my-6">
      {renderError ? (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded text-red-400 text-sm">
          <strong>Mermaid Diagram Error:</strong>
          <pre className="mt-2 text-xs whitespace-pre-wrap">{renderError}</pre>
          <button
            type="button"
            className="mt-2 px-3 py-1 bg-red-500/20 hover:bg-red-500/30 rounded text-xs transition-colors"
            onClick={handleRetry}
          >
            Retry
          </button>
        </div>
      ) : (
        <div
          className="w-full min-h-[200px] p-6 bg-slack-bgHover rounded border border-slack-border overflow-x-auto overflow-y-visible cursor-pointer hover:bg-slack-accent/10 transition-colors relative"
          onClick={(e) => {
            if (e.shiftKey && onOpenGallery) {
              onOpenGallery({ blockIndex, content, scope: "file" });
            } else {
              onExpand(content);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (e.shiftKey && onOpenGallery) {
                onOpenGallery({ blockIndex, content, scope: "file" });
              } else {
                onExpand(content);
              }
            }
          }}
          role="button"
          tabIndex={0}
          title="Click to expand · Shift+click for gallery"
        >
          <div ref={svgTargetRef} />
          {isRendering && (
            <div className="absolute inset-0 flex items-center justify-center bg-slack-bgHover/80 rounded">
              <div className="flex items-center gap-2 text-slack-text">
                <div className="w-4 h-4 border-2 border-slack-accent border-t-transparent rounded-full animate-spin" />
                <span className="text-sm">Rendering diagram...</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export type MarkdownPreviewLayout = "standalone" | "embedded";

export type OpenGalleryFromPreviewOptions = {
  blockIndex?: number;
  content?: string;
  scope?: "workspace" | "file";
};

interface MarkdownPreviewProps {
  workspaceRoot: string;
  filePath: string;
  layout?: MarkdownPreviewLayout;
  onOpenGallery?: (opts: OpenGalleryFromPreviewOptions) => void;
}

export function MarkdownPreview({
  workspaceRoot,
  filePath,
  layout = "standalone",
  onOpenGallery,
}: MarkdownPreviewProps) {
  const [content, setContent] = useState<string>("");
  const [segments, setSegments] = useState<MarkdownSegment[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [title, setTitle] = useState<string>("Markdown Preview");
  const [expandedDiagram, setExpandedDiagram] = useState<string | null>(null);
  const [expandedBlockIndex, setExpandedBlockIndex] = useState<number | undefined>();
  const [isRendering] = useState<boolean>(false);
  const [docSearchOpen, setDocSearchOpen] = useState(false);
  const [docSearchQuery, setDocSearchQuery] = useState("");
  const [docSearchActiveIndex, setDocSearchActiveIndex] = useState(0);
  const [docSearchMatchCount, setDocSearchMatchCount] = useState(0);

  const contentHashRef = useRef<string>("");
  const intervalRef = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const markdownContentRef = useRef<HTMLDivElement>(null);

  const filename = filePath.split("/").pop() || "Unknown";
  const embedded = layout === "embedded";

  const fetchContent = async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();

    try {
      setError(null);
      if (!workspaceRoot.trim()) {
        setError("Workspace is not available.");
        setLoading(false);
        return;
      }
      const rel = filePath.replace(/^\/+/, "");
      const fileContent = await invoke<string>("read_file_text", {
        root: workspaceRoot,
        relativePath: rel,
      });
      const newHash = getContentHash(fileContent);

      if (newHash !== contentHashRef.current) {
        setContent(fileContent);
        setSegments(splitMarkdownAndMermaid(fileContent));
        setTitle(extractTitle(fileContent));
        setLastUpdated(new Date());
        contentHashRef.current = newHash;
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      const errorMessage = err instanceof Error ? err.message : "Failed to load file";
      setError(errorMessage);
      console.error("Failed to fetch file content:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    contentHashRef.current = "";
    setContent("");
    setSegments([]);
    setDocSearchOpen(false);
    setDocSearchQuery("");
    setDocSearchActiveIndex(0);
    setDocSearchMatchCount(0);
    fetchContent();
  }, [workspaceRoot, filePath]);

  useEffect(() => {
    setDocSearchActiveIndex(0);
  }, [docSearchQuery]);

  useEffect(() => {
    intervalRef.current = window.setInterval(() => {
      if (!loading && !isRendering) {
        fetchContent();
      }
    }, 2000);

    return () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
      }
    };
  }, [loading, isRendering, workspaceRoot, filePath]);

  useEffect(() => {
    if (!embedded) {
      document.title = `${title} · Dickory Docs`;
    }
  }, [title, embedded]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        setDocSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const root = markdownContentRef.current;
    if (!root || segments.length === 0) return;

    assignHeadingIds(root);

    if (docSearchOpen && docSearchQuery.trim()) {
      const count = highlightDocumentMatches(root, docSearchQuery, docSearchActiveIndex);
      setDocSearchMatchCount(count);
      return;
    }

    clearDocumentHighlights(root);
    setDocSearchMatchCount(0);

    const hash = window.location.hash;
    if (hash) {
      requestAnimationFrame(() => scrollToHeading(root, hash));
    }
  }, [segments, content, docSearchOpen, docSearchQuery, docSearchActiveIndex]);

  useEffect(() => {
    const root = markdownContentRef.current;
    if (!root) return;

    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement).closest("a");
      if (!anchor || !root.contains(anchor)) return;

      const href = anchor.getAttribute("href");
      if (!href?.startsWith("#")) return;

      event.preventDefault();
      scrollToHeading(root, href);
    };

    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, [segments, content]);

  const handleRefresh = () => {
    setLoading(true);
    fetchContent();
  };

  const formatTime = (date: Date) =>
    date.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

  const renderSegments = () => {
    if (segments.length === 0) return null;

    let mermaidBlockIndex = 0;

    return segments.map((seg, i) => {
      if (seg.type === "mermaid") {
        const blockIndex = mermaidBlockIndex;
        mermaidBlockIndex += 1;
        return (
          <ErrorBoundary
            key={`mermaid-${i}`}
            fallback={
              <div className="my-6 p-4 bg-red-500/10 border border-red-500/20 rounded text-red-400 text-sm">
                <strong>Diagram Error:</strong> Failed to render Mermaid diagram.
              </div>
            }
          >
            <MermaidDiagram
              content={seg.content}
              blockIndex={blockIndex}
              onExpand={(diagramContent) => {
                setExpandedBlockIndex(blockIndex);
                setExpandedDiagram(diagramContent);
              }}
              onOpenGallery={onOpenGallery}
            />
          </ErrorBoundary>
        );
      }
      const html = renderMarkdown(seg.content);
      return <div key={`md-${i}`} dangerouslySetInnerHTML={{ __html: html }} />;
    });
  };

  const shellClass = embedded
    ? "relative flex flex-col flex-1 min-h-0 h-full bg-slack-bg"
    : "relative w-full h-screen bg-slack-bg flex flex-col";

  if (loading && !content) {
    return (
      <div
        className={
          embedded
            ? "flex flex-1 min-h-[200px] items-center justify-center bg-slack-bg"
            : "w-full h-screen bg-slack-bg flex items-center justify-center"
        }
      >
        <div className="flex items-center gap-3 text-slack-text">
          <div className="w-6 h-6 border-2 border-slack-accent border-t-transparent rounded-full animate-spin" />
          <span>Loading markdown preview...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={
          embedded
            ? "flex flex-1 min-h-[200px] items-center justify-center bg-slack-bg p-6"
            : "w-full h-screen bg-slack-bg flex items-center justify-center"
        }
      >
        <div className="text-center">
          <div className="text-6xl mb-4">⚠️</div>
          <h2 className="text-xl font-bold text-slack-text mb-2">Failed to load file</h2>
          <p className="text-slack-textMuted mb-4">{error}</p>
          <button
            type="button"
            onClick={handleRefresh}
            className="px-4 py-2 bg-slack-accent hover:bg-slack-accentHover text-white rounded transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={shellClass}>
      <div className="flex-shrink-0 bg-slack-bgHover border-b border-slack-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="text-2xl flex-shrink-0">📝</div>
          <div className="min-w-0">
            <h1 className="font-bold text-slack-text truncate">{filename}</h1>
            <p className="text-sm text-slack-textMuted truncate">{filePath}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
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
              title="Find in document (⌘F / Ctrl+F)"
            >
              Find
            </button>
          )}
          {lastUpdated && (
            <span className="text-sm text-slack-textMuted hidden sm:inline">
              Updated at {formatTime(lastUpdated)}
            </span>
          )}
          {onOpenGallery && (
            <button
              type="button"
              onClick={() => onOpenGallery({ scope: "file" })}
              className="px-3 py-1 text-xs bg-slack-bg hover:bg-slack-accent text-slack-text hover:text-white rounded border border-slack-border transition-colors"
              title="Browse all diagrams in gallery"
            >
              Gallery
            </button>
          )}
          <button
            type="button"
            onClick={handleRefresh}
            className="px-3 py-1 bg-slack-bg hover:bg-slack-accent text-slack-text hover:text-white rounded transition-colors"
            title="Refresh content"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
        </div>
      </div>

      <div className={embedded ? "flex-1 min-h-0 overflow-auto" : "flex-1 overflow-auto"}>
        <div className="max-w-6xl mx-auto p-6">
          <div
            ref={markdownContentRef}
            className="markdown-content prose prose-invert max-w-none"
          >
            {renderSegments()}
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

      {loading && content && (
        <div className="absolute top-4 right-4 bg-slack-bgHover border border-slack-border rounded px-3 py-2 flex items-center gap-2 z-10">
          <div className="w-3 h-3 border border-slack-accent border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-slack-text">Updating...</span>
        </div>
      )}
    </div>
  );
}
