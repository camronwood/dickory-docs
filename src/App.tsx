import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { FileExplorerPanel } from "./components/FileExplorerPanel";
import { MarkdownPreview } from "./components/MarkdownPreview";
import { MermaidGalleryModal } from "./components/MermaidGalleryModal";
import {
  loadMarkdownOnlyPreference,
  saveMarkdownOnlyPreference,
} from "./config/markdownFilterPreference";
import { useFileExplorerStore } from "./stores/fileExplorerStore";
import type { MermaidBlockRef } from "./utils/markdownRenderer";
import {
  findGalleryIndex,
  mapScannedBlocks,
  type GalleryScope,
  type ScannedMermaidBlock,
} from "./utils/mermaidGallery";

type Selection =
  | null
  | { kind: "markdown"; workspaceId: string; path: string }
  | { kind: "text"; workspaceId: string; path: string; content: string };

type GalleryState = {
  workspaceId: string;
  items: MermaidBlockRef[];
  initialIndex: number;
  scope: GalleryScope;
  currentFilePath?: string;
};

export type OpenGalleryOptions = {
  workspaceId: string;
  initialScope?: GalleryScope;
  initialIndex?: number;
  currentFilePath?: string;
  blockIndex?: number;
  content?: string;
};

function TextFileView({
  path,
  content,
}: {
  path: string;
  content: string;
}) {
  const name = path.split("/").pop() || path;
  return (
    <div className="flex flex-col flex-1 min-h-0 h-full bg-slack-bg">
      <div className="flex-shrink-0 bg-slack-bgHover border-b border-slack-border px-4 py-3">
        <h1 className="font-bold text-slack-text truncate">{name}</h1>
        <p className="text-sm text-slack-textMuted truncate">{path}</p>
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-4">
        <pre className="text-sm text-slack-text font-mono whitespace-pre-wrap break-words bg-slack-bgHover border border-slack-border rounded p-4">
          {content}
        </pre>
      </div>
    </div>
  );
}

function EmptyViewer() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-slack-bg text-slack-textMuted p-8 min-h-0">
      <div className="text-4xl mb-4">📄</div>
      <p className="text-center max-w-md">
        Select a Markdown file to preview, or any other file for plain text. Add a folder as a workspace; paths and file reads run locally in the app (no separate server).
      </p>
    </div>
  );
}

function GalleryScanOverlay() {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="flex items-center gap-3 text-slack-text">
        <div className="w-8 h-8 border-2 border-slack-accent border-t-transparent rounded-full animate-spin" />
        <span>Scanning diagrams…</span>
      </div>
    </div>
  );
}

