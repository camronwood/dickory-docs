import assert from "node:assert/strict";
import {
  isSafeExternalHref,
  resolveMarkdownLinkAction,
} from "../src/utils/markdownLinks.ts";

assert.equal(isSafeExternalHref("https://example.com/doc"), true);
assert.equal(isSafeExternalHref("http://localhost:5177"), true);
assert.equal(isSafeExternalHref("mailto:a@b.co"), true);
assert.equal(isSafeExternalHref("javascript:alert(1)"), false);
assert.equal(isSafeExternalHref("file:///etc/passwd"), false);
assert.equal(isSafeExternalHref("data:text/html,<script>"), false);
assert.equal(isSafeExternalHref("//evil.com"), false);

const ext = resolveMarkdownLinkAction("javascript:alert(1)", "docs/a.md");
assert.equal(ext, null, "unsafe external href ignored");

const ok = resolveMarkdownLinkAction("https://example.com", "docs/a.md");
assert.equal(ok?.type, "external");

console.log("safeExternalUrl: ok");
