// Tab arrangement, duplication and MRU helpers (spec §4.2–4.3). Every operation resolves
// its source from the window's active tab at call time and stays inside that window.
import { t } from './i18n.js';

const NO_GROUP = -1;

function formatLinks(tabs, format) {
  if (format === 'markdown') {
    const lines = tabs.map(tab => `[${(tab.title || tab.url || '').replace(/[\[\]]/g, '\\$&')}](${tab.url})`);
    return tabs.length === 1 ? lines[0] : lines.map(line => `- ${line}`).join('\n');
  }
  return tabs.map(tab => tab.url).join('\n');
}

/** Tabs the active tab may swap with: same pinned state and same group, contiguous. */
export function movementRange(tabs, active) {
  const same = tab => tab.pinned === active.pinned && (tab.groupId ?? NO_GROUP) === (active.groupId ?? NO_GROUP);
  const sorted = [...tabs].sort((a, b) => a.index - b.index);
  const position = sorted.findIndex(tab => tab.id === active.id);
  let start = position;
  let end = position;
  while (start > 0 && same(sorted[start - 1])) start--;
  while (end < sorted.length - 1 && same(sorted[end + 1])) end++;
  return sorted.slice(start, end + 1);
}

export function createTabOps(api) {
  async function context(windowId) {
    const tabs = (await api.tabs.query({ windowId })).sort((a, b) => a.index - b.index);
    const active = tabs.find(tab => tab.active);
    if (!active) throw new Error(t('bg.error.noActiveTab'));
    return { tabs, active };
  }

  function recent(tabs, active) {
    return tabs.filter(tab => tab.id !== active.id)
      .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  }

  return {
    async previousTab(windowId) {
      const { tabs, active } = await context(windowId);
      const target = recent(tabs, active)[0];
      if (!target) return { status: 'noop', message: t('bg.tabs.noOther') };
      await api.tabs.update(target.id, { active: true });
      return { status: 'ok', tabId: target.id };
    },

    /** The neighbour in the tab strip, wrapping at either end so the gesture always does something. */
    async activateRelative(windowId, offset) {
      const { tabs, active } = await context(windowId);
      if (tabs.length <= 1) return { status: 'noop', message: t('bg.tabs.noOther') };
      const position = tabs.findIndex(tab => tab.id === active.id);
      const target = tabs[(position + offset + tabs.length) % tabs.length];
      await api.tabs.update(target.id, { active: true });
      return { status: 'ok', tabId: target.id };
    },

    async move(windowId, direction) {
      const { tabs, active } = await context(windowId);
      const range = movementRange(tabs, active);
      const position = range.findIndex(tab => tab.id === active.id);
      const targetIndex = {
        left: position > 0 ? active.index - 1 : active.index,
        right: position < range.length - 1 ? active.index + 1 : active.index,
        first: range[0].index,
        last: range[range.length - 1].index,
      }[direction];
      if (targetIndex === undefined) throw new Error(t('bg.error.invalidMove'));
      if (targetIndex === active.index) return { status: 'noop', message: t('bg.tabs.atEdge') };
      await api.tabs.move(active.id, { index: targetIndex });
      return { status: 'ok', index: targetIndex };
    },

    async moveToIndex(windowId, position) {
      const { tabs, active } = await context(windowId);
      if (!Number.isInteger(position)) throw new Error(t('bg.tabs.enterPosition'));
      const pinnedCount = tabs.filter(tab => tab.pinned).length;
      const min = active.pinned ? 1 : pinnedCount + 1;
      const max = active.pinned ? pinnedCount : tabs.length;
      const clamped = Math.min(Math.max(position, min), max);
      if (clamped - 1 === active.index) return { status: 'noop', message: t('bg.tabs.atPosition') };
      await api.tabs.move(active.id, { index: clamped - 1 });
      return { status: 'ok', index: clamped - 1 };
    },

    async newWindow(windowId, scope) {
      const { tabs, active } = await context(windowId);
      const selected = scope === 'current' ? [active]
        : scope === 'with-left' ? tabs.filter(tab => tab.index <= active.index)
          : scope === 'with-right' ? tabs.filter(tab => tab.index >= active.index) : null;
      if (!selected) throw new Error(t('bg.error.invalidScope'));
      if (selected.length === tabs.length) return { status: 'noop', message: t('bg.tabs.wholeWindow') };
      const groupIds = [...new Set(selected.map(tab => tab.groupId ?? NO_GROUP).filter(id => id !== NO_GROUP))];
      const groups = new Map();
      for (const id of groupIds) groups.set(id, api.tabGroups ? await api.tabGroups.get(id).catch(() => null) : null);
      const created = await api.windows.create({ tabId: selected[0].id, focused: true });
      const rest = selected.slice(1).map(tab => tab.id);
      if (rest.length) await api.tabs.move(rest, { windowId: created.id, index: -1 });
      for (const tab of selected.filter(tab => tab.pinned)) await api.tabs.update(tab.id, { pinned: true });
      if (api.tabGroups) {
        for (const [groupId, info] of groups) {
          const members = selected.filter(tab => tab.groupId === groupId).map(tab => tab.id);
          const newGroup = await api.tabs.group({ tabIds: members, createProperties: { windowId: created.id } });
          if (info) await api.tabGroups.update(newGroup, { title: info.title ?? '', color: info.color });
        }
      }
      await api.tabs.update(active.id, { active: true });
      return { status: 'ok', movedCount: selected.length, windowId: created.id };
    },

    async duplicate(windowId) {
      const { active } = await context(windowId);
      const copy = await api.tabs.duplicate(active.id);
      if (copy && !copy.active) await api.tabs.update(copy.id, { active: true });
      return { status: 'ok', tabId: copy?.id };
    },

    async copyLinks(windowId, format) {
      const { tabs, active } = await context(windowId);
      const highlighted = tabs.filter(tab => tab.highlighted);
      const chosen = (highlighted.length > 1 ? highlighted : [active]).filter(tab => tab.url);
      if (!chosen.length) return { status: 'noop', message: t('bg.links.none') };
      return { status: 'ok', text: formatLinks(chosen, format), count: chosen.length };
    },
  };
}
