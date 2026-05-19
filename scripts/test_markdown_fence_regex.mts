#!/usr/bin/env node
/** Assert mermaidDetect matches Rust extractor semantics. */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractMermaidBlocksFromText } from "../src/utils/mermaidDetect.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function assertCount(
  label: string,
  content: string,
  filePath: string | undefined,
  expected: number
) {
  const blocks = extractMermaidBlocksFromText(content, filePath).map((b) => b.content);
  if (blocks.length !== expected) {
    console.error(`${label}: expected ${expected} blocks, got ${blocks.length}`);
    blocks.forEach((b, i) => console.error(`  [${i}] ${b.slice(0, 60)}...`));
    process.exit(1);
  }
  return blocks;
}

const layouts = readFileSync(resolve(root, "samples/mermaid-layouts.md"), "utf8");
const layoutBlocks = assertCount("mermaid-layouts.md", layouts, undefined, 5);
const hints = ["flowchart LR", "defaultRenderer", "elk.stress", "flowchart-elk", "tidy-tree"];
for (let i = 0; i < layoutBlocks.length; i++) {
  if (!hints.some((h) => layoutBlocks[i]!.includes(h))) {
    console.error(`Block ${i} missing expected content hint`);
    process.exit(1);
  }
}

const untagged = readFileSync(resolve(root, "samples/untagged-mermaid.md"), "utf8");
const untaggedBlocks = assertCount("untagged-mermaid.md", untagged, undefined, 2);
if (!untaggedBlocks[0]!.includes("graph LR")) {
  console.error("untagged block should contain graph LR");
  process.exit(1);
}
if (!untaggedBlocks[1]!.includes("flowchart TD")) {
  console.error("tagged block should contain flowchart TD");
  process.exit(1);
}

const mmd = readFileSync(resolve(root, "samples/connor-flow.mmd"), "utf8");
const mmdBlocks = assertCount("connor-flow.mmd", mmd, "samples/connor-flow.mmd", 1);
if (!mmdBlocks[0]!.includes("graph LR")) {
  console.error(".mmd file should be whole-file diagram");
  process.exit(1);
}

const pythonReject = assertCount("python fence", "```python\ngraph TD\n  x = 1\n```", undefined, 0);

console.log(
  `OK — layouts=${layoutBlocks.length} untagged=${untaggedBlocks.length} mmd=${mmdBlocks.length} python_reject=${pythonReject.length}`
);
