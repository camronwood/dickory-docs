/** Resolve a Markdown link target relative to the file being previewed. */
export function resolveRelativeMarkdownPath(href: string, currentFilePath: string): string | null {
  const raw = href.trim().split(/\s+/)[0];
  if (!raw || raw.startsWith("#")) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null;

  const current = currentFilePath.replace(/^\/+/, "");
  const currentDir = current.includes("/") ? current.split("/").slice(0, -1) : [];

  const segments = raw.replace(/^\/+/, "").split("/");
  const stack = [...currentDir];

  for (const seg of segments) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      stack.pop();
      continue;
    }
    stack.push(seg);
  }

  return stack.join("/");
}

export function isExternalHref(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href.trim());
}

export function isMarkdownFilePath(path: string): boolean {
  const base = path.split(/[#?]/)[0].trim().toLowerCase();
  return base.endsWith(".md") || base.endsWith(".markdown");
}

export type MarkdownLinkAction =
  | { type: "heading"; hash: string }
  | { type: "markdown"; relativePath: string }
  | { type: "external"; url: string };

export function resolveMarkdownLinkAction(
  href: string,
  currentFilePath: string
): MarkdownLinkAction | null {
  const trimmed = href.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("#")) {
    return { type: "heading", hash: trimmed };
  }

  if (isExternalHref(trimmed)) {
    return { type: "external", url: trimmed };
  }

  const resolved = resolveRelativeMarkdownPath(trimmed, currentFilePath);
  if (resolved && isMarkdownFilePath(resolved)) {
    return { type: "markdown", relativePath: resolved };
  }

  return null;
}
