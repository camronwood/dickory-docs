export function parentPath(path: string): string | null {
  const normalized = path.replace(/^\/+/, "");
  const idx = normalized.lastIndexOf("/");
  if (idx <= 0) return null;
  return normalized.slice(0, idx);
}

export function formatSearchResultPath(path: string): string {
  const normalized = path.replace(/^\/+/, "");
  const parent = parentPath(normalized);
  return parent ?? "";
}
