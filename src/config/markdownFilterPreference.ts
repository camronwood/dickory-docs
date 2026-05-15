/** Shared with App + FileExplorerPanel via props (single source of truth in App). */
export const MARKDOWN_ONLY_STORAGE_KEY = "dickory-docs-markdown-only-filter";
const LEGACY_MARKDOWN_ONLY_STORAGE_KEY = "doc-watson-markdown-only-filter";

export function loadMarkdownOnlyPreference(): boolean {
  try {
    const current = localStorage.getItem(MARKDOWN_ONLY_STORAGE_KEY);
    if (current !== null) return current === "true";
    const legacy = localStorage.getItem(LEGACY_MARKDOWN_ONLY_STORAGE_KEY);
    if (legacy !== null) return legacy === "true";
    return false;
  } catch {
    return false;
  }
}

export function saveMarkdownOnlyPreference(value: boolean): void {
  try {
    localStorage.setItem(MARKDOWN_ONLY_STORAGE_KEY, value ? "true" : "false");
  } catch {
    /* private mode / quota */
  }
}
