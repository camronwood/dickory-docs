#!/usr/bin/env node
/**
 * Headless Mermaid layout smoke test — mirrors src/utils/mermaidConfig.ts registration.
 * Usage: node scripts/test_mermaid_layouts.mjs [path/to/fixture.md]
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const fixturePath =
  process.argv[2] ?? resolve(root, "samples/mermaid-layouts.md");

const FENCE_RE = /```\s*mermaid\s*(?:\r?\n|\r)?([\s\S]*?)```\s*/gi;

function extractBlocks(md) {
  const blocks = [];
  let m;
  while ((m = FENCE_RE.exec(md)) !== null) {
    const body = m[1]?.trim();
    if (body) blocks.push(body);
  }
  return blocks;
}

function setupDom() {
  const window = new Window({ url: "http://localhost/" });
  const document = window.document;
  document.write("<!DOCTYPE html><html><body></body></html>");
  globalThis.window = window;
  globalThis.document = document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.SVGElement = window.SVGElement;
  globalThis.Node = window.Node;
  globalThis.DOMParser = window.DOMParser;
  globalThis.CSSStyleSheet = window.CSSStyleSheet;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  return window;
}

function layoutHint(content) {
  if (/defaultRenderer['"]?\s*:\s*['"]?elk/i.test(content)) return "elk-init";
  if (/layout:\s*elk/i.test(content)) return "elk-frontmatter";
  if (/^\s*flowchart-elk/m.test(content)) return "flowchart-elk";
  if (/layout:\s*tidy-tree/i.test(content)) return "tidy-tree";
  return "dagre-default";
}

async function main() {
  setupDom();

  const { default: mermaid } = await import("mermaid");
  const { default: elkLayouts } = await import("@mermaid-js/layout-elk");
  const { default: tidyTreeLayouts } = await import("@mermaid-js/layout-tidy-tree");

  mermaid.registerLayoutLoaders(elkLayouts);
  mermaid.registerLayoutLoaders(tidyTreeLayouts);
  mermaid.initialize({
    startOnLoad: false,
    theme: "dark",
    securityLevel: "antiscript",
    fontFamily: "ui-monospace, monospace",
  });

  const md = readFileSync(fixturePath, "utf8");
  const blocks = extractBlocks(md);
  if (blocks.length === 0) {
    console.error(`No mermaid fences in ${fixturePath}`);
    process.exit(1);
  }

  console.log(`Fixture: ${fixturePath}`);
  console.log(`Blocks:  ${blocks.length}\n`);

  let failed = 0;
  for (let i = 0; i < blocks.length; i++) {
    const content = blocks[i];
    const hint = layoutHint(content);
    const id = `test-mermaid-${i}`;
    try {
      const { svg } = await mermaid.render(id, content);
      const ok =
        typeof svg === "string" &&
        svg.includes("<svg") &&
        !/Syntax error in text/i.test(svg) &&
        svg.length > 200;
      if (ok) {
        console.log(`  OK  [${i}] ${hint} (${svg.length} bytes svg)`);
      } else {
        failed++;
        console.error(`  FAIL [${i}] ${hint} — svg too small or error markup`);
      }
    } catch (err) {
      failed++;
      console.error(`  FAIL [${i}] ${hint} — ${err?.message ?? err}`);
    }
    document.getElementById(`d${id}`)?.remove();
  }

  console.log();
  if (failed > 0) {
    console.error(`${failed}/${blocks.length} diagram(s) failed`);
    process.exit(1);
  }
  console.log(`All ${blocks.length} diagram(s) rendered.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
