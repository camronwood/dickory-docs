import type { FileNode } from "../stores/fileExplorerStore";

function isDirectoryNode(node: FileNode): boolean {
  const n = node as FileNode & { isDir?: boolean };
  return node.is_dir === true || n.isDir === true;
}

/** Keep nodes whose name matches `query`, or directories that contain a match in loaded children. */
export function filterTreeByFileName(nodes: FileNode[], query: string): FileNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return nodes;

  const out: FileNode[] = [];
  for (const node of nodes) {
    const nameMatches = node.name.toLowerCase().includes(q);

    if (!isDirectoryNode(node)) {
      if (nameMatches) out.push(node);
      continue;
    }

    const filteredChildren =
      node.children !== undefined ? filterTreeByFileName(node.children, query) : undefined;

    if (nameMatches) {
      out.push({
        ...node,
        children: filteredChildren ?? node.children,
      });
      continue;
    }

    if (filteredChildren && filteredChildren.length > 0) {
      out.push({ ...node, children: filteredChildren });
      continue;
    }

    // Unexpanded dir: show so user can expand and search deeper
    if (node.children === undefined && !nameMatches) {
      continue;
    }
  }
  return out;
}

export function treeHasFileNameMatch(nodes: FileNode[], query: string): boolean {
  return filterTreeByFileName(nodes, query).length > 0;
}
