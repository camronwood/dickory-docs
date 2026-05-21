export const ACTIVE_WORKSPACE_STORAGE_KEY = "dickory-docs-active-workspace-id";
const LEGACY_ACTIVE_WORKSPACE_STORAGE_KEY = "doc-watson-active-workspace-id";

export function loadActiveWorkspaceId(): string | null {
  try {
    const current = localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY);
    if (current) return current;
    return localStorage.getItem(LEGACY_ACTIVE_WORKSPACE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveActiveWorkspaceId(workspaceId: string): void {
  try {
    localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, workspaceId);
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearActiveWorkspaceId(): void {
  try {
    localStorage.removeItem(ACTIVE_WORKSPACE_STORAGE_KEY);
    localStorage.removeItem(LEGACY_ACTIVE_WORKSPACE_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
