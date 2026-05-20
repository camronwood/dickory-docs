import type { FileNode } from "../stores/fileExplorerStore";

function normalizeRelPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function sortTreeNodes(nodes: FileNode[]): void {
  nodes.sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
  for (const node of nodes) {
    if (node.children?.length) sortTreeNodes(node.children);
  }
}

/**
 * Build a directory tree that contains only markdown/mmd files and ancestor folders
 * (no empty folders).
 */
export function buildMarkdownOnlyTree(files: FileNode[]): FileNode[] {
  const sorted = [...files].sort((a, b) =>
    normalizeRelPath(a.path).localeCompare(normalizeRelPath(b.path))
  );
  const dirs = new Map<string, FileNode>();
  const root: FileNode[] = [];

  const getOrCreateDir = (dirPath: string): FileNode => {
    const existing = dirs.get(dirPath);
    if (existing) return existing;

    const name = dirPath.includes("/")
      ? dirPath.slice(dirPath.lastIndexOf("/") + 1)
      : dirPath;
    const node: FileNode = {
      name,
      path: dirPath,
      is_dir: true,
      size: 0,
      mod_time: "",
      children: [],
    };
    dirs.set(dirPath, node);

    const parentPath = dirPath.includes("/") ? dirPath.slice(0, dirPath.lastIndexOf("/")) : "";
    if (parentPath) {
      getOrCreateDir(parentPath).children!.push(node);
    } else {
      root.push(node);
    }
    return node;
  };

  for (const file of sorted) {
    const path = normalizeRelPath(file.path);
    const parts = path.split("/").filter(Boolean);
    if (parts.length === 0) continue;

    const fileNode: FileNode = {
      ...file,
      path,
      name: parts[parts.length - 1]!,
      is_dir: false,
    };

    if (parts.length === 1) {
      root.push(fileNode);
      continue;
    }

    const parentPath = parts.slice(0, -1).join("/");
    getOrCreateDir(parentPath).children!.push(fileNode);
  }

  sortTreeNodes(root);
  return root;
}
