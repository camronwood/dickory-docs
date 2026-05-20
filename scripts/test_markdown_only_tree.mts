import assert from "node:assert/strict";
import { buildMarkdownOnlyTree } from "../src/utils/markdownOnlyTree.ts";

const flat = [
  { name: "a.md", path: "docs/a.md", is_dir: false, size: 1, mod_time: "" },
  { name: "b.mmd", path: "diagrams/b.mmd", is_dir: false, size: 2, mod_time: "" },
  { name: "c.mdx", path: "docs/nested/c.mdx", is_dir: false, size: 3, mod_time: "" },
];

const tree = buildMarkdownOnlyTree(flat);
assert.equal(tree.length, 2, "root: docs + diagrams");

const docs = tree.find((n) => n.name === "docs");
assert.ok(docs?.is_dir && docs.children?.length === 2, "docs has a.md + nested/");
assert.ok(docs.children?.some((n) => n.name === "a.md"), "a.md present");
const nested = docs.children?.find((n) => n.name === "nested");
assert.ok(nested?.children?.some((n) => n.name === "c.mdx"), "nested/c.mdx");

const diagrams = tree.find((n) => n.name === "diagrams");
assert.ok(diagrams?.children?.some((n) => n.name === "b.mmd"), ".mmd in tree");

const empty = buildMarkdownOnlyTree([]);
assert.deepEqual(empty, []);

console.log("markdownOnlyTree: ok");
