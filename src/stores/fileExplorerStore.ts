import { create } from "zustand";
import { invoke } from "@tauri-apps/api/tauri";

export interface Workspace {
  id: string;
  name: string;
  path: string;
  created_at: string;
  last_used: string;
  is_git_repo: boolean;
  git_remote?: string;
  git_branch?: string;
}

export interface FileNode {
  name: string;
  is_dir: boolean;
  size: number;
  mod_time: string;
  children?: FileNode[];
  expanded?: boolean;
  path: string;
}

function workspaceRoot(state: FileExplorerState, workspaceId: string): string | null {
  return state.workspaces.find((w) => w.id === workspaceId)?.path ?? null;
}

/** API uses "" for workspace root; tree uses `/` only in UI for legacy checks. */
function toDirRelativePath(path: string): string {
  if (!path || path === "/") return "";
  return path.replace(/^\/+/, "");
}

/** Coerce JSON into strict booleans so tree merge + markdown filter stay consistent. */
function normalizeFetchedNodes(nodes: FileNode[]): FileNode[] {
  return nodes.map((node) => {
    const n = node as FileNode & { isDir?: boolean };
    const isDir = node.is_dir === true || n.isDir === true;
    const relPath =
      typeof node.path === "string" ? node.path.replace(/\\/g, "/") : node.path;
    return { ...node, path: relPath, is_dir: isDir };
  });
}

interface FileExplorerState {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  fileTree: Record<string, FileNode[]>;
  expandedPaths: Record<string, boolean>;
  selectedPath: string | null;
  loadingWorkspaces: boolean;
  loadingFiles: boolean;
  error: string | null;

  loadWorkspaces: () => Promise<void>;
  addWorkspace: (name: string, path: string) => Promise<Workspace>;
  removeWorkspace: (workspaceId: string) => Promise<void>;
  setActiveWorkspace: (workspaceId: string) => void;
  loadFiles: (workspaceId: string, path?: string) => Promise<void>;
  toggleExpanded: (path: string) => void;
  setSelectedPath: (path: string | null) => void;
  createFile: (workspaceId: string, path: string, content?: string) => Promise<void>;
  createFolder: (workspaceId: string, path: string) => Promise<void>;
  renameFile: (workspaceId: string, oldPath: string, newPath: string) => Promise<void>;
  deleteFile: (workspaceId: string, path: string) => Promise<void>;
  setError: (error: string | null) => void;
  clearError: () => void;
  getActiveWorkspace: () => Workspace | null;
  getFileTree: (workspaceId: string) => FileNode[];
  isPathExpanded: (path: string) => boolean;
  getFileByPath: (workspaceId: string, path: string) => FileNode | null;
}

