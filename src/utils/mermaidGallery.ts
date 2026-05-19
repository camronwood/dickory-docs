import type { MermaidBlockRef } from "./markdownRenderer";

export type GalleryScope = "workspace" | "file";

export interface ScannedMermaidBlock {
  path: string;
  block_index: number;
  content: string;
}

export interface MermaidScanResult {
  blocks: ScannedMermaidBlock[];
  markdown_files: number;
  files_unreadable: number;
}

export interface GalleryScanStats {
  markdownFiles: number;
  filesUnreadable: number;
}

export function galleryEmptyMessage(
  scope: GalleryScope,
  stats: GalleryScanStats
): { title: string; detail: string } {
  if (scope === "file") {
    return {
      title: "No Mermaid diagrams in this file",
      detail:
        "Use ```mermaid, an untagged ``` block whose body starts with graph/flowchart/etc., or a .mmd file. Supported: .md, .markdown, .mdx, .mmd.",
    };
  }
  if (stats.markdownFiles === 0) {
    return {
      title: "No Markdown files in workspace",
      detail:
        "Add a folder with .md, .markdown, .mdx, or .mmd files containing Mermaid diagrams (```mermaid, untagged ``` blocks, or raw .mmd). Plain code files are not scanned.",
    };
  }
  if (stats.filesUnreadable > 0) {
    return {
      title: "No Mermaid diagrams found",
      detail: `Scanned ${stats.markdownFiles} file(s), but ${stats.filesUnreadable} could not be read. None of the readable files contain detectable Mermaid (tagged \`\`\`mermaid, untagged \`\`\` diagram blocks, or .mmd).`,
    };
  }
  return {
    title: "No Mermaid diagrams found",
    detail: `Scanned ${stats.markdownFiles} file(s); none contain detectable Mermaid (\`\`\`mermaid, untagged \`\`\` blocks with graph/flowchart/etc., or .mmd).`,
  };
}

export function mapScannedBlocks(blocks: ScannedMermaidBlock[]): MermaidBlockRef[] {
  return blocks.map((b) => ({
    filePath: b.path,
    blockIndex: b.block_index,
    content: b.content,
  }));
}

export function filterBlocksByFile(
  items: MermaidBlockRef[],
  filePath: string
): MermaidBlockRef[] {
  const normalized = filePath.replace(/^\/+/, "");
  return items.filter((item) => item.filePath.replace(/^\/+/, "") === normalized);
}

export function findGalleryIndex(
  items: MermaidBlockRef[],
  filePath: string,
  blockIndex?: number,
  content?: string
): number {
  const normalized = filePath.replace(/^\/+/, "");
  if (blockIndex !== undefined) {
    const idx = items.findIndex(
      (item) =>
        item.filePath.replace(/^\/+/, "") === normalized && item.blockIndex === blockIndex
    );
    if (idx >= 0) return idx;
  }
  if (content !== undefined) {
    const idx = items.findIndex(
      (item) =>
        item.filePath.replace(/^\/+/, "") === normalized && item.content === content
    );
    if (idx >= 0) return idx;
  }
  return 0;
}

export function preserveIndexOnScopeChange(
  currentItem: MermaidBlockRef | undefined,
  newItems: MermaidBlockRef[]
): number {
  if (!currentItem || newItems.length === 0) return 0;
  const idx = newItems.findIndex(
    (item) =>
      item.filePath === currentItem.filePath &&
      item.blockIndex === currentItem.blockIndex &&
      item.content === currentItem.content
  );
  return idx >= 0 ? idx : 0;
}
