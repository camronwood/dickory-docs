import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  assignHeadingIds,
  renderMarkdown,
  scrollToHeading,
  splitMarkdownAndMermaid,
} from "../utils/markdownRenderer";
import { renderMermaidSvg } from "../utils/mermaidConfig";
import { ErrorBoundary } from "./ErrorBoundary";
import {
  clearDocumentHighlights,
  highlightDocumentMatches,
} from "../utils/documentSearch";
import { resolveMarkdownLinkAction } from "../utils/markdownLinks";

export type OpenGalleryFromPreviewOptions = {
  blockIndex?: number;
  content?: string;
  scope?: "workspace" | "file";
};

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

export interface MarkdownPreviewBodyProps {
  content: string;
  filePath: string;
  onOpenGallery?: (opts: OpenGalleryFromPreviewOptions) => void;
  onOpenMarkdownFile?: (relativePath: string) => void;
  onExpandDiagram?: (content: string, blockIndex: number) => void;
  docSearchOpen?: boolean;
  docSearchQuery?: string;
  docSearchActiveIndex?: number;
  onDocSearchMatchCount?: (count: number) => void;
  className?: string;
  scrollClassName?: string;
}

export function MarkdownPreviewBody({
  content,
  filePath,
  onOpenGallery,
  onOpenMarkdownFile,
  onExpandDiagram,
  docSearchOpen = false,
  docSearchQuery = "",
  docSearchActiveIndex = 0,
  onDocSearchMatchCount,
  className = "markdown-content prose prose-invert max-w-none",
  scrollClassName = "max-w-6xl mx-auto p-6",
}: MarkdownPreviewBodyProps) {
  const markdownContentRef = useRef<HTMLDivElement>(null);

  const segments = useMemo(
    () => splitMarkdownAndMermaid(content, filePath),
    [content, filePath]
  );

  useEffect(() => {
    const root = markdownContentRef.current;
    if (!root || segments.length === 0) return;

    assignHeadingIds(root);

    if (docSearchOpen && docSearchQuery.trim()) {
      const count = highlightDocumentMatches(root, docSearchQuery, docSearchActiveIndex);
      onDocSearchMatchCount?.(count);
      return;
    }

    clearDocumentHighlights(root);
    onDocSearchMatchCount?.(0);

    const hash = window.location.hash;
    if (hash) {
      requestAnimationFrame(() => scrollToHeading(root, hash));
    }
  }, [
    segments,
    content,
    docSearchOpen,
    docSearchQuery,
    docSearchActiveIndex,
    onDocSearchMatchCount,
  ]);

  useEffect(() => {
    const root = markdownContentRef.current;
    if (!root) return;

    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement).closest("a");
      if (!anchor || !root.contains(anchor)) return;

      const href = anchor.getAttribute("href");
      if (!href) return;

      const action = resolveMarkdownLinkAction(href, filePath);
      if (!action) return;

      event.preventDefault();

      if (action.type === "heading") {
        scrollToHeading(root, action.hash);
        return;
      }

      if (action.type === "markdown" && onOpenMarkdownFile) {
        onOpenMarkdownFile(action.relativePath);
        return;
      }

      if (action.type === "external") {
        window.open(action.url, "_blank", "noopener,noreferrer");
      }
    };

    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, [segments, content, filePath, onOpenMarkdownFile]);

  const renderSegments = () => {
    if (segments.length === 0) return null;

    let mermaidBlockIndex = 0;

    return segments.map((seg, i) => {
      if (seg.type === "mermaid") {
        const blockIndex = mermaidBlockIndex;
        mermaidBlockIndex += 1;
        return (
          <ErrorBoundary
            key={`mermaid-${i}-${blockIndex}`}
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
                onExpandDiagram?.(diagramContent, blockIndex);
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

  return (
    <div className={scrollClassName}>
      <div ref={markdownContentRef} className={className}>
        {renderSegments()}
      </div>
    </div>
  );
}
