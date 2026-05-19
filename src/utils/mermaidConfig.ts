import mermaid from "mermaid";
import elkLayouts from "@mermaid-js/layout-elk";
import tidyTreeLayouts from "@mermaid-js/layout-tidy-tree";

mermaid.registerLayoutLoaders(elkLayouts);
mermaid.registerLayoutLoaders(tidyTreeLayouts);

mermaid.initialize({
  startOnLoad: false,
  theme: "dark",
  securityLevel: "loose",
  fontFamily: "ui-monospace, monospace",
});

let renderCounter = 0;

let renderQueue: Promise<string> = Promise.resolve("");

export function renderMermaidSvg(content: string): Promise<string> {
  renderQueue = renderQueue
    .catch(() => {})
    .then(async () => {
      const id = `mermaid-${++renderCounter}-${Math.random().toString(36).slice(2, 7)}`;
      document.getElementById("d" + id)?.remove();
      const { svg } = await mermaid.render(id, content);
      return svg;
    });
  return renderQueue;
}

export default mermaid;
