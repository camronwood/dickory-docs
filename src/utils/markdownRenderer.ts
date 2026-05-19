import { marked } from "marked";
import DOMPurify from "dompurify";
import GithubSlugger from "github-slugger";

export interface MermaidBlock {
  type: "mermaid";
  content: string;
}

export interface MarkdownParseResult {
  html: string;
  mermaidBlocks: MermaidBlock[];
}

marked.setOptions({
  breaks: true,
  gfm: true,
});

const purify = DOMPurify;

export interface MarkdownRenderOptions {
  sanitize?: boolean;
  breaks?: boolean;
  gfm?: boolean;
}

export function renderMarkdown(
  content: string,
  options: MarkdownRenderOptions = {}
): string {
  const { sanitize = true, breaks = true, gfm = true } = options;
  const markedOptions = { breaks, gfm };
  let html = marked.parse(content, markedOptions) as string;

  if (sanitize) {
    html = purify.sanitize(html, {
      ALLOWED_TAGS: [
        "h1", "h2", "h3", "h4", "h5", "h6",
        "p", "br", "hr",
        "strong", "em", "u", "s", "del", "ins",
        "code", "pre",
        "blockquote",
        "ul", "ol", "li",
        "table", "thead", "tbody", "tr", "th", "td",
        "a", "img",
        "div", "span",
      ],
      ALLOWED_ATTR: [
        "href", "title", "alt", "src", "width", "height",
        "class", "id", "style",
        "target", "rel",
        "data-mermaid-placeholder",
      ],
      ALLOW_DATA_ATTR: false,
    });
  }

  return html;
}

export function parseMarkdownWithMermaid(content: string): MarkdownParseResult {
  const mermaidBlocks: MermaidBlock[] = [];
  const mermaidRegex = /```\s*mermaid\s*(?:\r?\n|\r)?([\s\S]*?)```\s*/gi;
  const matches: Array<{ fullMatch: string; content: string; index: number }> = [];

  let match;
  while ((match = mermaidRegex.exec(content)) !== null) {
    const mermaidContent = match[1].trim();
    if (mermaidContent.length > 0) {
      matches.push({
        fullMatch: match[0],
        content: mermaidContent,
        index: match.index,
      });
    }
  }

  let processedContent = content;
  matches.sort((a, b) => b.index - a.index);

  matches.forEach((matchInfo, arrayIndex) => {
    const blockIndex = matches.length - 1 - arrayIndex;
    mermaidBlocks.unshift({
      type: "mermaid",
      content: matchInfo.content,
    });
    const placeholder = `<div data-mermaid-placeholder="${blockIndex}"></div>`;
    const before = processedContent.substring(0, matchInfo.index);
    const after = processedContent.substring(matchInfo.index + matchInfo.fullMatch.length);
    processedContent = before + placeholder + after;
  });

  const html = renderMarkdown(processedContent);

  if (import.meta.env.DEV && mermaidBlocks.length > 0) {
    console.log(`[MarkdownRenderer] Found ${mermaidBlocks.length} mermaid block(s)`);
  }

  return { html, mermaidBlocks };
}

export type MarkdownSegment =
  | { type: "markdown"; content: string }
  | { type: "mermaid"; content: string };

/** Matches ```mermaid fences — keep in sync with Rust `extract_mermaid_blocks_from_markdown`. */
export const MERMAID_FENCE_REGEX = /```\s*mermaid\s*(?:\r?\n|\r)?([\s\S]*?)```\s*/gi;

export type MermaidBlockRef = {
  filePath: string;
  blockIndex: number;
  content: string;
};

export function extractMermaidBlocks(
  raw: string,
  filePath: string
): MermaidBlockRef[] {
  const blocks: MermaidBlockRef[] = [];
  const re = new RegExp(MERMAID_FENCE_REGEX.source, MERMAID_FENCE_REGEX.flags);
  let match: RegExpExecArray | null;
  let blockIndex = 0;

  while ((match = re.exec(raw)) !== null) {
    const mermaidContent = match[1].trim();
    if (mermaidContent.length > 0) {
      blocks.push({
        filePath,
        blockIndex,
        content: mermaidContent,
      });
      blockIndex += 1;
    }
  }

  return blocks;
}

export function splitMarkdownAndMermaid(raw: string): MarkdownSegment[] {
  const mermaidRegex = new RegExp(MERMAID_FENCE_REGEX.source, MERMAID_FENCE_REGEX.flags);
  const segments: MarkdownSegment[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = mermaidRegex.exec(raw)) !== null) {
    if (match.index > cursor) {
      segments.push({ type: "markdown", content: raw.slice(cursor, match.index) });
    }
    const mermaidContent = match[1].trim();
    if (mermaidContent.length > 0) {
      segments.push({ type: "mermaid", content: mermaidContent });
    }
    cursor = match.index + match[0].length;
  }

  if (cursor < raw.length) {
    segments.push({ type: "markdown", content: raw.slice(cursor) });
  }

  return segments;
}

export function extractTitle(content: string): string {
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("# ")) {
      return trimmed.substring(2).trim();
    }
  }
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      return trimmed.length > 50 ? trimmed.substring(0, 50) + "..." : trimmed;
    }
  }
  return "Untitled";
}

export function getContentHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

/** GitHub-style slug; collapse runs of hyphens so TOC links like `#tools-ci-local` match. */
export function slugifyHeading(text: string, slugger: GithubSlugger): string {
  return slugger.slug(text).replace(/-+/g, "-");
}

/** Assign `id` on h1–h6 under `root` (call once per preview, after all segments mount). */
export function assignHeadingIds(root: HTMLElement): void {
  const slugger = new GithubSlugger();
  root.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((node) => {
    const text = node.textContent?.trim() ?? "";
    if (!text) return;
    node.id = slugifyHeading(text, slugger);
  });
}

export function normalizeHeadingId(hash: string): string {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  try {
    return decodeURIComponent(raw).replace(/-+/g, "-");
  } catch {
    return raw.replace(/-+/g, "-");
  }
}

/** Scroll a heading into view inside the preview scroll container. */
export function scrollToHeading(root: HTMLElement, hash: string): boolean {
  const id = normalizeHeadingId(hash);
  if (!id) return false;

  const el =
    root.querySelector<HTMLElement>(`#${CSS.escape(id)}`) ??
    root.querySelector<HTMLElement>(`[id="${id}"]`);

  if (!el) return false;

  el.scrollIntoView({ behavior: "smooth", block: "start" });
  if (typeof history !== "undefined" && history.replaceState) {
    history.replaceState(null, "", `#${id}`);
  }
  return true;
}
