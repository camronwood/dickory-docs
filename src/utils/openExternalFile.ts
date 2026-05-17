import { invoke } from "@tauri-apps/api/tauri";
import { useFileExplorerStore } from "../stores/fileExplorerStore";

export type ResolvedExternalFile = {
  workspace_path: string;
  relative_path: string;
  add_workspace: boolean;
  workspace_name: string;
};

function normalizeFsPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * Open a Markdown file from an absolute path (Finder Open With, CLI, etc.).
 */
export async function openExternalMarkdownFile(
  absolutePath: string,
  onOpen: (workspaceId: string, relativePath: string) => void
): Promise<void> {
  const resolved = await invoke<ResolvedExternalFile>("resolve_external_file", {
    path: absolutePath,
  });

  const store = useFileExplorerStore.getState();
  const rootNorm = normalizeFsPath(resolved.workspace_path);

  let workspaceId: string;

  if (resolved.add_workspace) {
    const ws = await store.addWorkspace(resolved.workspace_name, resolved.workspace_path);
    workspaceId = ws.id;
  } else {
    const existing = store.workspaces.find(
      (w) => normalizeFsPath(w.path) === rootNorm
    );
    if (existing) {
      workspaceId = existing.id;
      store.setActiveWorkspace(existing.id);
    } else {
      const ws = await store.addWorkspace(resolved.workspace_name, resolved.workspace_path);
      workspaceId = ws.id;
    }
  }

  const rel = resolved.relative_path.replace(/^\/+/, "");
  await store.loadFiles(workspaceId);
  store.setSelectedPath(rel);
  onOpen(workspaceId, rel);
}
