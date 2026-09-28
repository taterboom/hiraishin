// Minimal Chrome API model for tests. It keeps tab order per window, moves and creates tabs,
// records side effects, and can defer activation events like the real browser does.
import assert from 'node:assert/strict';

const clone = value => structuredClone(value);
export const tab = (id, windowId, index, active = false, extra = {}) => ({
  id, windowId, index, active, pinned: false, highlighted: active, groupId: -1, status: 'complete',
  title: `Tab ${id}`, url: `https://example.com/${id}`, lastAccessed: 0, ...extra,
});

export function createFakeChrome({
  tabs = [tab(1, 1, 0, true), tab(2, 1, 1), tab(3, 1, 2)], activationMode = 'sync', session = {}, local = {},
  granted = false, platform = 'win', nativeCommands = [], groups = {}, pingReply = null,
} = {}) {
  const data = {
    tabs: clone(tabs), session: clone(session), local: clone(local), platform, nativeCommands: clone(nativeCommands),
    grantedOrigins: new Set(granted ? ['http://*/*', 'https://*/*'] : []),
    groups: new Map(Object.entries(groups).map(([id, info]) => [Number(id), info])), nextGroupId: 100,
    nextTabId: Math.max(0, ...tabs.map(item => item.id)) + 1, nextWindowId: Math.max(0, ...tabs.map(item => item.windowId)) + 1,
    removed: [], updates: [], moves: [], created: [], notifications: [], menus: [], alarms: new Map(), scripts: new Map(),
    executed: [], messages: [], lastFocusedWindow: tabs[0]?.windowId ?? 1, pingReply,
    beforeGet: null, beforeUpdate: null, registerError: null, executeError: null,
    selectionText: '', adapter: null, onActivated: null, runtimeReply: { ok: true }, offscreenOpen: false,
  };
  const events = [];
  const deferred = [];

  function reindex(windowId) {
    data.tabs.filter(item => item.windowId === windowId).sort((a, b) => a.index - b.index).forEach((item, index) => { item.index = index; });
  }
  function emitActivation(info) {
    const fire = () => { if (data.onActivated) events.push(data.onActivated(info)); };
    if (activationMode === 'deferred') deferred.push(fire);
    else if (activationMode === 'microtask') queueMicrotask(fire);
    else fire();
  }
  function setActive(id) {
    const target = data.tabs.find(item => item.id === id);
    if (!target) throw new Error(`No tab with id: ${id}`);
    for (const item of data.tabs) if (item.windowId === target.windowId) { item.active = item.id === id; item.highlighted = item.active; }
    target.lastAccessed = Date.now() + data.updates.length;
    return target;
  }
  function find(id) {
    const found = data.tabs.find(item => item.id === id);
    if (!found) throw new Error(`No tab with id: ${id}`);
    return found;
  }
  function ensureActive(windowId) {
    const siblings = data.tabs.filter(other => other.windowId === windowId).sort((a, b) => a.index - b.index);
    if (siblings.length && !siblings.some(other => other.active)) { siblings[siblings.length - 1].active = true; siblings[siblings.length - 1].highlighted = true; }
  }
  function insertAt(item, windowId, index) {
    const siblings = data.tabs.filter(other => other.windowId === windowId && other.id !== item.id).sort((a, b) => a.index - b.index);
    const position = index < 0 || index > siblings.length ? siblings.length : index;
    siblings.splice(position, 0, item);
    item.windowId = windowId;
    siblings.forEach((other, position) => { other.index = position; });
  }
  const storageArea = key => ({
    get: async name => {
      if (name === undefined || name === null) return clone(data[key]);
      const names = Array.isArray(name) ? name : [name];
      return Object.fromEntries(names.filter(item => item in data[key]).map(item => [item, clone(data[key][item])]));
    },
    set: async values => { Object.assign(data[key], clone(values)); },
    remove: async names => { for (const name of [].concat(names)) delete data[key][name]; },
  });
  const matchesUrl = (url, patterns) => patterns.some(pattern => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`).test(url));

  const api = {
    runtime: {
      id: 'ext', lastError: undefined,
      getPlatformInfo: async () => ({ os: data.platform }),
      getManifest: () => ({ commands: {
        'history-back': { suggested_key: { default: 'Ctrl+Comma', mac: 'MacCtrl+Comma' } },
        'history-forward': { suggested_key: { default: 'Ctrl+Period', mac: 'MacCtrl+Period' } },
      } }),
      getURL: path => `chrome-extension://ext/${path}`,
      sendMessage: async message => { data.messages.push(clone(message)); return clone(data.runtimeReply); },
      openOptionsPage: async () => {},
    },
    storage: { session: storageArea('session'), local: storageArea('local'), onChanged: { addListener() {} } },
    tabs: {
      query: async (query = {}) => clone(data.tabs.filter(item =>
        (query.windowId === undefined || item.windowId === query.windowId)
        && (!query.lastFocusedWindow || item.windowId === data.lastFocusedWindow)
        && (query.active === undefined || item.active === query.active)
        && (query.highlighted === undefined || item.highlighted === query.highlighted)
        && (query.url === undefined || matchesUrl(item.url, [].concat(query.url))))
        .sort((a, b) => a.windowId - b.windowId || a.index - b.index)),
      get: async id => { if (data.beforeGet) await data.beforeGet(id); return clone(find(id)); },
      update: async (id, changes) => {
        if (data.beforeUpdate) await data.beforeUpdate(id, changes);
        const found = find(id);
        data.updates.push(id);
        if (changes.pinned !== undefined) found.pinned = changes.pinned;
        if (changes.active) { const target = setActive(id); emitActivation({ tabId: id, windowId: target.windowId }); }
        return clone(found);
      },
      remove: async id => {
        const found = find(id);
        data.removed.push(id);
        data.tabs = data.tabs.filter(item => item.id !== id);
        reindex(found.windowId);
        if (data.onRemoved) events.push(data.onRemoved(id, found.windowId));
      },
      move: async (ids, { index, windowId }) => {
        const list = [].concat(ids);
        data.moves.push({ ids: list, index, windowId });
        for (const id of list) {
          const item = find(id);
          const oldWindow = item.windowId;
          const target = windowId ?? oldWindow;
          data.tabs = data.tabs.filter(other => other.id !== id);
          reindex(oldWindow);
          data.tabs.push(item);
          insertAt(item, target, index);
          if (target !== oldWindow) { item.active = false; item.highlighted = false; ensureActive(oldWindow); }
        }
        return list.length === 1 ? clone(find(list[0])) : list.map(id => clone(find(id)));
      },
      create: async ({ windowId, url, index = -1, active = true }) => {
        const item = tab(data.nextTabId++, windowId ?? data.lastFocusedWindow, 0, false, { url, title: url, status: 'complete' });
        data.tabs.push(item);
        insertAt(item, item.windowId, index);
        data.created.push(clone(item));
        if (active) { setActive(item.id); emitActivation({ tabId: item.id, windowId: item.windowId }); }
        return clone(item);
      },
      duplicate: async id => {
        const source = find(id);
        const copy = { ...clone(source), id: data.nextTabId++, active: false, highlighted: false };
        data.tabs.push(copy);
        insertAt(copy, source.windowId, source.index + 1);
        setActive(copy.id);
        emitActivation({ tabId: copy.id, windowId: copy.windowId });
        return clone(copy);
      },
      group: async ({ tabIds, createProperties }) => {
        const groupId = data.nextGroupId++;
        for (const id of tabIds) { const item = find(id); item.groupId = groupId; if (createProperties?.windowId !== undefined) assert.equal(item.windowId, createProperties.windowId); }
        data.groups.set(groupId, { title: '', color: 'grey' });
        return groupId;
      },
      sendMessage: async (tabId, message) => {
        if (data.pingReply === null) throw new Error('Could not establish connection');
        return typeof data.pingReply === 'function' ? data.pingReply(tabId, message) : clone(data.pingReply);
      },
    },
    tabGroups: {
      get: async id => { if (!data.groups.has(id)) throw new Error(`No group ${id}`); return clone(data.groups.get(id)); },
      update: async (id, props) => { data.groups.set(id, { ...data.groups.get(id), ...props }); return clone(data.groups.get(id)); },
    },
    windows: {
      create: async ({ tabId }) => {
        const id = data.nextWindowId++;
        const item = find(tabId);
        const oldWindow = item.windowId;
        data.tabs = data.tabs.filter(other => other.id !== tabId);
        reindex(oldWindow);
        data.tabs.push(item);
        insertAt(item, id, 0);
        setActive(tabId);
        ensureActive(oldWindow);
        return { id };
      },
    },
    commands: { getAll: async () => clone(data.nativeCommands) },
    permissions: {
      contains: async ({ origins = [] }) => origins.every(origin => data.grantedOrigins.has(origin)
        || (data.grantedOrigins.has('https://*/*') && origin.startsWith('https://'))
        || (data.grantedOrigins.has('http://*/*') && origin.startsWith('http://'))),
      request: async ({ origins = [] }) => { for (const origin of origins) data.grantedOrigins.add(origin); return true; },
      remove: async ({ origins = [] }) => { for (const origin of origins) data.grantedOrigins.delete(origin); return true; },
    },
    scripting: {
      getRegisteredContentScripts: async ({ ids }) => clone(ids.flatMap(id => (data.scripts.has(id) ? [data.scripts.get(id)] : []))),
      registerContentScripts: async registrations => {
        if (data.registerError) throw data.registerError;
        for (const script of registrations) data.scripts.set(script.id, clone(script));
      },
      unregisterContentScripts: async ({ ids }) => { for (const id of ids) data.scripts.delete(id); },
      updateContentScripts: async updates => {
        for (const update of updates) {
          if (!data.scripts.has(update.id)) throw new Error(`No script with id ${update.id}`);
          data.scripts.set(update.id, { ...data.scripts.get(update.id), ...clone(update) });
        }
      },
      executeScript: async ({ target, files, func, args = [] }) => {
        data.executed.push({ target: clone(target), files: files ?? null, op: args[0] ?? (func ? 'selection' : null) });
        if (data.executeError) throw data.executeError;
        find(target.tabId);
        if (files) return [{ frameId: 0, result: null }];
        if (args.length) return [{ frameId: 0, result: data.adapter ? await data.adapter(args[0], args[1], target.tabId) : null }];
        return [{ frameId: 0, result: data.selectionText }];
      },
    },
    contextMenus: {
      removeAll: callback => { data.menus = []; callback?.(); },
      create: (props, callback) => { data.menus.push(clone(props)); callback?.(); return props.id; },
    },
    notifications: { create: async (id, options) => { data.notifications.push({ id, ...clone(options) }); return id; } },
    alarms: {
      create: async (name, info) => { data.alarms.set(name, clone(info)); },
      clear: async name => data.alarms.delete(name),
    },
    offscreen: {
      hasDocument: async () => data.offscreenOpen,
      createDocument: async () => { data.offscreenOpen = true; },
      closeDocument: async () => { data.offscreenOpen = false; },
    },
  };

  return {
    api, data, events,
    setActive,
    flushEvents: async () => {
      for (const fire of deferred.splice(0)) fire();
      await Promise.resolve();
      while (events.length) await Promise.all(events.splice(0));
    },
    active: windowId => data.tabs.find(item => item.windowId === windowId && item.active)?.id,
    order: windowId => data.tabs.filter(item => item.windowId === windowId).sort((a, b) => a.index - b.index).map(item => item.id),
  };
}
