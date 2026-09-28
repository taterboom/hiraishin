// Composition root for the service worker: per-window history with an ordered queue,
// the action dispatcher shared by every entry point, and message routing with the
// content-script boundary (spec §6.6, §8).
import { createHistory, normalizeHistory, recordVisit, pruneHistory, findTarget, moveCursor, replaceTab } from './history.js';
import { createSettingsStore, SETTINGS_KEY, PAGE_ORIGINS } from './settings.js';
import { listActions, getAction, COMMAND_IDS } from './actions.js';
import { createTabOps } from './tab-ops.js';
import { createTargetService, resolveTargets, supports, targetMonogram } from './targets.js';
import { createShortcutService } from './shortcuts.js';
import { createSelectionReader } from './selection.js';
import { createTransfer } from './transfer.js';
import { createNotifier } from './notify.js';
import { normalizeNative } from './keys.js';
import { normalizeSettings } from './settings.js';
import { createUsageStore } from './usage.js';

export const HISTORY_KEY = 'tabHistory';
export { SETTINGS_KEY, PAGE_ORIGINS, COMMAND_IDS };
const MENU_ROOT = 'hiraishin-root';
const ACTIVATION_MARKER_TTL = 10000;

export function createController(api) {
  let histories = null;
  let tail = Promise.resolve();
  const expectedActivations = new Map();
  const bufferedActivations = new Map();
  // One short-lived, single-use close preview per source tab. A wheel gesture only prepares it.
  const overlayClosures = new Map();
  const popupClosures = new Map();

  const settingsStore = createSettingsStore(api);
  const tabOps = createTabOps(api);
  const targets = createTargetService(api);
  const shortcuts = createShortcutService(api, { settingsStore, listActionsFor: listActions });
  const readSelection = createSelectionReader(api);
  const transfer = createTransfer(api, { targets, settingsStore, readSelection });
  const notify = createNotifier(api);
  const usage = createUsageStore(api);
  // Counting is best-effort: a storage failure must never prevent the requested operation.
  const countAction = (id, origin) => usage.record(id, origin).catch(error => console.warn('[Hiraishin usage]', error));

  // ---------------------------------------------------------------- history core

  async function persist() {
    await api.storage.session.set({ [HISTORY_KEY]: { version: 1, windows: histories } });
  }

  async function initialize() {
    if (histories) return;
    const [saved, tabs] = await Promise.all([api.storage.session.get(HISTORY_KEY), api.tabs.query({})]);
    const restored = saved[HISTORY_KEY]?.version === 1 ? saved[HISTORY_KEY].windows : {};
    histories = {};
    for (const windowId of new Set(tabs.map(tab => tab.windowId))) {
      const windowTabs = tabs.filter(tab => tab.windowId === windowId);
      let history = pruneHistory(normalizeHistory(restored?.[windowId]), windowTabs.map(tab => tab.id));
      const active = windowTabs.find(tab => tab.active);
      // Events buffered while storage/query resolves already provide the ordered visits.
      if (active && !bufferedActivations.get(windowId)) history = recordVisit(history, active.id);
      histories[windowId] = history;
    }
    await persist();
  }

  function enqueue(task) {
    const result = tail.then(async () => { await initialize(); return task(); });
    tail = result.catch(() => {});
    return result;
  }

  async function windowContext(windowId) {
    const query = Number.isInteger(windowId) && windowId >= 0 ? { windowId } : { lastFocusedWindow: true };
    const tabs = await api.tabs.query(query);
    const active = tabs.find(tab => tab.active);
    if (!active) throw new Error('当前窗口没有可操作的标签页。');
    const id = active.windowId;
    let history = pruneHistory(histories[id] ?? createHistory(), tabs.map(tab => tab.id));
    if (history.entries[history.cursor] !== active.id) history = recordVisit(history, active.id);
    histories[id] = history;
    return { windowId: id, tabs, active, history };
  }

  async function activate(context, target) {
    if (!target) return { changed: false };
    const { windowId, active, history } = context;
    const tab = await api.tabs.get(target.tabId);
    if (tab.windowId !== windowId) throw new Error('该标签页已移到另一个窗口，请重试。');
    histories[windowId] = moveCursor(history, target.cursor);
    await persist();
    if (target.tabId === active.id) return { changed: true };
    const marker = { tabId: target.tabId, time: Date.now() };
    const pending = expectedActivations.get(windowId) ?? [];
    pending.push(marker);
    expectedActivations.set(windowId, pending);
    try {
      await api.tabs.update(target.tabId, { active: true });
    } catch (error) {
      expectedActivations.set(windowId, (expectedActivations.get(windowId) ?? []).filter(item => item !== marker));
      histories[windowId] = history;
      await persist();
      throw error;
    }
    return { changed: true };
  }

  async function navigate(windowId, direction) {
    if (direction !== -1 && direction !== 1) throw new Error('无效的导航方向。');
    const context = await windowContext(windowId);
    const target = findTarget(context.history, direction, context.active.id);
    if (!target) { await persist(); return { changed: false }; }
    return activate(context, target);
  }

  async function closeRight(windowId, approved = null) {
    const { active, tabs } = await windowContext(windowId);
    const candidates = tabs.filter(tab => tab.index > active.index && !tab.pinned);
    if (approved && (active.id !== approved.anchorId || active.windowId !== approved.windowId
      || candidates.length !== approved.tabIds.length || candidates.some(tab => !approved.tabIds.includes(tab.id)))) {
      throw new Error('右侧标签页已变化，请重新打开轮盘确认。');
    }
    let closedCount = 0;
    for (const candidate of candidates) {
      let anchor;
      let tab;
      try { [anchor, tab] = await Promise.all([api.tabs.get(active.id), api.tabs.get(candidate.id)]); }
      catch { continue; }
      if (anchor.windowId !== active.windowId || (approved && !anchor.active)) break;
      if (tab.windowId !== anchor.windowId || tab.index <= anchor.index || tab.pinned) continue;
      await api.tabs.remove(tab.id);
      closedCount++;
    }
    await persist();
    return { closedCount };
  }

  // ---------------------------------------------------------------- clipboard & menus

  let copyTail = Promise.resolve();
  function copyText(text) {
    const run = copyTail.then(() => copyTextNow(text));
    copyTail = run.catch(() => {});
    return run;
  }

  async function copyTextNow(text) {
    if (!api.offscreen) throw new Error('当前浏览器不支持后台复制。');
    const exists = api.offscreen.hasDocument ? await api.offscreen.hasDocument() : false;
    if (!exists) {
      await api.offscreen.createDocument({ url: 'offscreen.html', reasons: ['CLIPBOARD'], justification: '将链接写入剪贴板' });
    }
    let reply = null;
    for (let attempt = 0; attempt < 5 && !reply; attempt++) {
      reply = await api.runtime.sendMessage({ type: 'offscreen-copy', text }).catch(() => null);
      if (!reply) await new Promise(resolve => setTimeout(resolve, 100));
    }
    await api.offscreen.closeDocument?.().catch(() => {});
    if (!reply?.ok) throw new Error('复制到剪贴板失败。');
  }

  const menuCall = (method, ...args) => new Promise((resolve, reject) => {
    api.contextMenus[method](...args, () => {
      const error = api.runtime.lastError;
      error ? reject(new Error(error.message)) : resolve(undefined);
    });
  });

  async function rebuildMenus() {
    if (!api.contextMenus) return;
    const settings = await settingsStore.get();
    await menuCall('removeAll');
    await menuCall('create', { id: MENU_ROOT, title: '飛雷神', contexts: ['selection'] });
    // "发送" is the primary transfer; "填入" stays reachable from search, shortcuts and task retry,
    // and only appears here for targets that cannot send at all.
    for (const target of resolveTargets(settings)) {
      if (supports(target, 'send')) {
        await menuCall('create', { id: `send:${target.id}`, parentId: MENU_ROOT, title: `发送到 ${target.name}`, contexts: ['selection'] });
      } else if (supports(target, 'fill')) {
        await menuCall('create', { id: `fill:${target.id}`, parentId: MENU_ROOT, title: `填入 ${target.name}`, contexts: ['selection'] });
      }
    }
  }

  // ---------------------------------------------------------------- dispatcher

  async function resolveContext(ctx) {
    const context = { ...ctx };
    if (!Number.isInteger(context.tabId)) {
      const query = Number.isInteger(context.windowId) ? { windowId: context.windowId, active: true } : { lastFocusedWindow: true, active: true };
      const [tab] = await api.tabs.query(query);
      if (!tab) throw new Error('当前窗口没有可操作的标签页。');
      context.tabId = tab.id;
      context.windowId = tab.windowId;
    } else if (!Number.isInteger(context.windowId)) {
      context.windowId = (await api.tabs.get(context.tabId)).windowId;
    }
    return context;
  }

  const ok = (message = '') => ({ status: 'ok', message, notify: false });

  // Switching to the target closes the panel, so failures after that point need a notification
  // even for panel-triggered transfers; only pre-switch failures stay panel-only.
  const PANEL_VISIBLE = new Set(['no-selection', 'selection-blocked', 'unsupported', 'source-gone']);
  async function runTransfer(mode, targetId, ctx) {
    const result = await transfer.run({ mode, targetId, ctx });
    const panelStillOpen = ctx.origin === 'popup' && PANEL_VISIBLE.has(result.status);
    if (result.notify && result.message && !panelStillOpen) await notify(result.message);
    return result;
  }

  /**
   * Execute one action for one already-determined source context. Every entry point
   * (command, panel, menu, web shortcut, floating button) ends up here.
   */
  async function runAction(actionId, rawCtx) {
    const settings = await settingsStore.get();
    const action = getAction(actionId, settings);
    if (!action) throw new Error('未知动作。');
    await countAction(action.id, rawCtx.origin);
    const ctx = await resolveContext(rawCtx);
    let result;
    try {
      switch (action.kind) {
        case 'history': {
          const outcome = await enqueue(() => navigate(ctx.windowId, action.direction));
          result = outcome.changed ? ok() : { status: 'noop', message: '已到访问历史边界。', notify: false };
          break;
        }
        case 'previous-tab': result = await enqueue(() => tabOps.previousTab(ctx.windowId)); break;
        case 'close-right': {
          const { closedCount } = await enqueue(() => closeRight(ctx.windowId));
          result = closedCount ? ok(`已关闭 ${closedCount} 个标签页。`) : { status: 'noop', message: '右侧没有可关闭的标签页。', notify: true };
          break;
        }
        case 'move': result = await tabOps.move(ctx.windowId, action.move); break;
        case 'move-to-index': result = await tabOps.moveToIndex(ctx.windowId, Number(ctx.args?.index)); break;
        case 'new-window': result = await tabOps.newWindow(ctx.windowId, action.scope); break;
        case 'duplicate': result = await tabOps.duplicate(ctx.windowId); break;
        case 'copy-links': {
          const links = await tabOps.copyLinks(ctx.windowId, action.format);
          if (links.status === 'ok') { await copyText(links.text); result = ok(`已复制 ${links.count} 个链接。`); }
          else result = { ...links, notify: true };
          break;
        }
        case 'transfer': return runTransfer(action.mode, action.targetId, ctx);
        default: throw new Error('未知动作。');
      }
    } catch (error) {
      if (ctx.origin !== 'popup') await notify(error.message || '操作失败。');
      throw error;
    }
    result.notify ??= false;
    if (ctx.origin !== 'popup' && result.notify && result.message) await notify(result.message);
    return result;
  }

  // ---------------------------------------------------------------- state for pages

  async function describeActions(settings) {
    const status = await shortcuts.status(settings);
    // Transfer actions carry their target's monogram so the panel never shows one shared glyph
    // for every target.
    const targetsById = new Map(resolveTargets(settings).map(target => [target.id, target]));
    const targetFor = action => (action.kind === 'transfer'
      ? targetsById.get(action.targetId === 'default' ? settings.defaultTargetId : action.targetId) ?? null : null);
    const nativeByName = new Map(status.native.map(item => [item.name, item]));
    // Manifest defaults let the settings page say "the default key did not take effect".
    const commands = api.runtime.getManifest?.()?.commands ?? {};
    const suggestedFor = id => {
      const key = commands[id]?.suggested_key;
      return normalizeNative(key?.[status.platform] ?? key?.default ?? '', status.platform);
    };
    return {
      status,
      actions: listActions(settings).map(action => ({
        id: action.id, name: action.name, category: action.category, keywords: action.keywords,
        command: action.command, web: action.web, panelInput: action.panelInput, requiresSelection: action.requiresSelection,
        kind: action.kind, mode: action.mode ?? null, targetId: action.targetId ?? null,
        monogram: targetFor(action) ? targetMonogram(targetFor(action)) : '',
        native: nativeByName.get(action.id)?.shortcut ?? '', nativeCombo: nativeByName.get(action.id)?.combo ?? '',
        suggested: action.command ? suggestedFor(action.id) : '',
        webBinding: settings.webShortcuts.bindings[action.id] ?? '',
        shadowed: Boolean(status.keymap.shadowed[action.id]), conflict: Boolean(status.keymap.conflicts[action.id]),
      })),
    };
  }

  async function describeTargets(settings) {
    return Promise.all(resolveTargets(settings).map(async target => ({
      ...target, granted: await targets.hasPermission(target),
    })));
  }

  async function getState(windowId) {
    const { windowId: id, tabs, active, history } = await windowContext(windowId);
    const settings = await settingsStore.get();
    const [{ actions, status }, targetList, tasks, pageReady] = await Promise.all([
      describeActions(settings), describeTargets(settings), transfer.list(), shortcuts.pingTab(active.id),
    ]);
    const byId = new Map(tabs.map(tab => [tab.id, tab]));
    await persist();
    return { state: {
      windowId: id, cursor: history.cursor,
      entries: history.entries.map((tabId, cursor) => ({
        tabId, cursor, current: cursor === history.cursor,
        title: byId.get(tabId)?.title || '未命名标签页', url: byId.get(tabId)?.url || '',
      })),
      canBack: Boolean(findTarget(history, -1, active.id)),
      canForward: Boolean(findTarget(history, 1, active.id)),
      rightCount: tabs.filter(tab => tab.index > active.index && !tab.pinned).length,
      tabCount: tabs.length, activeIndex: active.index,
      actions, tasks, targets: targetList,
      settings, platform: status.platform,
      shortcuts: { granted: status.granted, pageReady, webActive: Object.keys(status.keymap.map).length > 0 },
    } };
  }

  /** Everything the in-page overlay renders, and nothing else: no settings, no tab titles. */
  async function overlayState(ctx) {
    const settings = await settingsStore.get();
    const { tabs, active, history } = await windowContext(ctx.windowId);
    const [{ actions, status }, targetList] = await Promise.all([describeActions(settings), describeTargets(settings)]);
    return { state: {
      // One entry per wheel sector, clockwise from twelve o'clock; an empty sector stays null.
      slots: settings.overlay.slots.map(id => {
        const action = id ? actions.find(item => item.id === id) : null;
        return action && !action.panelInput ? action : null;
      }),
      platform: status.platform,
      canBack: Boolean(findTarget(history, -1, active.id)),
      canForward: Boolean(findTarget(history, 1, active.id)),
      rightCount: tabs.filter(tab => tab.index > active.index && !tab.pinned).length,
      tabCount: tabs.length,
      targets: targetList.map(target => ({ id: target.id, name: target.name, capability: target.capability, granted: target.granted })),
      defaultTargetId: settings.defaultTargetId,
    } };
  }

  async function getSettingsView() {
    const settings = await settingsStore.get();
    const [{ actions, status }, targetList] = await Promise.all([describeActions(settings), describeTargets(settings)]);
    return { settings, actions, status, targets: targetList, commandIds: COMMAND_IDS };
  }

  // Settings writes arrive from the options page and from permission events at the same time;
  // run them one after another so script registration and menu rebuilds never interleave.
  /** @type {Promise<any>} */
  let settingsTail = Promise.resolve();
  /** @param {() => Promise<unknown>} [write] */
  function afterSettingsChange(write = async () => {}) {
    const run = settingsTail.then(async () => {
      await write();
      const wanted = await shortcuts.sync();
      await rebuildMenus();
      await shortcuts.injectExisting(wanted.inject);
      return getSettingsView();
    });
    settingsTail = run.catch(() => {});
    return run;
  }

  // ---------------------------------------------------------------- events

  function onActivated({ tabId, windowId }) {
    const pending = (expectedActivations.get(windowId) ?? []).filter(item => Date.now() - item.time < ACTIVATION_MARKER_TTL);
    const match = pending.findIndex(item => item.tabId === tabId);
    if (match !== -1) pending.splice(match, 1);
    expectedActivations.set(windowId, pending);
    if (match !== -1) return Promise.resolve();
    bufferedActivations.set(windowId, (bufferedActivations.get(windowId) ?? 0) + 1);
    return enqueue(async () => {
      try {
        histories[windowId] = recordVisit(histories[windowId] ?? createHistory(), tabId);
        await persist();
      } finally {
        bufferedActivations.set(windowId, bufferedActivations.get(windowId) - 1);
      }
    });
  }

  function removeTab(tabId, windowId) {
    return enqueue(async () => {
      const history = histories[windowId];
      if (history) histories[windowId] = pruneHistory(history, history.entries.filter(id => id !== tabId));
      await persist();
    });
  }

  // The options page runs inside a tab, so "has a tab" alone does not identify a content script.
  function isExtensionPage(sender) {
    return Boolean(sender.id) && typeof sender.url === 'string' && sender.url.startsWith(`chrome-extension://${sender.id}/`);
  }

  async function handleContentMessage(message, sender) {
    const settings = await settingsStore.get();
    const tab = await api.tabs.get(sender.tab.id);
    if (!tab.active) return { status: 'ignored', message: '' };
    const ctx = { origin: 'web', tabId: tab.id, windowId: tab.windowId, frameId: sender.frameId };
    if (message.type === 'web-shortcut') {
      const action = getAction(message.actionId, settings);
      if (!action?.web || settings.webShortcuts.bindings[action.id] !== message.combo) return { status: 'ignored', message: '' };
      const status = await shortcuts.status(settings);
      if (status.keymap.map[message.combo] !== action.id) return { status: 'ignored', message: '' };
      return runAction(action.id, ctx);
    }
    if (message.type === 'overlay-state' || message.type === 'overlay-action' || message.type === 'overlay-confirm-action') {
      // The overlay is only reachable while the user has enabled it, and only from the tab the
      // user is actually looking at; actions still go through the shared dispatcher.
      if (!settings.overlay.enabled) return { status: 'ignored', message: '' };
      if (message.type === 'overlay-state') return enqueue(() => overlayState(ctx));
      // Only what the wheel draws: an action sitting in one of its sectors.
      const action = getAction(message.id, settings);
      if (!action || action.panelInput || !settings.overlay.slots.includes(action.id)) throw new Error('未知动作。');
      if (message.type === 'overlay-confirm-action') {
        if (action.kind !== 'close-right') throw new Error('此动作不需要确认。');
        return enqueue(async () => {
          const approved = overlayClosures.get(tab.id);
          if (!approved || approved.token !== message.token || approved.frameId !== sender.frameId
            || Date.now() > approved.expiresAt) throw new Error('确认已失效，请重新打开轮盘。');
          // Consume before executing, including on failure, so double clicks cannot replay it.
          overlayClosures.delete(tab.id);
          await countAction('close-right', 'overlay');
          const { closedCount } = await closeRight(ctx.windowId, approved);
          return ok(`已关闭 ${closedCount} 个标签页。`);
        });
      }
      if (action.kind === 'close-right') {
        return enqueue(async () => {
          for (const [id, plan] of overlayClosures) if (Date.now() > plan.expiresAt) overlayClosures.delete(id);
          overlayClosures.delete(tab.id);
          const { active, tabs } = await windowContext(ctx.windowId);
          if (active.id !== tab.id) throw new Error('当前标签页已变化，请重新打开轮盘。');
          const tabIds = tabs.filter(item => item.index > active.index && !item.pinned).map(item => item.id);
          if (!tabIds.length) throw new Error('右侧没有可关闭的标签页。');
          const token = crypto.randomUUID();
          overlayClosures.set(tab.id, { token, anchorId: tab.id, windowId: tab.windowId,
            frameId: sender.frameId, tabIds, expiresAt: Date.now() + 120000 });
          return { status: 'confirmation-required', confirmation: { token, count: tabIds.length } };
        });
      }
      return runAction(action.id, { ...ctx, origin: 'overlay' });
    }
    throw new Error('此操作只能在扩展面板中执行。');
  }

  async function handleMessage(message, sender = {}) {
    if (!message || typeof message !== 'object') throw new Error('无效的请求。');
    if (sender.tab && !isExtensionPage(sender)) return handleContentMessage(message, sender);
    const popupCtx = extra => ({ origin: 'popup', windowId: message.windowId, ...extra });
    switch (message.type) {
      case 'get-state': return enqueue(() => getState(message.windowId));
      case 'run-action': return runAction(message.id, popupCtx({ args: message.args }));
      case 'popup-close-preview': return enqueue(async () => {
        const { active, tabs, windowId } = await windowContext(message.windowId);
        for (const [id, plan] of popupClosures) if (Date.now() > plan.expiresAt) popupClosures.delete(id);
        popupClosures.delete(windowId);
        const tabIds = tabs.filter(tab => tab.index > active.index && !tab.pinned).map(tab => tab.id);
        if (!tabIds.length) throw new Error('右侧没有可关闭的标签页。');
        const token = crypto.randomUUID();
        popupClosures.set(windowId, { token, anchorId: active.id, windowId, tabIds, expiresAt: Date.now() + 120000 });
        return { confirmation: { token, count: tabIds.length } };
      });
      case 'popup-close-confirm': return enqueue(async () => {
        const approved = popupClosures.get(message.windowId);
        if (!approved || approved.token !== message.token || Date.now() > approved.expiresAt) {
          throw new Error('确认已失效，请重新打开轮盘。');
        }
        popupClosures.delete(message.windowId);
        await countAction('close-right', 'popup');
        const { closedCount } = await closeRight(message.windowId, approved);
        return ok(`已关闭 ${closedCount} 个标签页。`);
      });
      case 'navigate': return enqueue(async () => {
        if (message.direction === -1 || message.direction === 1) await countAction(message.direction === -1 ? 'history-back' : 'history-forward', 'popup');
        return navigate(message.windowId, message.direction);
      });
      case 'close-right': return enqueue(async () => {
        await countAction('close-right', 'popup');
        return closeRight(message.windowId);
      });
      case 'jump': return enqueue(async () => {
        await countAction('jump-history', 'popup');
        const context = await windowContext(message.windowId);
        const cursor = message.cursor;
        if (!Number.isInteger(cursor) || cursor < 0 || cursor >= context.history.entries.length
          || context.history.entries[cursor] !== message.tabId) {
          throw new Error('这条记录已变化，请重新打开面板。');
        }
        return activate(context, { tabId: context.history.entries[cursor], cursor });
      });
      case 'get-settings': return getSettingsView();
      case 'save-settings': {
        if (!message.settings || typeof message.settings !== 'object') throw new Error('无效的设置。');
        const next = normalizeSettings(message.settings);
        return afterSettingsChange(() => settingsStore.set(next));
      }
      case 'set-web-binding': {
        if (typeof message.actionId !== 'string') throw new Error('无效的设置。');
        return afterSettingsChange(() => settingsStore.update(settings => {
          if (message.combo) settings.webShortcuts.bindings[message.actionId] = message.combo;
          else delete settings.webShortcuts.bindings[message.actionId];
          return settings;
        }));
      }
      case 'sync-page': return afterSettingsChange();
      case 'get-usage': return { usage: await usage.get() };
      case 'reset-usage': return { usage: await usage.reset() };
      case 'list-tasks': return { tasks: await transfer.list() };
      case 'retry-task': {
        await countAction('retry-transfer', 'retry');
        const ctx = await resolveContext(popupCtx({}));
        const result = await transfer.retry(message.taskId, ctx);
        return result;
      }
      case 'remove-task': await transfer.remove(message.taskId); return {};
      default: throw new Error('未知操作。');
    }
  }

  return {
    handleMessage, onActivated, removeTab, runAction,
    ready: () => enqueue(async () => {
      const view = await afterSettingsChange();
      await transfer.purgeExpired();
      return view;
    }),
    onCommand: (command, tab) => runAction(command, { origin: 'command', tabId: tab?.id, windowId: tab?.windowId }),
    onMenuClicked: async (info, tab) => {
      const [mode, targetId] = String(info.menuItemId).split(':');
      if (!['fill', 'send'].includes(mode) || !targetId || !tab) return Promise.resolve(null);
      const target = resolveTargets(await settingsStore.get()).find(item => item.id === targetId);
      if (target) await countAction(`${target.builtin ? '' : 'target:'}${mode}-${targetId}`, 'menu');
      return runTransfer(mode, targetId, { origin: 'menu', tabId: tab.id, windowId: tab.windowId, frameId: info.frameId, fallbackText: info.selectionText });
    },
    onAlarm: alarm => transfer.onAlarm(alarm),
    onAttached: (tabId, { newWindowId }) => enqueue(async () => {
      const tab = await api.tabs.get(tabId);
      if (tab.active) histories[newWindowId] = recordVisit(histories[newWindowId] ?? createHistory(), tabId);
      await persist();
    }),
    onWindowRemoved: windowId => enqueue(async () => {
      popupClosures.delete(windowId);
      delete histories[windowId];
      expectedActivations.delete(windowId);
      await persist();
    }),
    onReplaced: (addedId, removedId) => enqueue(async () => {
      for (const windowId of Object.keys(histories)) histories[windowId] = replaceTab(histories[windowId], removedId, addedId);
      await persist();
    }),
    onPermissionsChanged: () => afterSettingsChange(),
  };
}