export const useFileExplorerStore = create<FileExplorerState>((set, get) => ({
  workspaces: [],
  activeWorkspaceId: null,
  fileTree: {},
  expandedPaths: {},
  selectedPath: null,
  loadingWorkspaces: false,
  loadingFiles: false,
  error: null,

  loadWorkspaces: async () => {
    set({ loadingWorkspaces: true, error: null });
    try {
      const workspaces = await invoke<Workspace[]>("workspaces_load");
      set({
        workspaces,
        activeWorkspaceId: workspaces[0]?.id || null,
        loadingWorkspaces: false,
      });
    } catch (error) {
      console.error("Failed to load workspaces:", error);
      set({
        loadingWorkspaces: false,
        error: error instanceof Error ? error.message : "Failed to load workspaces",
      });
    }
  },

  addWorkspace: async (name, path) => {
    try {
      const workspace = await invoke<Workspace>("workspace_add", { name, path });
      set((state) => ({
        workspaces: [...state.workspaces, workspace],
        activeWorkspaceId: workspace.id,
      }));
      return workspace;
    } catch (error) {
      console.error("Failed to add workspace:", error);
      set({ error: error instanceof Error ? error.message : "Failed to add workspace" });
      throw error;
    }
  },

  removeWorkspace: async (workspaceId) => {
    try {
      await invoke("workspace_remove", { id: workspaceId });
      set((state) => {
        const newWorkspaces = state.workspaces.filter((w) => w.id !== workspaceId);
        const newActiveWorkspaceId =
          state.activeWorkspaceId === workspaceId
            ? newWorkspaces[0]?.id || null
            : state.activeWorkspaceId;
        const { [workspaceId]: _, ...newFileTree } = state.fileTree;
        return {
          workspaces: newWorkspaces,
          activeWorkspaceId: newActiveWorkspaceId,
          fileTree: newFileTree,
        };
      });
    } catch (error) {
      console.error("Failed to remove workspace:", error);
      throw error;
    }
  },

  setActiveWorkspace: (workspaceId) => {
    set({ activeWorkspaceId: workspaceId });
  },

  loadFiles: async (workspaceId, path = "/") => {
    const root = workspaceRoot(get(), workspaceId);
    if (!root) {
      set({ error: "No workspace root", loadingFiles: false });
      return;
    }

    const isRootLoad = path === "/";
    set({
      ...(isRootLoad ? { loadingFiles: true } : {}),
      error: null,
    });
    try {
      const rel = toDirRelativePath(path);
      const rawFiles = await invoke<FileNode[]>("dir_list", {
        root,
        relativePath: rel,
      });
      const files = normalizeFetchedNodes(rawFiles);
      set((state) => {
        let updatedFiles: FileNode[];
        if (path === "/") {
          updatedFiles = files;
        } else {
          const currentFiles = state.fileTree[workspaceId] || [];
          const updateFileTree = (
            fileList: FileNode[],
            targetPath: string,
            newFiles: FileNode[]
          ): FileNode[] =>
            fileList.map((file) => {
              if (file.path === targetPath && file.is_dir === true) {
                return { ...file, children: newFiles };
              }
              if (file.children) {
                return { ...file, children: updateFileTree(file.children, targetPath, newFiles) };
              }
              return file;
            });
          updatedFiles = updateFileTree(currentFiles, path, files);
        }
        return {
          fileTree: { ...state.fileTree, [workspaceId]: updatedFiles },
          ...(isRootLoad ? { loadingFiles: false } : {}),
        };
      });
    } catch (error) {
      console.error("Failed to load files:", error);
      set({
        ...(isRootLoad ? { loadingFiles: false } : {}),
        error: error instanceof Error ? error.message : "Failed to load files",
      });
    }
  },

  toggleExpanded: (path) => {
    set((state) => {
      const { [path]: wasExpanded, ...rest } = state.expandedPaths;
      return {
        expandedPaths: wasExpanded ? rest : { ...state.expandedPaths, [path]: true },
      };
    });
  },

  setSelectedPath: (path) => {
    set({ selectedPath: path });
  },

  createFile: async (workspaceId, path, content = "") => {
    const root = workspaceRoot(get(), workspaceId);
    if (!root) throw new Error("No workspace root");
    try {
      await invoke("write_file_text", {
        root,
        relativePath: toDirRelativePath(path),
        content,
      });
      await get().loadFiles(workspaceId);
    } catch (error) {
      console.error("Failed to create file:", error);
      set({ error: error instanceof Error ? error.message : "Failed to create file" });
      throw error;
    }
  },

  createFolder: async (workspaceId, path) => {
    const root = workspaceRoot(get(), workspaceId);
    if (!root) throw new Error("No workspace root");
    try {
      await invoke("create_folder", {
        root,
        relativePath: toDirRelativePath(path),
      });
      await get().loadFiles(workspaceId);
    } catch (error) {
      console.error("Failed to create folder:", error);
      set({ error: error instanceof Error ? error.message : "Failed to create folder" });
      throw error;
    }
  },

  renameFile: async (workspaceId, oldPath, newPath) => {
    const root = workspaceRoot(get(), workspaceId);
    if (!root) throw new Error("No workspace root");
    try {
      await invoke("rename_entry", {
        root,
        oldPath: toDirRelativePath(oldPath),
        newPath: toDirRelativePath(newPath),
      });
      await get().loadFiles(workspaceId);
    } catch (error) {
      console.error("Failed to rename file:", error);
      set({ error: error instanceof Error ? error.message : "Failed to rename file" });
      throw error;
    }
  },

  deleteFile: async (workspaceId, path) => {
    const root = workspaceRoot(get(), workspaceId);
    if (!root) throw new Error("No workspace root");
    try {
      await invoke("delete_entry", {
        root,
        relativePath: toDirRelativePath(path),
      });
      await get().loadFiles(workspaceId);
    } catch (error) {
      console.error("Failed to delete file:", error);
      set({ error: error instanceof Error ? error.message : "Failed to delete file" });
      throw error;
    }
  },

  getActiveWorkspace: () => {
    const state = get();
    return state.workspaces.find((w) => w.id === state.activeWorkspaceId) || null;
  },

  getFileTree: (workspaceId) => {
    const state = get();
    return state.fileTree[workspaceId] || [];
  },

  isPathExpanded: (path) => {
    const state = get();
    return !!state.expandedPaths[path];
  },

  getFileByPath: (workspaceId, path) => {
    const state = get();
    const files = state.fileTree[workspaceId] || [];
    const findFile = (nodes: FileNode[], targetPath: string): FileNode | null => {
      for (const node of nodes) {
        if (node.path === targetPath) return node;
        if (node.children) {
          const found = findFile(node.children, targetPath);
          if (found) return found;
        }
      }
      return null;
    };
    return findFile(files, path);
  },

  setError: (error) => {
    set({ error });
  },

  clearError: () => {
    set({ error: null });
  },
}));
