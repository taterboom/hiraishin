import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_HISTORY_ENTRIES,
  createHistory,
  findTarget,
  moveCursor,
  normalizeHistory,
  pruneHistory,
  recordVisit,
  replaceTab,
} from "../src/history.js";

const visited = (...tabIds) => tabIds.reduce(recordVisit, createHistory());

test("histories start empty and remain independent between windows", () => {
  const firstWindow = createHistory();
  const secondWindow = createHistory();
  assert.deepEqual(recordVisit(firstWindow, 1), { entries: [1], cursor: 0 });
  assert.deepEqual(firstWindow, { entries: [], cursor: -1 });
  assert.deepEqual(secondWindow, { entries: [], cursor: -1 });
  assert.equal(findTarget(secondWindow, -1, 1), null);
});

test("activation history retains nonadjacent repeated tabs", () => {
  const state = visited(1, 2, 1, 1, 3);
  assert.deepEqual(state, { entries: [1, 2, 1, 3], cursor: 3 });
  assert.deepEqual(findTarget(state, -1, 3), { tabId: 1, cursor: 2 });
});

test("back and forward move through visits without adding or reordering them", () => {
  const original = visited(1, 2, 1, 3);
  const firstTarget = findTarget(original, -1, 3);
  const backOnce = moveCursor(original, firstTarget.cursor);
  const secondTarget = findTarget(backOnce, -1, firstTarget.tabId);
  const backTwice = moveCursor(backOnce, secondTarget.cursor);
  assert.deepEqual(backTwice, { entries: [1, 2, 1, 3], cursor: 1 });
  assert.deepEqual(findTarget(backTwice, 1, 2), { tabId: 1, cursor: 2 });
  assert.deepEqual(original, { entries: [1, 2, 1, 3], cursor: 3 });
});

test("a manual activation after going back discards only the forward branch", () => {
  const back = moveCursor(visited(1, 2, 3, 4), 1);
  assert.deepEqual(recordVisit(back, 5), { entries: [1, 2, 5], cursor: 2 });
  assert.deepEqual(recordVisit(back, 3), { entries: [1, 2, 3], cursor: 2 });
  assert.deepEqual(recordVisit(back, 2), back);
});

test("navigation stops at boundaries and rejects unsupported directions", () => {
  const state = visited(1, 2, 3);
  assert.equal(findTarget(state, 1, 3), null);
  assert.equal(findTarget(moveCursor(state, 0), -1, 1), null);
  assert.equal(findTarget(state, 0, 3), null);
  assert.equal(findTarget(state, 2, 3), null);
});

test("navigation skips entries equal to the currently active tab", () => {
  const state = { entries: [1, 2, 2, 2, 3], cursor: 3 };
  assert.deepEqual(findTarget(state, -1, 2), { tabId: 1, cursor: 0 });
  assert.deepEqual(findTarget({ ...state, cursor: 1 }, 1, 2), {
    tabId: 3,
    cursor: 4,
  });
  assert.equal(findTarget({ entries: [2, 2], cursor: 1 }, -1, 2), null);
});

test("closed tabs are removed from past and forward visits before navigation", () => {
  const state = moveCursor(visited(1, 2, 3, 2, 4, 5), 2);
  const pruned = pruneHistory(state, [1, 3, 5]);
  assert.deepEqual(pruned, { entries: [1, 3, 5], cursor: 1 });
  assert.deepEqual(findTarget(pruned, -1, 3), { tabId: 1, cursor: 0 });
  assert.deepEqual(findTarget(pruned, 1, 3), { tabId: 5, cursor: 2 });
  assert.deepEqual(state, { entries: [1, 2, 3, 2, 4, 5], cursor: 2 });
});

test("closing the cursor tab falls back to its nearest surviving predecessor", () => {
  const state = moveCursor(visited(1, 2, 3, 4), 2);
  assert.deepEqual(pruneHistory(state, [1, 2, 4]), {
    entries: [1, 2, 4],
    cursor: 1,
  });
  assert.deepEqual(pruneHistory(state, [4]), { entries: [4], cursor: 0 });
  assert.deepEqual(pruneHistory(state, []), createHistory());
});

test("history caps visits and keeps the cursor on the most recent visit", () => {
  const ids = Array.from({ length: MAX_HISTORY_ENTRIES + 37 }, (_, index) => index);
  const state = visited(...ids);
  assert.deepEqual(state.entries, ids.slice(37));
  assert.equal(state.cursor, MAX_HISTORY_ENTRIES - 1);
});

test("replaced Chrome tab IDs retain all occurrences and cursor position", () => {
  const state = moveCursor(visited(1, 2, 1, 3), 1);
  assert.deepEqual(replaceTab(state, 1, 9), {
    entries: [9, 2, 9, 3],
    cursor: 1,
  });
  assert.deepEqual(state, { entries: [1, 2, 1, 3], cursor: 1 });
  assert.deepEqual(replaceTab(state, 1, -1), state);
});

test("restored history ignores malformed entries while preserving its position", () => {
  const corrupted = { entries: [1, "2", 3, -1, 4, null, 5], cursor: 4 };
  assert.deepEqual(normalizeHistory(corrupted), {
    entries: [1, 3, 4, 5],
    cursor: 2,
  });
  assert.deepEqual(normalizeHistory({ entries: [1, null, 3], cursor: 1 }), {
    entries: [1, 3],
    cursor: 0,
  });
  assert.deepEqual(normalizeHistory({ entries: [null, 3], cursor: 0 }), {
    entries: [3],
    cursor: 0,
  });
});

test("restored cursor is repaired and oversized saved histories are bounded", () => {
  assert.deepEqual(normalizeHistory({ entries: [1, 2], cursor: "oops" }), {
    entries: [1, 2],
    cursor: 1,
  });
  assert.equal(normalizeHistory({ entries: [1, 2], cursor: 99 }).cursor, 1);
  assert.equal(normalizeHistory({ entries: [1, 2], cursor: -99 }).cursor, 0);
  const entries = Array.from({ length: 250 }, (_, index) => index);
  assert.deepEqual(normalizeHistory({ entries, cursor: 75 }), {
    entries: entries.slice(50),
    cursor: 25,
  });
  assert.equal(normalizeHistory({ entries, cursor: 1 }).cursor, 0);
});

test("empty and entirely corrupt saved state resets safely", () => {
  for (const value of [null, undefined, false, [], {}, { entries: "bad" },
    { entries: [], cursor: 4 }, { entries: [null, -1, NaN, Infinity, 2.5] }]) {
    assert.deepEqual(normalizeHistory(value), createHistory());
  }
  assert.deepEqual(recordVisit(createHistory(), -1), createHistory());
});

test("moving to an invalid cursor leaves the valid history unchanged", () => {
  const state = visited(1, 2, 3);
  for (const cursor of [-1, 3, 1.5, undefined, NaN]) {
    assert.deepEqual(moveCursor(state, cursor), state);
  }
  assert.deepEqual(moveCursor(createHistory(), 0), createHistory());
});

test("history operations return detached state without mutating caller input", () => {
  const state = Object.freeze({ entries: Object.freeze([1, 2, 3]), cursor: 1 });
  for (const next of [normalizeHistory(state), recordVisit(state, 2),
    moveCursor(state, 0), pruneHistory(state, [1, 2, 3]), replaceTab(state, 8, 9)]) {
    assert.notEqual(next, state);
    assert.notEqual(next.entries, state.entries);
  }
});
