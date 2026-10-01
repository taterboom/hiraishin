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
import { createLicense } from './license.js';
import { applyLocalePreference, t } from './i18n.js';

export const HISTORY_KEY = 'tabHistory';
export { SETTINGS_KEY, PAGE_ORIGINS, COMMAND_IDS };
const MENU_ROOT = 'hiraishin-root';
const ACTIVATION_MARKER_TTL = 10000;
export const lockedMessage = () => t('bg.locked');

/** @param {any} api @param {{ license?: import('./license.js').LicenseOptions }} [options] */
export function createController(api, { license: licenseOptions } = {}) {
  let histories = null;
  let tail = Promise.resolve();
  const expectedActivations = new Map();
  const bufferedActivations = new Map();
  // One short-lived, single-use close preview per source tab. A wheel gesture only prepares it.
  const overlayClosures = new Map();
  const popupClosures = new Map();

  // Every settings read also sets the worker's language, so whatever runs next (a notification, a
  // menu title, an error) speaks the language the user picked, including right after a change.
  const storedSettings = createSettingsStore(api);
  const withLocale = settings => { applyLocalePreference(settings.locale, api); return settings; };
  const settingsStore = {
    get: () => storedSettings.get().then(withLocale),
    set: settings => storedSettings.set(settings).then(withLocale),
    update: mutate => storedSettings.update(mutate).then(withLocale),
  };
  // A worker woken by a message has not read settings yet; load the language once up front so
  // even a message that never reads settings answers in the saved language.
  const localeLoaded = settingsStore.get().catch(() => null);
  const tabOps = createTabOps(api);
  const targets = createTargetService(api);
  const shortcuts = createShortcutService(api, { settingsStore, listActionsFor: listActions });
  const readSelection = createSelectionReader(api);
  const transfer = createTransfer(api, { targets, settingsStore, readSelection });
  const notify = createNotifier(api);
  const usage = createUsageStore(api);
  // Counting is best-effort: a storage failure must never prevent the requested operation.
  const countAction = (id, origin) => usage.record(id, origin).catch(error => console.warn('[Hiraishin usage]', error));
  const license = createLicense(api, licenseOptions);
  // Every path that really performs an operation calls one of these two before doing anything.
  // Previews count too, so a user never confirms a dialog only to be refused afterwards.
  const denied = () => ({ status: 'license-required', message: lockedMessage(), notify: true });
  async function requireLicense() {
    if (await license.allowed()) return;
    // The worker may have just woken for this message; read settings so the refusal is in the
    // user's language.
    await settingsStore.get();
    throw new Error(lockedMessage());
  }
  const noteResult = result => license.noteResult(result).catch(error => console.warn('[Hiraishin license]', error));

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
    if (!active) throw new Error(t('bg.error.noActiveTab'));
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
    if (tab.windowId !== windowId) throw new Error(t('bg.error.tabMovedWindow'));
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
    if (direction !== -1 && direction !== 1) throw new Error(t('bg.error.invalidDirection'));
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
      throw new Error(t('bg.error.rightChanged'));
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
    if (!api.offscreen) throw new Error(t('bg.error.noOffscreen'));
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
    if (!reply?.ok) throw new Error(t('bg.error.copyFailed'));
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
    await menuCall('create', { id: MENU_ROOT, title: t('bg.menu.root'), contexts: ['selection'] });
    // "发送" is the primary transfer; "填入" stays reachable from search, shortcuts and task retry,
    // and only appears here for targets that cannot send at all.
    for (const target of resolveTargets(settings)) {
      if (supports(target, 'send')) {
        await menuCall('create', { id: `send:${target.id}`, parentId: MENU_ROOT, title: t('action.mode.send', { target: target.name }), contexts: ['selection'] });
      } else if (supports(target, 'fill')) {
        await menuCall('create', { id: `fill:${target.id}`, parentId: MENU_ROOT, title: t('action.mode.fill', { target: target.name }), contexts: ['selection'] });
      }
    }
  }

  // ---------------------------------------------------------------- dispatcher

  async function resolveContext(ctx) {
    const context = { ...ctx };
    if (!Number.isInteger(context.tabId)) {
      const query = Number.isInteger(context.windowId) ? { windowId: context.windowId, active: true } : { lastFocusedWindow: true, active: true };
      const [tab] = await api.tabs.query(query);
      if (!tab) throw new Error(t('bg.error.noActiveTab'));
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
    if (!action) throw new Error(t('bg.error.unknownAction'));
    if (!(await license.allowed())) {
      if (rawCtx.origin !== 'popup') await notify(lockedMessage());
      return denied();
    }
    await countAction(action.id, rawCtx.origin);
    const ctx = await resolveContext(rawCtx);
    let result;
    try {
      switch (action.kind) {
        case 'history': {
          const outcome = await enqueue(() => navigate(ctx.windowId, action.direction));
          result = outcome.changed ? ok() : { status: 'noop', message: t('bg.history.edge'), notify: false };
          break;
        }
        case 'previous-tab': result = await enqueue(() => tabOps.previousTab(ctx.windowId)); break;
        case 'close-right': {
          const { closedCount } = await enqueue(() => closeRight(ctx.windowId));
          result = closedCount ? ok(t('bg.tabs.closed', { count: closedCount })) : { status: 'noop', message: t('bg.tabs.nothingRight'), notify: true };
          break;
        }
        case 'move': result = await tabOps.move(ctx.windowId, action.move); break;
        case 'move-to-index': result = await tabOps.moveToIndex(ctx.windowId, Number(ctx.args?.index)); break;
        case 'new-window': result = await tabOps.newWindow(ctx.windowId, action.scope); break;
        case 'duplicate': result = await tabOps.duplicate(ctx.windowId); break;
        case 'copy-links': {
          const links = await tabOps.copyLinks(ctx.windowId, action.format);
          if (links.status === 'ok') { await copyText(links.text); result = ok(t('bg.links.copied', { count: links.count })); }
          else result = { ...links, notify: true };
          break;
        }
        case 'transfer': {
          const transferred = await runTransfer(action.mode, action.targetId, ctx);
          await noteResult(transferred);
          return transferred;
        }
        default: throw new Error(t('bg.error.unknownAction'));
      }
    } catch (error) {
      if (ctx.origin !== 'popup') await notify(error.message || t('bg.error.generic'));
      throw error;
    }
    result.notify ??= false;
    if (ctx.origin !== 'popup' && result.notify && result.message) await notify(result.message);
    await noteResult(result);
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
    const [{ actions, status }, targetList, tasks, pageReady, licenseView] = await Promise.all([
      describeActions(settings), describeTargets(settings), transfer.list(), shortcuts.pingTab(active.id), license.status(),
    ]);
    const byId = new Map(tabs.map(tab => [tab.id, tab]));
    await persist();
    return { state: {
      windowId: id, cursor: history.cursor,
      entries: history.entries.map((tabId, cursor) => ({
        tabId, cursor, current: cursor === history.cursor,
        title: byId.get(tabId)?.title || t('bg.tabs.untitled'), url: byId.get(tabId)?.url || '',
      })),
      canBack: Boolean(findTarget(history, -1, active.id)),
      canForward: Boolean(findTarget(history, 1, active.id)),
      rightCount: tabs.filter(tab => tab.index > active.index && !tab.pinned).length,
      tabCount: tabs.length, activeIndex: active.index,
      actions, tasks, targets: targetList,
      settings, platform: status.platform,
      shortcuts: { granted: status.granted, pageReady, webActive: Object.keys(status.keymap.map).length > 0 },
      license: licenseView,
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
      if (!action || action.panelInput || !settings.overlay.slots.includes(action.id)) throw new Error(t('bg.error.unknownAction'));
      if (message.type === 'overlay-confirm-action') {
        if (action.kind !== 'close-right') throw new Error(t('bg.error.noConfirmNeeded'));
        await requireLicense();
        return enqueue(async () => {
          const approved = overlayClosures.get(tab.id);
          if (!approved || approved.token !== message.token || approved.frameId !== sender.frameId
            || Date.now() > approved.expiresAt) throw new Error(t('bg.error.confirmExpired'));
          // Consume before executing, including on failure, so double clicks cannot replay it.
          overlayClosures.delete(tab.id);
          await countAction('close-right', 'overlay');
          const { closedCount } = await closeRight(ctx.windowId, approved);
          if (closedCount) await noteResult(ok());
          return ok(t('bg.tabs.closed', { count: closedCount }));
        });
      }
      if (action.kind === 'close-right') {
        await requireLicense();
        return enqueue(async () => {
          for (const [id, plan] of overlayClosures) if (Date.now() > plan.expiresAt) overlayClosures.delete(id);
          overlayClosures.delete(tab.id);
          const { active, tabs } = await windowContext(ctx.windowId);
          if (active.id !== tab.id) throw new Error(t('bg.error.activeChanged'));
          const tabIds = tabs.filter(item => item.index > active.index && !item.pinned).map(item => item.id);
          if (!tabIds.length) throw new Error(t('bg.tabs.nothingRight'));
          const token = crypto.randomUUID();
          overlayClosures.set(tab.id, { token, anchorId: tab.id, windowId: tab.windowId,
            frameId: sender.frameId, tabIds, expiresAt: Date.now() + 120000 });
          return { status: 'confirmation-required', confirmation: { token, count: tabIds.length } };
        });
      }
      return runAction(action.id, { ...ctx, origin: 'overlay' });
    }
    throw new Error(t('bg.error.panelOnly'));
  }

  async function handleMessage(message, sender = {}) {
    await localeLoaded;
    if (!message || typeof message !== 'object') throw new Error(t('bg.error.invalidRequest'));
    if (sender.tab && !isExtensionPage(sender)) return handleContentMessage(message, sender);
    const popupCtx = extra => ({ origin: 'popup', windowId: message.windowId, ...extra });
    switch (message.type) {
      case 'get-state': return enqueue(() => getState(message.windowId));
      case 'run-action': return runAction(message.id, popupCtx({ args: message.args }));
      case 'popup-close-preview': await requireLicense(); return enqueue(async () => {
        const { active, tabs, windowId } = await windowContext(message.windowId);
        for (const [id, plan] of popupClosures) if (Date.now() > plan.expiresAt) popupClosures.delete(id);
        popupClosures.delete(windowId);
        const tabIds = tabs.filter(tab => tab.index > active.index && !tab.pinned).map(tab => tab.id);
        if (!tabIds.length) throw new Error(t('bg.tabs.nothingRight'));
        const token = crypto.randomUUID();
        popupClosures.set(windowId, { token, anchorId: active.id, windowId, tabIds, expiresAt: Date.now() + 120000 });
        return { confirmation: { token, count: tabIds.length } };
      });
      case 'popup-close-confirm': await requireLicense(); return enqueue(async () => {
        const approved = popupClosures.get(message.windowId);
        if (!approved || approved.token !== message.token || Date.now() > approved.expiresAt) {
          throw new Error(t('bg.error.confirmExpired'));
        }
        popupClosures.delete(message.windowId);
        await countAction('close-right', 'popup');
        const { closedCount } = await closeRight(message.windowId, approved);
        if (closedCount) await noteResult(ok());
        return ok(t('bg.tabs.closed', { count: closedCount }));
      });
      case 'navigate': await requireLicense(); return enqueue(async () => {
        if (message.direction === -1 || message.direction === 1) await countAction(message.direction === -1 ? 'history-back' : 'history-forward', 'popup');
        const outcome = await navigate(message.windowId, message.direction);
        await noteResult(outcome);
        return outcome;
      });
      case 'close-right': await requireLicense(); return enqueue(async () => {
        await countAction('close-right', 'popup');
        const outcome = await closeRight(message.windowId);
        if (outcome.closedCount) await noteResult(ok());
        return outcome;
      });
      case 'jump': await requireLicense(); return enqueue(async () => {
        await countAction('jump-history', 'popup');
        const context = await windowContext(message.windowId);
        const cursor = message.cursor;
        if (!Number.isInteger(cursor) || cursor < 0 || cursor >= context.history.entries.length
          || context.history.entries[cursor] !== message.tabId) {
          throw new Error(t('bg.error.entryChanged'));
        }
        const outcome = await activate(context, { tabId: context.history.entries[cursor], cursor });
        await noteResult(outcome);
        return outcome;
      });
      case 'get-settings': return getSettingsView();
      case 'save-settings': {
        if (!message.settings || typeof message.settings !== 'object') throw new Error(t('bg.error.invalidSettings'));
        const next = normalizeSettings(message.settings);
        return afterSettingsChange(() => settingsStore.set(next));
      }
      case 'set-web-binding': {
        if (typeof message.actionId !== 'string') throw new Error(t('bg.error.invalidSettings'));
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
        await requireLicense();
        await countAction('retry-transfer', 'retry');
        const ctx = await resolveContext(popupCtx({}));
        const result = await transfer.retry(message.taskId, ctx);
        await noteResult(result);
        return result;
      }
      case 'get-license': return { license: await license.status() };
      case 'start-purchase': {
        await settingsStore.get(); // The checkout page follows the interface language.
        const url = await license.startPurchase();
        await api.tabs.create({ url });
        return { license: await license.status() };
      }
      case 'collect-license': return { ...(await license.collect()), license: await license.status() };
      case 'activate-license': return { license: await license.activate(message.licenseKey) };
      case 'refresh-license': return { license: await license.refresh() };
      case 'remove-task': await transfer.remove(message.taskId); return {};
      default: throw new Error(t('bg.error.unknownOperation'));
    }
  }

  return {
    handleMessage, onActivated, removeTab, runAction,
    ready: () => enqueue(async () => {
      const view = await afterSettingsChange();
      await transfer.purgeExpired();
      await license.ready().catch(error => console.warn('[Hiraishin license]', error));
      return view;
    }),
    onCommand: (command, tab) => runAction(command, { origin: 'command', tabId: tab?.id, windowId: tab?.windowId }),
    onMenuClicked: async (info, tab) => {
      const [mode, targetId] = String(info.menuItemId).split(':');
      if (!['fill', 'send'].includes(mode) || !targetId || !tab) return Promise.resolve(null);
      const settings = await settingsStore.get();
      if (!(await license.allowed())) { await notify(lockedMessage()); return denied(); }
      const target = resolveTargets(settings).find(item => item.id === targetId);
      if (target) await countAction(`${target.builtin ? '' : 'target:'}${mode}-${targetId}`, 'menu');
      const result = await runTransfer(mode, targetId, { origin: 'menu', tabId: tab.id, windowId: tab.windowId, frameId: info.frameId, fallbackText: info.selectionText });
      await noteResult(result);
      return result;
    },
    onAlarm: alarm => Promise.all([transfer.onAlarm(alarm), license.onAlarm(alarm)]),
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
