import assert from "node:assert/strict";
import { Window } from "happy-dom";
import {
  ACTIVE_WORKSPACE_STORAGE_KEY,
  clearActiveWorkspaceId,
  loadActiveWorkspaceId,
  saveActiveWorkspaceId,
} from "../src/config/activeWorkspacePreference.ts";

const window = new Window();
const g = globalThis as typeof globalThis & { localStorage?: Storage };
g.localStorage = window.localStorage;

saveActiveWorkspaceId("ws-abc");
assert.equal(loadActiveWorkspaceId(), "ws-abc");
assert.equal(window.localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY), "ws-abc");

clearActiveWorkspaceId();
assert.equal(loadActiveWorkspaceId(), null);

console.log("activeWorkspacePreference: ok");
