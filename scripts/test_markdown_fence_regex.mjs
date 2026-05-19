#!/usr/bin/env node
/** Assert TS fence regex capture group matches Rust extractor semantics. */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = resolve(__dirname, "../samples/mermaid-layouts.md");
const RE = /```\s*mermaid\s*(?:\r?\n|\r)?([\s\S]*?)```\s*/gi;

const md = readFileSync(fixture, "utf8");
const blocks = [];
let m;
while ((m = RE.exec(md)) !== null) {
  const body = m[1]?.trim();
  if (!body) throw new Error(`empty block at index ${blocks.length}`);
  if (m[2] !== undefined) throw new Error("expected single capture group (use m[1], not m[2])");
  blocks.push(body);
}

const expected = 5;
if (blocks.length !== expected) {
  console.error(`Expected ${expected} blocks, got ${blocks.length}`);
  process.exit(1);
}

const hints = ["flowchart LR", "defaultRenderer", "elk.stress", "flowchart-elk", "tidy-tree"];
for (let i = 0; i < blocks.length; i++) {
  if (!hints.some((h) => blocks[i].includes(h))) {
    console.error(`Block ${i} missing expected content hint`);
    process.exit(1);
  }
}

console.log(`OK — ${blocks.length} mermaid blocks extracted via m[1]`);
