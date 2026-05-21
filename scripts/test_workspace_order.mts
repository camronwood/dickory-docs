import assert from "node:assert/strict";
import {
  TAB_BAR_MAX,
  filterWorkspacesForSwitcher,
  sortWorkspacesByLastUsed,
  workspacesForTabBar,
} from "../src/utils/workspaceOrder.ts";
import type { Workspace } from "../src/stores/fileExplorerStore.ts";

function ws(
  id: string,
  name: string,
  lastUsed: string,
  extra: Partial<Workspace> = {}
): Workspace {
  return {
    id,
    name,
    path: `/tmp/${name}`,
    created_at: "",
    last_used: lastUsed,
    is_git_repo: false,
    ...extra,
  };
}

const a = ws("a", "alpha", "2026-01-01T00:00:00Z");
const b = ws("b", "beta", "2026-06-01T00:00:00Z");
const c = ws("c", "gamma", "2026-03-01T00:00:00Z");
const d = ws("d", "delta", "2026-02-01T00:00:00Z");
const e = ws("e", "epsilon", "2026-04-01T00:00:00Z");
const f = ws("f", "zeta", "2026-05-01T00:00:00Z");

const sorted = sortWorkspacesByLastUsed([a, b, c, d, e, f]);
assert.equal(sorted[0].id, "b");
assert.equal(sorted[sorted.length - 1].id, "a");

const barFew = workspacesForTabBar([a, b, c], "b");
assert.equal(barFew.visible.length, 3);
assert.equal(barFew.overflowCount, 0);

const barMany = workspacesForTabBar([a, b, c, d, e, f], "a", TAB_BAR_MAX);
assert.equal(barMany.visible[0].id, "a", "active first");
assert.equal(barMany.visible.length, TAB_BAR_MAX);
assert.equal(barMany.overflowCount, 1);

const barNoActive = workspacesForTabBar([a, b, c, d, e], null, 3);
assert.equal(barNoActive.visible.length, 3);
assert.equal(barNoActive.overflowCount, 2);

const filtered = filterWorkspacesForSwitcher(
  [ws("1", "docs", "2026-01-01T00:00:00Z", { git_branch: "main" })],
  "main"
);
assert.equal(filtered.length, 1);

const filteredPath = filterWorkspacesForSwitcher([a, b], "tmp/beta");
assert.equal(filteredPath.length, 1);
assert.equal(filteredPath[0].id, "b");

const exactlyMax = workspacesForTabBar([a, b, c, d, e], "c", TAB_BAR_MAX);
assert.equal(exactlyMax.visible.length, TAB_BAR_MAX);
assert.equal(exactlyMax.overflowCount, 0, "5 workspaces fit in bar");

const invalidLastUsed = sortWorkspacesByLastUsed([
  ws("x", "bad-date", "not-a-date"),
  ws("y", "good", "2026-06-01T00:00:00Z"),
]);
assert.equal(invalidLastUsed[0].id, "y", "invalid last_used sorts last");

const emptyFilter = filterWorkspacesForSwitcher([a, b], "   ");
assert.equal(emptyFilter.length, 2, "whitespace query shows all");

console.log("workspaceOrder: ok");
