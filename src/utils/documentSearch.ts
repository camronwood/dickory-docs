const HIT_CLASS = "doc-search-hit";
const ACTIVE_CLASS = "doc-search-hit-active";

export function clearDocumentHighlights(root: HTMLElement): void {
  root.querySelectorAll(`mark.${HIT_CLASS}`).forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(mark.textContent ?? ""), mark);
    parent.normalize();
  });
}

function shouldSearchTextNode(node: Text): boolean {
  const parent = node.parentElement;
  if (!parent) return false;
  if (parent.closest(`mark.${HIT_CLASS}`)) return false;
  if (parent.closest("script, style, svg")) return false;
  return true;
}

/** Highlight matches under `root`; scroll active match into view. Returns total hit count. */
export function highlightDocumentMatches(
  root: HTMLElement,
  query: string,
  activeIndex: number
): number {
  clearDocumentHighlights(root);

  const trimmed = query.trim();
  if (!trimmed) return 0;

  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(escaped, "gi");

  const textNodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current: Node | null;
  while ((current = walker.nextNode())) {
    const textNode = current as Text;
    if (shouldSearchTextNode(textNode)) textNodes.push(textNode);
  }

  const marks: HTMLElement[] = [];

  for (const textNode of textNodes) {
    const text = textNode.textContent ?? "";
    regex.lastIndex = 0;

    const parts: Array<string | HTMLElement> = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
      const mark = document.createElement("mark");
      mark.className = HIT_CLASS;
      mark.textContent = match[0];
      parts.push(mark);
      marks.push(mark);
      lastIndex = match.index + match[0].length;
    }

    if (parts.length === 0) continue;
    if (lastIndex < text.length) parts.push(text.slice(lastIndex));

    const parent = textNode.parentNode;
    if (!parent) continue;

    for (const part of parts) {
      parent.insertBefore(
        typeof part === "string" ? document.createTextNode(part) : part,
        textNode
      );
    }
    parent.removeChild(textNode);
  }

  if (marks.length === 0) return 0;

  const index = ((activeIndex % marks.length) + marks.length) % marks.length;
  marks[index].classList.add(ACTIVE_CLASS);
  marks[index].scrollIntoView({ behavior: "smooth", block: "center" });

  return marks.length;
}