export default function App() {
  const [selection, setSelection] = useState<Selection>(null);
  const [markdownOnly, setMarkdownOnly] = useState(loadMarkdownOnlyPreference);
  const [gallery, setGallery] = useState<GalleryState | null>(null);
  const [galleryScope, setGalleryScope] = useState<GalleryScope>("workspace");
  const [galleryScanning, setGalleryScanning] = useState(false);
  const [galleryScanError, setGalleryScanError] = useState<string | null>(null);

  const workspaces = useFileExplorerStore((s) => s.workspaces);

  const markdownWorkspaceRoot = useFileExplorerStore((s) => {
    if (!selection || selection.kind !== "markdown") return "";
    return s.workspaces.find((w) => w.id === selection.workspaceId)?.path ?? "";
  });

  const activeWorkspaceId = useFileExplorerStore((s) => s.activeWorkspaceId);

  useEffect(() => {
    saveMarkdownOnlyPreference(markdownOnly);
  }, [markdownOnly]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const isPreview = params.get("preview") === "true";
    const workspaceId = params.get("workspace");
    const filePath = params.get("path");
    if (isPreview && workspaceId && filePath) {
      setSelection({ kind: "markdown", workspaceId, path: filePath });
    }
  }, []);

  const openGallery = useCallback(
    async (opts: OpenGalleryOptions) => {
      const workspace = workspaces.find((w) => w.id === opts.workspaceId);
      if (!workspace) {
        setGalleryScanError("Workspace not found.");
        return;
      }

      setGalleryScanError(null);
      setGalleryScanning(true);

      try {
        const scanned = await invoke<ScannedMermaidBlock[]>("workspace_scan_mermaid", {
          root: workspace.path,
        });
        const items = mapScannedBlocks(scanned);
        const filePath = opts.currentFilePath?.replace(/^\/+/, "");
        const initialIndex =
          filePath && (opts.blockIndex !== undefined || opts.content)
            ? findGalleryIndex(items, filePath, opts.blockIndex, opts.content)
            : (opts.initialIndex ?? 0);

        const scope = opts.initialScope ?? (filePath ? "file" : "workspace");

        setGalleryScope(scope);
        setGallery({
          workspaceId: opts.workspaceId,
          items,
          initialIndex,
          scope,
          currentFilePath: filePath,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setGalleryScanError(message);
        console.error("Gallery scan failed:", err);
      } finally {
        setGalleryScanning(false);
      }
    },
    [workspaces]
  );

  const handleOpenGalleryFromExplorer = useCallback(() => {
    if (!activeWorkspaceId) return;
    void openGallery({
      workspaceId: activeWorkspaceId,
      initialScope: "workspace",
      initialIndex: 0,
      currentFilePath:
        selection?.kind === "markdown" ? selection.path : undefined,
    });
  }, [activeWorkspaceId, openGallery, selection]);

  const handleOpenGalleryFromPreview = useCallback(
    (opts: { blockIndex?: number; content?: string; scope?: GalleryScope }) => {
      if (!selection || selection.kind !== "markdown") return;
      void openGallery({
        workspaceId: selection.workspaceId,
        initialScope: opts.scope ?? "file",
        currentFilePath: selection.path,
        blockIndex: opts.blockIndex,
        content: opts.content,
      });
    },
    [openGallery, selection]
  );

  const handleGalleryOpenSource = useCallback(
    (filePath: string) => {
      if (!gallery) return;
      setSelection({ kind: "markdown", workspaceId: gallery.workspaceId, path: filePath });
      setGallery(null);
    },
    [gallery]
  );

  const currentMarkdownPath =
    selection?.kind === "markdown" ? selection.path : undefined;

  return (
    <div className="w-full h-screen overflow-hidden flex flex-row bg-slack-bg">
      <FileExplorerPanel
        markdownOnly={markdownOnly}
        onMarkdownOnlyChange={setMarkdownOnly}
        onSelectMarkdown={(workspaceId, path) => {
          setSelection({ kind: "markdown", workspaceId, path });
        }}
        onSelectTextFile={(workspaceId, path, content) => {
          setSelection({ kind: "text", workspaceId, path, content });
        }}
        onOpenGallery={activeWorkspaceId ? handleOpenGalleryFromExplorer : undefined}
        galleryScanError={galleryScanError}
        onDismissGalleryScanError={() => setGalleryScanError(null)}
      />
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        {!selection && <EmptyViewer />}
        {selection?.kind === "markdown" && (
          <MarkdownPreview
            key={`${selection.workspaceId}:${selection.path}`}
            workspaceRoot={markdownWorkspaceRoot}
            filePath={selection.path}
            layout="embedded"
            onOpenGallery={handleOpenGalleryFromPreview}
          />
        )}
        {selection?.kind === "text" && (
          <TextFileView path={selection.path} content={selection.content} />
        )}
      </div>

      {galleryScanning && <GalleryScanOverlay />}

      {gallery && (
        <MermaidGalleryModal
          isOpen
          onClose={() => setGallery(null)}
          allItems={gallery.items}
          initialIndex={gallery.initialIndex}
          scope={galleryScope}
          onScopeChange={setGalleryScope}
          currentFilePath={gallery.currentFilePath ?? currentMarkdownPath}
          canUseFileScope={Boolean(gallery.currentFilePath ?? currentMarkdownPath)}
          onOpenSource={handleGalleryOpenSource}
        />
      )}
    </div>
  );
}
