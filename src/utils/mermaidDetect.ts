/**
 * Mermaid block detection — keep in sync with Rust `extract_mermaid_blocks` in main.rs.
 */

/** Opening info-line is a known code language → never treat as Mermaid. */
export const CODE_FENCE_LANGS = new Set([
  "python",
  "py",
  "rust",
  "rs",
  "go",
  "golang",
  "javascript",
  "js",
  "typescript",
  "ts",
  "tsx",
  "jsx",
  "bash",
  "sh",
  "shell",
  "zsh",
  "fish",
  "json",
  "yaml",
  "yml",
  "toml",
  "xml",
  "html",
  "htm",
  "css",
  "scss",
  "sass",
  "sql",
  "java",
  "kotlin",
  "kt",
  "swift",
  "ruby",
  "rb",
  "cpp",
  "c",
  "h",
  "hpp",
  "csharp",
  "cs",
  "php",
  "lua",
  "r",
  "dart",
  "scala",
  "perl",
  "pl",
  "dockerfile",
  "makefile",
  "cmake",
  "diff",
  "patch",
  "text",
  "txt",
  "plaintext",
  "console",
  "terminal",
  "powershell",
  "ps1",
  "objc",
  "objectivec",
  "matlab",
  "latex",
  "tex",
  "bibtex",
  "graphql",
  "protobuf",
  "proto",
  "wasm",
  "llvm",
  "ini",
  "properties",
  "csv",
  "markdown",
  "md",
]);

const MERMAID_DIAGRAM_START =
  /^(graph\b|flowchart\b|sequenceDiagram\b|classDiagram\b|stateDiagram\b|erDiagram\b|journey\b|gantt\b|pie\b|gitGraph\b|mindmap\b|timeline\b|quadrantChart\b|C4Context\b|block-beta\b|xychart\b|sankey\b)/;

const INIT_DIRECTIVE_LINE = /^\s*%%\{[\s\S]*?\}%%\s*$/;

/** Generic fenced block: info line (may be empty) then body until closing ``` */
const FENCED_BLOCK_REGEX = /```([^\n`]*)(?:\r?\n|\r)([\s\S]*?)```\s*/g;

export type MermaidBlockSpan = {
  content: string;
  start: number;
  end: number;
};

export function isMmdPath(filePath?: string): boolean {
  if (!filePath) return false;
  return /\.mmd$/i.test(filePath.replace(/\\/g, "/"));
}

function firstInfoToken(infoLine: string): string {
  const trimmed = infoLine.trim();
  if (!trimmed) return "";
  return trimmed.split(/\s+/)[0]!.toLowerCase();
}

/** Conservative: strip leading %%{init}%% lines, then require a diagram keyword. */
export function looksLikeMermaidDiagram(body: string): boolean {
  const lines = body.trim().split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!.trim();
    if (!line) {
      i += 1;
      continue;
    }
    if (INIT_DIRECTIVE_LINE.test(line)) {
      i += 1;
      continue;
    }
    return MERMAID_DIAGRAM_START.test(line);
  }
  return false;
}

function fenceAcceptsAsMermaid(infoLine: string, body: string): boolean {
  const token = firstInfoToken(infoLine);
  if (token === "mermaid") return true;
  if (token && CODE_FENCE_LANGS.has(token)) return false;
  if (token === "") return looksLikeMermaidDiagram(body);
  return false;
}

/** When the opening line is `mermaid graph TD`, diagram text may follow the tag on that line. */
function mermaidBodyFromFence(infoLine: string, body: string): string {
  const trimmedBody = body.trim();
  const info = infoLine.trim();
  if (firstInfoToken(infoLine) !== "mermaid") {
    return trimmedBody;
  }
  const rest = info.replace(/^mermaid/i, "").trim();
  if (!rest) return trimmedBody;
  if (!trimmedBody) return rest;
  return `${rest}\n${trimmedBody}`;
}

/**
 * Extract Mermaid diagram bodies in document order.
 * `.mmd` files: whole file is one diagram (no fences required).
 */
export function extractMermaidBlocksFromText(
  content: string,
  filePath?: string
): MermaidBlockSpan[] {
  if (isMmdPath(filePath)) {
    const trimmed = content.trim();
    if (!trimmed) return [];
    return [{ content: trimmed, start: 0, end: content.length }];
  }

  const spans: MermaidBlockSpan[] = [];
  const re = new RegExp(FENCED_BLOCK_REGEX.source, FENCED_BLOCK_REGEX.flags);
  let match: RegExpExecArray | null;

  while ((match = re.exec(content)) !== null) {
    const infoLine = match[1] ?? "";
    const body = match[2] ?? "";
    if (!fenceAcceptsAsMermaid(infoLine, body)) continue;

    const trimmed = mermaidBodyFromFence(infoLine, body).trim();
    if (!trimmed) continue;

    spans.push({
      content: trimmed,
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  return spans;
}

/** @deprecated Use extractMermaidBlocksFromText; kept for tests referencing tagged-only fences. */
export const MERMAID_FENCE_REGEX = /```\s*mermaid\s*(?:\r?\n|\r)?([\s\S]*?)```\s*/gi;
