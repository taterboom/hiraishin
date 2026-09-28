/** Maximum number of tab activations retained for each window. */
export const MAX_HISTORY_ENTRIES = 200;

const isTabId = (value) => Number.isSafeInteger(value) && value >= 0;

export function createHistory() {
  return { entries: [], cursor: -1 };
}

/**
 * Restore a history from storage without trusting the saved shape. A removed
 * cursor entry falls back to its closest surviving predecessor, then successor.
 */
export function normalizeHistory(value) {
  if (!value || !Array.isArray(value.entries) || value.entries.length === 0) {
    return createHistory();
  }

  const sourceCursor = Number.isInteger(value.cursor)
    ? Math.min(Math.max(value.cursor, 0), value.entries.length - 1)
    : value.entries.length - 1;
  const entries = [];
  let cursor = -1;

  value.entries.forEach((tabId, index) => {
    if (!isTabId(tabId)) return;
    entries.push(tabId);
    if (index <= sourceCursor) cursor = entries.length - 1;
  });

  if (entries.length === 0) return createHistory();

  const trimCount = Math.max(0, entries.length - MAX_HISTORY_ENTRIES);
  return {
    entries: entries.slice(trimCount),
    cursor: Math.max(0, cursor - trimCount),
  };
}

/** Record an ordinary activation, replacing any abandoned forward branch. */
export function recordVisit(history, tabId) {
  const state = normalizeHistory(history);
  if (!isTabId(tabId) || state.entries[state.cursor] === tabId) return state;

  const entries = [...state.entries.slice(0, state.cursor + 1), tabId].slice(
    -MAX_HISTORY_ENTRIES,
  );
  return { entries, cursor: entries.length - 1 };
}

/** Remove closed or moved-away tabs while retaining the logical cursor. */
export function pruneHistory(history, validIds) {
  const state = normalizeHistory(history);
  const valid = new Set(validIds);
  const entries = [];
  let cursor = -1;

  state.entries.forEach((tabId, index) => {
    if (!valid.has(tabId)) return;
    entries.push(tabId);
    if (index <= state.cursor) cursor = entries.length - 1;
  });

  return entries.length > 0
    ? { entries, cursor: Math.max(0, cursor) }
    : createHistory();
}

/** Find the next distinct tab without wrapping or mutating the history. */
export function findTarget(history, direction, currentTabId) {
  if (direction !== -1 && direction !== 1) return null;
  const state = normalizeHistory(history);

  for (
    let cursor = state.cursor + direction;
    cursor >= 0 && cursor < state.entries.length;
    cursor += direction
  ) {
    const tabId = state.entries[cursor];
    if (tabId !== currentTabId) return { tabId, cursor };
  }

  return null;
}

/** Move after a successful history navigation; no activation is appended. */
export function moveCursor(history, cursor) {
  const state = normalizeHistory(history);
  if (!Number.isInteger(cursor) || cursor < 0 || cursor >= state.entries.length) {
    return state;
  }
  return { entries: state.entries, cursor };
}

/** Chrome can replace a tab's ID while preserving the tab itself. */
export function replaceTab(history, oldId, newId) {
  const state = normalizeHistory(history);
  if (!isTabId(oldId) || !isTabId(newId)) return state;
  return {
    entries: state.entries.map((tabId) => (tabId === oldId ? newId : tabId)),
    cursor: state.cursor,
  };
}
