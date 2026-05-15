import { useState, useEffect, useRef, useMemo } from "react";
import { useFileExplorerStore } from "../stores/fileExplorerStore";
import type { FileNode } from "../stores/fileExplorerStore";
import { open } from "@tauri-apps/api/dialog";
import { invoke } from "@tauri-apps/api/tauri";

export interface FileExplorerPanelProps {
  onSelectMarkdown?: (workspaceId: string, path: string) => void;
  onSelectTextFile?: (workspaceId: string, path: string, content: string) => void;
  onOpenGallery?: () => void;
  galleryScanError?: string | null;
  onDismissGalleryScanError?: () => void;
  markdownOnly: boolean;
  onMarkdownOnlyChange: (value: boolean) => void;
}

const MIN_WIDTH = 200;
const DEFAULT_WIDTH = 300;
const STORAGE_KEY = "dickory-docs-explorer-width";
const LEGACY_STORAGE_KEY = "doc-watson-explorer-width";

/** Stable empty list so we do not allocate a new [] each render when the tree is missing. */
const EMPTY_FILE_LIST: FileNode[] = [];

function normalizeFsPath(p: string): string {
  return p.replace(/\\/g, "/").trim();
}

/** Hub JSON uses `is_dir`; tolerate camelCase from other clients. */
function isDirectoryNode(node: FileNode): boolean {
  const n = node as FileNode & { isDir?: boolean };
  return node.is_dir === true || n.isDir === true;
}

function isMarkdownPath(path: string, basename?: string): boolean {
  const endsMd = (s: string) => {
    const n = normalizeFsPath(s).toLowerCase();
    return n.endsWith(".md") || n.endsWith(".markdown");
  };
  if (path && endsMd(path)) return true;
  if (basename && endsMd(basename)) return true;
  return false;
}

/** Show only `.md` files; hide folders whose loaded children contain no Markdown after filtering. Unexpanded dirs stay visible until loaded. */
function filterTreeMarkdownOnly(nodes: FileNode[]): FileNode[] {
  const out: FileNode[] = [];
  for (const node of nodes) {
    if (!isDirectoryNode(node)) {
      if (isMarkdownPath(node.path, node.name)) out.push(node);
      continue;
    }
    if (node.children !== undefined) {
      const filteredChildren = filterTreeMarkdownOnly(node.children);
      if (filteredChildren.length === 0) continue;
      out.push({ ...node, children: filteredChildren });
    } else {
      out.push(node);
    }
  }
  return out;
}

