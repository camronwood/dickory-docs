import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/tauri";
import { useFileExplorerStore } from "../stores/fileExplorerStore";

const WORKSPACE_FS_CHANGED_EVENT = "workspace-fs-changed";
const REFRESH_DEBOUNCE_MS = 150;

/**
 * Watch the active workspace on disk and refresh the file tree when files change
 * outside the app (editors, terminals, git, etc.).
 */
export function useWorkspaceFsWatch(
  activeWorkspaceId: string | null,
  workspaces: { id: string; path: string }[]
): void {
  const refreshFileTree = useFileExplorerStore((s) => s.refreshFileTree);
  const refreshTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const workspace = workspaces.find((w) => w.id === activeWorkspaceId);
    if (!workspace) {
      void invoke("workspace_fs_watch_clear").catch((err) =>
        console.error("Failed to clear workspace file watch:", err)
      );
      return;
    }

    void invoke("workspace_fs_watch_set", {
      root: workspace.path,
      workspaceId: workspace.id,
    }).catch((err) => console.error("Failed to start workspace file watch:", err));

    return () => {
      void invoke("workspace_fs_watch_clear").catch(() => {});
    };
  }, [activeWorkspaceId, workspaces]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    void listen<string>(WORKSPACE_FS_CHANGED_EVENT, (event) => {
      const activeId = useFileExplorerStore.getState().activeWorkspaceId;
      if (!activeId || event.payload !== activeId) return;

      window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = window.setTimeout(() => {
        void refreshFileTree(activeId);
      }, REFRESH_DEBOUNCE_MS);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
      if (refreshTimerRef.current !== undefined) {
        window.clearTimeout(refreshTimerRef.current);
      }
    };
  }, [refreshFileTree]);
}
