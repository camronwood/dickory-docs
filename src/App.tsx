import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { FileExplorerPanel } from "./components/FileExplorerPanel";
import { MarkdownPreview } from "./components/MarkdownPreview";
import { MarkdownSplitView } from "./components/MarkdownSplitView";
import { useMarkdownEditorStore } from "./stores/markdownEditorStore";
import { TextFileView } from "./components/TextFileView";
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
import { openExternalMarkdownFile } from "./utils/openExternalFile";

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
  const [previewOnly, setPreviewOnly] = useState(false);
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
  const setSelectedPath = useFileExplorerStore((s) => s.setSelectedPath);
  const loadWorkspaces = useFileExplorerStore((s) => s.loadWorkspaces);

  useEffect(() => {
    saveMarkdownOnlyPreference(markdownOnly);
  }, [markdownOnly]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const isPreview = params.get("preview") === "true";
    const workspaceId = params.get("workspace");
    const filePath = params.get("path");
    if (isPreview && workspaceId && filePath) {
      setPreviewOnly(true);
      setSelection({ kind: "markdown", workspaceId, path: filePath });
    }
  }, []);

  const selectMarkdown = useCallback((workspaceId: string, path: string) => {
    if (!useMarkdownEditorStore.getState().confirmDiscardIfDirty()) return;
    setSelection({ kind: "markdown", workspaceId, path });
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const paths = await invoke<string[]>("take_launch_open_files");
        if (cancelled || paths.length === 0) return;

        await loadWorkspaces();
        if (cancelled) return;

        for (const absPath of paths) {
          if (cancelled) break;
          await openExternalMarkdownFile(absPath, selectMarkdown);
        }
      } catch (err) {
        console.error("Failed to open launch file(s):", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadWorkspaces, selectMarkdown]);

  const selectTextFile = useCallback(
    (workspaceId: string, path: string, content: string) => {
      if (!useMarkdownEditorStore.getState().confirmDiscardIfDirty()) return;
      setSelection({ kind: "text", workspaceId, path, content });
    },
    []
  );

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
      selectMarkdown(gallery.workspaceId, filePath);
      setGallery(null);
    },
    [gallery, selectMarkdown]
  );

  const handleOpenLinkedMarkdown = useCallback(
    (relativePath: string) => {
      const workspaceId =
        selection?.kind === "markdown"
          ? selection.workspaceId
          : activeWorkspaceId;
      if (!workspaceId) return;

      const path = relativePath.replace(/^\/+/, "");
      setSelectedPath(path);
      selectMarkdown(workspaceId, path);
    },
    [selection, activeWorkspaceId, setSelectedPath, selectMarkdown]
  );

  const currentMarkdownPath =
    selection?.kind === "markdown" ? selection.path : undefined;

  return (
    <div className="w-full h-screen overflow-hidden flex flex-row bg-slack-bg">
      <FileExplorerPanel
        markdownOnly={markdownOnly}
        onMarkdownOnlyChange={setMarkdownOnly}
        onSelectMarkdown={selectMarkdown}
        onSelectTextFile={selectTextFile}
        onOpenGallery={activeWorkspaceId ? handleOpenGalleryFromExplorer : undefined}
        galleryScanError={galleryScanError}
        onDismissGalleryScanError={() => setGalleryScanError(null)}
      />
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        {!selection && <EmptyViewer />}
        {selection?.kind === "markdown" && previewOnly && (
          <MarkdownPreview
            key={`${selection.workspaceId}:${selection.path}`}
            workspaceRoot={markdownWorkspaceRoot}
            filePath={selection.path}
            layout="embedded"
            onOpenGallery={handleOpenGalleryFromPreview}
            onOpenMarkdownFile={handleOpenLinkedMarkdown}
          />
        )}
        {selection?.kind === "markdown" && !previewOnly && (
          <MarkdownSplitView
            key={`${selection.workspaceId}:${selection.path}`}
            workspaceId={selection.workspaceId}
            workspaceRoot={markdownWorkspaceRoot}
            filePath={selection.path}
            onOpenGallery={handleOpenGalleryFromPreview}
            onOpenMarkdownFile={handleOpenLinkedMarkdown}
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