export function FileExplorerPanel({
  onSelectMarkdown,
  onSelectTextFile,
  onOpenGallery,
  galleryScanError,
  onDismissGalleryScanError,
  markdownOnly,
  onMarkdownOnlyChange,
}: FileExplorerPanelProps) {
  const {
    workspaces,
    activeWorkspaceId,
    fileTree,
    expandedPaths,
    selectedPath,
    loadingFiles,
    error,
    loadWorkspaces,
    addWorkspace,
    setActiveWorkspace,
    loadFiles,
    toggleExpanded,
    setSelectedPath,
    createFile,
    createFolder,
    renameFile,
    deleteFile,
    removeWorkspace,
    getActiveWorkspace,
    clearError,
  } = useFileExplorerStore();

  const [banner, setBanner] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    if (!banner) return;
    const t = window.setTimeout(() => setBanner(null), 4000);
    return () => window.clearTimeout(t);
  }, [banner]);

  const [width, setWidth] = useState<number>(() => {
    const saved =
      localStorage.getItem(STORAGE_KEY) ??
      localStorage.getItem(LEGACY_STORAGE_KEY);
    const savedWidth = saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
    const maxReasonableWidth = window.innerWidth * 0.7;
    return savedWidth > maxReasonableWidth ? DEFAULT_WIDTH : savedWidth;
  });
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartX = useRef<number>(0);
  const resizeStartWidth = useRef<number>(0);
  const currentWidthRef = useRef<number>(width);

  useEffect(() => {
    currentWidthRef.current = width;
  }, [width]);

  const [showAddWorkspace, setShowAddWorkspace] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [newWorkspacePath, setNewWorkspacePath] = useState("");

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    path: string;
    isDir: boolean;
  } | null>(null);

  useEffect(() => {
    loadWorkspaces();
  }, [loadWorkspaces]);

  useEffect(() => {
    if (activeWorkspaceId) {
      loadFiles(activeWorkspaceId);
    }
  }, [activeWorkspaceId, loadFiles]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const delta = e.clientX - resizeStartX.current;
      const newWidth = resizeStartWidth.current + delta;
      const maxWidth = Math.min(window.innerWidth * 0.4, 600);
      const clampedWidth = Math.max(MIN_WIDTH, Math.min(maxWidth, newWidth));
      setWidth(clampedWidth);
    };

    const handleMouseUp = () => {
      if (isResizing) {
        setIsResizing(false);
        localStorage.setItem(STORAGE_KEY, currentWidthRef.current.toString());
      }
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing]);

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = currentWidthRef.current;
  };

  const handleBrowseDirectory = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Workspace Directory",
      });

      if (selected && typeof selected === "string") {
        setNewWorkspacePath(selected);
        if (!newWorkspaceName) {
          const dirName = selected.split("/").pop() || "";
          setNewWorkspaceName(dirName);
        }
      }
    } catch (err) {
      console.error("Failed to open directory picker:", err);
    }
  };

  const handleAddWorkspace = async () => {
    if (!newWorkspaceName || !newWorkspacePath) return;

    try {
      await addWorkspace(newWorkspaceName, newWorkspacePath);
      setShowAddWorkspace(false);
      setNewWorkspaceName("");
      setNewWorkspacePath("");
      setBanner({ type: "ok", text: "Workspace added" });
    } catch (error) {
      console.error("Failed to add workspace:", error);
      setBanner({
        type: "err",
        text: error instanceof Error ? error.message : "Failed to add workspace",
      });
    }
  };

  const [pendingRemove, setPendingRemove] = useState<{ id: string; name: string } | null>(null);

  const handleRemoveWorkspace = (e: React.MouseEvent, workspaceId: string, workspaceName: string) => {
    e.stopPropagation();
    e.preventDefault();
    setPendingRemove({ id: workspaceId, name: workspaceName });
  };

  const confirmRemoveWorkspace = async () => {
    if (!pendingRemove) return;
    const { id, name } = pendingRemove;
    setPendingRemove(null);
    try {
      await removeWorkspace(id);
      setBanner({ type: "ok", text: `"${name}" removed from list` });
    } catch (error) {
      console.error("Failed to remove workspace:", error);
      setBanner({
        type: "err",
        text: error instanceof Error ? error.message : "Failed to remove workspace",
      });
    }
  };

  const handleFileClick = async (file: FileNode) => {
    if (!file.path) {
      console.error("File path is undefined:", file);
      return;
    }

    if (isDirectoryNode(file)) {
      const wasExpanded = !!expandedPaths[file.path];
      toggleExpanded(file.path);

      if (!wasExpanded && (!file.children || file.children.length === 0)) {
        const activeWorkspace = getActiveWorkspace();
        if (activeWorkspace) {
          try {
            await loadFiles(activeWorkspace.id, file.path);
          } catch (err) {
            console.error("Failed to load directory contents:", err);
            setBanner({
              type: "err",
              text: err instanceof Error ? err.message : "Failed to load directory",
            });
          }
        }
      }

      setSelectedPath(file.path);
    } else {
      const activeWorkspace = getActiveWorkspace();
      if (activeWorkspace) {
        try {
          if (isMarkdownPath(file.path, file.name)) {
            onSelectMarkdown?.(activeWorkspace.id, file.path);
          } else {
            const content = await invoke<string>("read_file_text", {
              root: activeWorkspace.path,
              relativePath: file.path.replace(/^\/+/, ""),
            });
            onSelectTextFile?.(activeWorkspace.id, file.path, content);
          }
        } catch (error) {
          console.error("Failed to open file:", error);
          setBanner({
            type: "err",
            text: error instanceof Error ? error.message : "Failed to open file",
          });
        }
      }
      setSelectedPath(file.path);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, file: FileNode) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      path: file.path,
      isDir: isDirectoryNode(file),
    });
  };

  const closeContextMenu = () => {
    setContextMenu(null);
  };

  const handleCreateFile = async () => {
    if (!contextMenu || !activeWorkspaceId) return;

    const fileName = window.prompt("Enter file name:");
    if (!fileName) return;

    const newPath = contextMenu.isDir
      ? `${contextMenu.path}/${fileName}`
      : `${contextMenu.path.substring(0, contextMenu.path.lastIndexOf("/"))}/${fileName}`;

    try {
      await createFile(activeWorkspaceId, newPath);
      closeContextMenu();
    } catch (error) {
      console.error("Failed to create file:", error);
    }
  };

  const handleCreateFolder = async () => {
    if (!contextMenu || !activeWorkspaceId) return;

    const folderName = window.prompt("Enter folder name:");
    if (!folderName) return;

    const newPath = contextMenu.isDir
      ? `${contextMenu.path}/${folderName}`
      : `${contextMenu.path.substring(0, contextMenu.path.lastIndexOf("/"))}/${folderName}`;

    try {
      await createFolder(activeWorkspaceId, newPath);
      closeContextMenu();
    } catch (error) {
      console.error("Failed to create folder:", error);
    }
  };

  const handleRename = async () => {
    if (!contextMenu || !activeWorkspaceId) return;

    const newName = window.prompt("Enter new name:", contextMenu.path.split("/").pop() || "");
    if (!newName) return;

    const newPath =
      contextMenu.path.substring(0, contextMenu.path.lastIndexOf("/")) + "/" + newName;

    try {
      await renameFile(activeWorkspaceId, contextMenu.path, newPath);
      closeContextMenu();
    } catch (error) {
      console.error("Failed to rename:", error);
    }
  };

  const handleDelete = async () => {
    if (!contextMenu || !activeWorkspaceId) return;

    if (window.confirm(`Delete ${contextMenu.isDir ? "folder" : "file"}?`)) {
      try {
        await deleteFile(activeWorkspaceId, contextMenu.path);
        closeContextMenu();
      } catch (error) {
        console.error("Failed to delete:", error);
      }
    }
  };

  const handleCopyPath = async () => {
    if (!contextMenu) return;

    const activeWorkspace = getActiveWorkspace();
    if (!activeWorkspace) {
      setBanner({ type: "err", text: "No workspace selected" });
      return;
    }

    try {
      const workspacePath =
        activeWorkspace.path.endsWith("/") || activeWorkspace.path.endsWith("\\")
          ? activeWorkspace.path.slice(0, -1)
          : activeWorkspace.path;
      const absolutePath = `${workspacePath}/${contextMenu.path}`;

      await navigator.clipboard.writeText(absolutePath);
      setBanner({ type: "ok", text: "Path copied" });
      closeContextMenu();
    } catch (error) {
      console.error("Failed to copy path:", error);
      setBanner({ type: "err", text: "Failed to copy path" });
    }
  };

  const handleCopyRelativePath = async () => {
    if (!contextMenu) return;

    try {
      await navigator.clipboard.writeText(contextMenu.path);
      setBanner({ type: "ok", text: "Relative path copied" });
      closeContextMenu();
    } catch (error) {
      console.error("Failed to copy relative path:", error);
      setBanner({ type: "err", text: "Copy failed" });
    }
  };

  const renderFileIcon = (file: FileNode) => {
    if (isDirectoryNode(file)) {
      return expandedPaths[file.path] ? "📂" : "📁";
    }

    if (!file.path) {
      return "📄";
    }

    const ext = file.path.split(".").pop()?.toLowerCase();
    const iconMap: Record<string, string> = {
      js: "📄",
      jsx: "⚛️",
      ts: "📘",
      tsx: "⚛️",
      py: "🐍",
      go: "🐹",
      rs: "🦀",
      java: "☕",
      html: "🌐",
      css: "🎨",
      json: "📋",
      md: "📝",
      txt: "📄",
      yml: "⚙️",
      yaml: "⚙️",
    };
    return iconMap[ext || ""] || "📄";
  };

  const renderFileTree = (files: FileNode[], level = 0) => {
    return files.map((file) => {
      const dir = isDirectoryNode(file);
      return (
      <div key={file.path}>
        <div
          className={`flex items-center gap-2 py-1 px-2 cursor-pointer hover:bg-slack-bgHover rounded ${
            selectedPath === file.path ? "bg-slack-accent text-white" : "text-slack-text"
          }`}
          style={{ paddingLeft: `${level * 16 + 8}px` }}
          onClick={() => handleFileClick(file)}
          onContextMenu={(e) => handleContextMenu(e, file)}
        >
          <span className="text-sm">
            {dir ? (expandedPaths[file.path] ? "📂" : "📁") : renderFileIcon(file)}
          </span>
          <span className="text-sm truncate flex-1">{file.name}</span>
          {dir && (
            <span className="text-xs text-slack-textMuted">
              {expandedPaths[file.path] ? "▼" : "▶"}
            </span>
          )}
        </div>
        {dir && expandedPaths[file.path] && file.children && (
          <div>{renderFileTree(file.children, level + 1)}</div>
        )}
      </div>
    );
    });
  };

  const files = activeWorkspaceId ? fileTree[activeWorkspaceId] ?? EMPTY_FILE_LIST : EMPTY_FILE_LIST;
  const displayedFiles = useMemo(
    () => (markdownOnly ? filterTreeMarkdownOnly(files) : files),
    [files, markdownOnly]
  );
  const filterExcludesEverything =
    markdownOnly && files.length > 0 && displayedFiles.length === 0;

  return (
    <div
      className="border-r border-slack-border bg-slack-bg flex flex-col h-full relative flex-shrink-0"
      style={{ width: `${width}px`, minWidth: `${MIN_WIDTH}px` }}
    >
      <div
        className="absolute right-0 top-0 bottom-0 cursor-col-resize z-[100] group"
        onMouseDown={handleResizeStart}
        aria-label="Resize file explorer panel"
        style={{
          width: "6px",
          marginRight: "-3px",
          pointerEvents: "auto",
        }}
      >
        <div className="absolute inset-0 bg-transparent group-hover:bg-blue-500/30 transition-colors" />
        <div className="absolute right-1/2 top-1/2 -translate-y-1/2 translate-x-1/2 w-1 h-8 bg-gray-400 group-hover:bg-blue-500 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>

      <div className="px-4 py-3 border-b border-slack-border bg-slack-bgHover flex-shrink-0 relative z-10 flex items-center justify-between gap-2">
        <h2 className="font-bold text-slack-text">Files</h2>
        <div className="flex items-center gap-1">
          {onOpenGallery && activeWorkspaceId && (
            <button
              type="button"
              onClick={onOpenGallery}
              className="text-slack-textMuted hover:text-slack-text transition-colors flex-shrink-0 p-0.5"
              title="Diagram gallery"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowAddWorkspace(true)}
            className="text-slack-textMuted hover:text-slack-text transition-colors flex-shrink-0 p-0.5"
            title="Add workspace"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
          </button>
        </div>
      </div>

      {(banner || galleryScanError) && (
        <div
          className={`px-3 py-2 text-xs border-b flex items-center justify-between gap-2 ${
            banner?.type === "ok"
              ? "bg-green-900/30 text-green-200 border-green-800/50"
              : "bg-red-900/30 text-red-200 border-red-800/50"
          }`}
        >
          <span>{galleryScanError ?? banner?.text}</span>
          {galleryScanError && onDismissGalleryScanError && (
            <button
              type="button"
              onClick={onDismissGalleryScanError}
              className="text-red-200/80 hover:text-red-100 flex-shrink-0"
              aria-label="Dismiss"
            >
              ×
            </button>
          )}
        </div>
      )}

      <div className="px-4 py-2 border-b border-slack-border bg-slack-bgHover flex-shrink-0 relative z-10">
        <div className="flex gap-1 overflow-x-auto">
          {workspaces.map((workspace) => (
            <div
              key={workspace.id}
              onClick={() => setActiveWorkspace(workspace.id)}
              onKeyDown={(e) => e.key === "Enter" && setActiveWorkspace(workspace.id)}
              role="button"
              tabIndex={0}
              className={`group flex items-center gap-1 px-3 py-1 text-xs rounded transition-colors whitespace-nowrap cursor-pointer ${
                activeWorkspaceId === workspace.id
                  ? "bg-slack-accent text-white"
                  : "bg-slack-bgHover text-slack-textMuted hover:text-slack-text"
              }`}
              title={workspace.path}
            >
              <span>{workspace.name}</span>
              <button
                type="button"
                onClick={(e) => handleRemoveWorkspace(e, workspace.id, workspace.name)}
                className={`ml-1 p-0.5 rounded-sm opacity-0 group-hover:opacity-100 transition-opacity ${
                  activeWorkspaceId === workspace.id
                    ? "hover:bg-white/20"
                    : "hover:bg-slack-border"
                }`}
                title={`Remove ${workspace.name}`}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Markdown-only filter: keeps tree visible (no full-panel swap) when expanding dirs */}
      <div className="flex-shrink-0 px-4 py-2 border-b border-slack-border bg-slack-bgHover">
        <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-slack-text">
          <input
            type="checkbox"
            checked={markdownOnly}
            onChange={(e) => onMarkdownOnlyChange(e.target.checked)}
            className="rounded border-slack-border bg-slack-bg text-slack-accent focus:ring-slack-accent"
          />
          <span title="Show only .md and .markdown files (folders stay if they contain matches)">
            Markdown files only
          </span>
        </label>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {error ? (
          <div className="p-4 text-center">
            <div className="text-4xl mb-2">⚠️</div>
            <div className="text-sm text-red-500 mb-2">{error}</div>
            <button
              type="button"
              onClick={clearError}
              className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded transition-colors"
            >
              Dismiss
            </button>
          </div>
        ) : loadingFiles ? (
          <div className="flex items-center justify-center h-32">
            <div className="flex items-center gap-2 text-slack-textMuted">
              <div className="w-4 h-4 border border-slack-textMuted border-t-transparent rounded-full animate-spin" />
              Loading files...
            </div>
          </div>
        ) : files.length === 0 ? (
          <div className="p-4 text-center">
            <div className="text-4xl mb-2">📁</div>
            <div className="text-sm text-slack-textMuted">No files found</div>
          </div>
        ) : filterExcludesEverything ? (
          <div className="p-4 text-center">
            <div className="text-4xl mb-2">📝</div>
            <div className="text-sm text-slack-textMuted">No Markdown files in this workspace</div>
            <button
              type="button"
              onClick={() => onMarkdownOnlyChange(false)}
              className="mt-3 text-xs text-slack-accent hover:underline"
            >
              Show all files
            </button>
          </div>
        ) : (
          <div className="py-2">{renderFileTree(displayedFiles)}</div>
        )}
      </div>

      {showAddWorkspace && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-slack-bg border border-slack-border rounded p-6 w-96">
            <h3 className="text-lg font-bold text-slack-text mb-4">Add Workspace</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slack-text mb-1">Name</label>
                <input
                  type="text"
                  value={newWorkspaceName}
                  onChange={(e) => setNewWorkspaceName(e.target.value)}
                  className="w-full px-3 py-2 bg-slack-bg border border-slack-border rounded text-slack-text focus:outline-none focus:border-slack-accent"
                  placeholder="Workspace name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slack-text mb-1">Path</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newWorkspacePath}
                    onChange={(e) => setNewWorkspacePath(e.target.value)}
                    className="flex-1 px-3 py-2 bg-slack-bg border border-slack-border rounded text-slack-text focus:outline-none focus:border-slack-accent"
                    placeholder="/path/to/workspace"
                  />
                  <button
                    type="button"
                    onClick={handleBrowseDirectory}
                    className="px-3 py-2 bg-slack-bgHover hover:bg-slack-accent text-slack-text hover:text-white rounded transition-colors"
                    title="Browse for directory"
                  >
                    📁 Browse
                  </button>
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button
                type="button"
                onClick={handleAddWorkspace}
                disabled={!newWorkspaceName || !newWorkspacePath}
                className="px-4 py-2 bg-slack-accent hover:bg-slack-accentHover text-white text-sm rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => setShowAddWorkspace(false)}
                className="px-4 py-2 bg-slack-bgHover text-slack-text text-sm rounded transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {contextMenu && (
        <div
          className="fixed z-50 bg-slack-bg border border-slack-border rounded shadow-lg py-1"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
          }}
        >
          <button
            type="button"
            onClick={handleCopyPath}
            className="w-full px-4 py-2 text-left text-sm text-slack-text hover:bg-slack-bgHover"
          >
            📋 Copy Path
          </button>
          <button
            type="button"
            onClick={handleCopyRelativePath}
            className="w-full px-4 py-2 text-left text-sm text-slack-text hover:bg-slack-bgHover"
          >
            📋 Copy Relative Path
          </button>
          <div className="border-t border-slack-border my-1" />
          <button
            type="button"
            onClick={handleCreateFile}
            className="w-full px-4 py-2 text-left text-sm text-slack-text hover:bg-slack-bgHover"
          >
            New File
          </button>
          <button
            type="button"
            onClick={handleCreateFolder}
            className="w-full px-4 py-2 text-left text-sm text-slack-text hover:bg-slack-bgHover"
          >
            New Folder
          </button>
          <div className="border-t border-slack-border my-1" />
          <button
            type="button"
            onClick={handleRename}
            className="w-full px-4 py-2 text-left text-sm text-slack-text hover:bg-slack-bgHover"
          >
            Rename
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="w-full px-4 py-2 text-left text-sm text-red-500 hover:bg-slack-bgHover"
          >
            Delete
          </button>
        </div>
      )}

      {contextMenu && (
        <div className="fixed inset-0 z-40" onClick={closeContextMenu} aria-hidden="true" />
      )}

      {pendingRemove && (
        <>
          <div className="fixed inset-0 z-50 bg-black/50" onClick={() => setPendingRemove(null)} />
          <div className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-slack-bg border border-slack-border rounded-lg shadow-xl p-5 min-w-[300px]">
            <h3 className="text-sm font-semibold text-slack-text mb-2">Remove Workspace</h3>
            <p className="text-xs text-slack-textMuted mb-4">
              Remove <span className="font-semibold text-slack-text">&quot;{pendingRemove.name}&quot;</span>{" "}
              from the file explorer? No files will be deleted.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingRemove(null)}
                className="px-3 py-1.5 text-xs rounded bg-slack-bgHover text-slack-text hover:bg-slack-border transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmRemoveWorkspace}
                className="px-3 py-1.5 text-xs rounded bg-red-600 text-white hover:bg-red-700 transition-colors"
              >
                Remove
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
