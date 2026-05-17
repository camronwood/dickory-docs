import { create } from "zustand";
import { invoke } from "@tauri-apps/api/tauri";
import { getContentHash } from "../utils/markdownRenderer";

interface MarkdownEditorState {
  workspaceId: string | null;
  workspaceRoot: string;
  path: string | null;
  content: string;
  isDirty: boolean;
  saving: boolean;
  error: string | null;
  contentSyncKey: number;
  /** Hash of last loaded/saved disk content for external-change detection. */
  diskContentHash: string;
  externalChangePending: boolean;

  openMarkdown: (
    workspaceId: string,
    workspaceRoot: string,
    path: string,
    content: string
  ) => void;
  updateContent: (content: string) => void;
  save: () => Promise<boolean>;
  reloadFromDisk: () => Promise<boolean>;
  applyDiskContent: (content: string) => void;
  dismissExternalChange: () => void;
  reset: () => void;
  confirmDiscardIfDirty: () => boolean;
  matchesFile: (workspaceId: string, path: string) => boolean;
}

const initialState = {
  workspaceId: null as string | null,
  workspaceRoot: "",
  path: null as string | null,
  content: "",
  isDirty: false,
  saving: false,
  error: null as string | null,
  contentSyncKey: 0,
  diskContentHash: "",
  externalChangePending: false,
};

export const useMarkdownEditorStore = create<MarkdownEditorState>((set, get) => ({
  ...initialState,

  openMarkdown: (workspaceId, workspaceRoot, path, content) => {
    const rel = path.replace(/^\/+/, "");
    const hash = getContentHash(content);
    set({
      workspaceId,
      workspaceRoot,
      path: rel,
      content,
      isDirty: false,
      saving: false,
      error: null,
      contentSyncKey: 0,
      diskContentHash: hash,
      externalChangePending: false,
    });
  },

  updateContent: (content) => {
    set((state) => {
      if (state.content === content) return state;
      return { content, isDirty: true, error: null };
    });
  },

  save: async () => {
    const state = get();
    if (!state.path || !state.workspaceRoot.trim()) return false;

    set({ saving: true, error: null });

    try {
      await invoke("write_file_text", {
        root: state.workspaceRoot,
        relativePath: state.path,
        content: state.content,
      });
      const hash = getContentHash(state.content);
      set({
        isDirty: false,
        saving: false,
        error: null,
        diskContentHash: hash,
        externalChangePending: false,
      });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save file";
      set({ saving: false, error: message });
      return false;
    }
  },

  reloadFromDisk: async () => {
    const state = get();
    if (!state.path || !state.workspaceRoot.trim()) return false;

    if (state.isDirty) {
      const ok = window.confirm(
        "You have unsaved changes. Reload from disk and discard edits?"
      );
      if (!ok) return false;
    }

    try {
      const fileContent = await invoke<string>("read_file_text", {
        root: state.workspaceRoot,
        relativePath: state.path,
      });
      const hash = getContentHash(fileContent);
      set({
        content: fileContent,
        isDirty: false,
        error: null,
        contentSyncKey: state.contentSyncKey + 1,
        diskContentHash: hash,
        externalChangePending: false,
      });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load file";
      set({ error: message });
      return false;
    }
  },

  applyDiskContent: (content) => {
    const hash = getContentHash(content);
    set((state) => ({
      content,
      isDirty: false,
      contentSyncKey: state.contentSyncKey + 1,
      diskContentHash: hash,
      externalChangePending: false,
    }));
  },

  dismissExternalChange: () => {
    set({ externalChangePending: false });
  },

  reset: () => {
    set(initialState);
  },

  confirmDiscardIfDirty: () => {
    const { isDirty } = get();
    if (!isDirty) return true;
    return window.confirm("You have unsaved changes. Discard them?");
  },

  matchesFile: (workspaceId, path) => {
    const state = get();
    const rel = path.replace(/^\/+/, "");
    return state.workspaceId === workspaceId && state.path === rel;
  },
}));

/** Poll disk; if content changed externally, flag or auto-reload when clean. */
export async function checkDiskForExternalChanges(): Promise<void> {
  const state = useMarkdownEditorStore.getState();
  if (!state.path || !state.workspaceRoot.trim()) return;

  try {
    const fileContent = await invoke<string>("read_file_text", {
      root: state.workspaceRoot,
      relativePath: state.path,
    });
    const hash = getContentHash(fileContent);
    if (hash === state.diskContentHash) return;

    if (state.isDirty) {
      useMarkdownEditorStore.setState({ externalChangePending: true });
    } else {
      useMarkdownEditorStore.getState().applyDiskContent(fileContent);
    }
  } catch {
    /* ignore poll errors */
  }
}
