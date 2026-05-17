export const EDITOR_VISIBLE_STORAGE_KEY = "dickory-docs-markdown-editor-visible";

export function loadEditorVisiblePreference(): boolean {
  try {
    const value = localStorage.getItem(EDITOR_VISIBLE_STORAGE_KEY);
    if (value === null) return true;
    return value === "true";
  } catch {
    return true;
  }
}

export function saveEditorVisiblePreference(visible: boolean): void {
  try {
    localStorage.setItem(EDITOR_VISIBLE_STORAGE_KEY, visible ? "true" : "false");
  } catch {
    /* private mode / quota */
  }
}
