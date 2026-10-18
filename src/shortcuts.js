// Web shortcuts and page enhancements (spec §6): derive the effective keymap, publish it
// for content scripts, and keep dynamic content scripts in step with settings and permissions.
import { normalizeNative } from './keys.js';
import { PAGE_ORIGINS } from './settings.js';
import { browserLanguage, resolveLocale } from './i18n.js';

export const PAGE_CONFIG_KEY = 'pageConfig';
export const SHORTCUT_SCRIPT_ID = 'hiraishin-page-shortcuts';
export const OVERLAY_SCRIPT_ID = 'hiraishin-overlay';
const LEGACY_SCRIPT_IDS = ['hiraishin-minus', 'hiraishin-selection-button'];
const INJECT_TIMEOUT_MS = 3000;
const SCRIPTS = {
  [SHORTCUT_SCRIPT_ID]: 'src/page-shortcuts.js',
  [OVERLAY_SCRIPT_ID]: 'ui/overlay.js',
};
// Web shortcuts must hear keys typed inside embedded frames (editors, players), so they run in
// every frame. The wheel only runs in the top frame: a wheel drawn inside an ad or embed would be
// clipped to that frame, and loading the React bundle into every iframe of every page is weight
// for nothing.
const ALL_FRAMES = {
  [SHORTCUT_SCRIPT_ID]: true,
  [OVERLAY_SCRIPT_ID]: false,
};

/**
 * Bindings that a native command already covers are shadowed so one key press never
 * runs an action twice. Two actions on one combo keep the first and flag the second.
 */
export function effectiveKeymap(bindings, nativeCommands, platform, actions) {
  const nativeCombos = new Set(nativeCommands.map(command => normalizeNative(command.shortcut ?? '', platform)).filter(Boolean));
  const map = {};
  const shadowed = {};
  const conflicts = {};
  for (const [actionId, combo] of Object.entries(bindings)) {
    const action = actions.find(item => item.id === actionId);
    if (!action || !action.web) continue;
    if (nativeCombos.has(combo)) { shadowed[actionId] = combo; continue; }
    if (map[combo]) { conflicts[actionId] = combo; continue; }
    map[combo] = actionId;
  }
  return { map, shadowed, conflicts };
}

export function createShortcutService(api, { settingsStore, listActionsFor }) {
  let platformPromise = null;

  function platform() {
    platformPromise ??= Promise.resolve(api.runtime.getPlatformInfo?.() ?? { os: 'unknown' })
      .then(info => info.os).catch(() => 'unknown');
    return platformPromise;
  }

  async function registered() {
    const scripts = await api.scripting.getRegisteredContentScripts({ ids: [...Object.keys(SCRIPTS), ...LEGACY_SCRIPT_IDS] });
    return new Map(scripts.map(script => [script.id, script]));
  }

  /** Returns true when the script was registered by this call. */
  async function setScript(id, wanted, current) {
    if (wanted && !current.has(id)) {
      await api.scripting.registerContentScripts([{
        id, matches: PAGE_ORIGINS, js: [SCRIPTS[id]], allFrames: ALL_FRAMES[id], runAt: 'document_start', persistAcrossSessions: true,
      }]);
      return true;
    }
    // Registrations persist across updates, so one made by an older version keeps its old frame
    // scope until corrected here. Pages already open keep what they loaded until they reload.
    if (wanted && Boolean(current.get(id).allFrames) !== ALL_FRAMES[id]) {
      await api.scripting.updateContentScripts([{ id, allFrames: ALL_FRAMES[id] }]);
    }
    if (!wanted && current.has(id)) await api.scripting.unregisterContentScripts({ ids: [id] });
    return false;
  }

  async function status(settings) {
    const [os, native, granted] = await Promise.all([
      platform(), api.commands.getAll(), api.permissions.contains({ origins: PAGE_ORIGINS }),
    ]);
    const keymap = effectiveKeymap(settings.webShortcuts.bindings, native, os, listActionsFor(settings));
    return {
      platform: os, granted, keymap,
      native: native.map(command => ({ name: command.name, shortcut: command.shortcut ?? '', combo: normalizeNative(command.shortcut ?? '', os) })),
    };
  }

  /** Publish page config and reconcile registered scripts. Returns which scripts are wanted. */
  async function sync() {
    const settings = await settingsStore.get();
    const state = await status(settings);
    const wantShortcuts = state.granted && Object.keys(state.keymap.map).length > 0;
    const actions = listActionsFor(settings);
    const pageKeymap = Object.fromEntries(Object.entries(state.keymap.map).map(([combo, actionId]) =>
      [combo, { id: actionId, repeat: actions.find(action => action.id === actionId)?.repeat ?? 'block' }]));
    const wantOverlay = state.granted && settings.overlay.enabled;
    await api.storage.local.set({ [PAGE_CONFIG_KEY]: {
      version: 1, keymap: wantShortcuts ? pageKeymap : {},
      disabledSites: settings.webShortcuts.disabledSites,
      // Previously injected selection-button scripts hide themselves on this config change.
      floating: null,
      // `enabled` is what a web page is allowed to do, so it waits on the host permission. The
      // extension's own pages load the same bundle from a <script> tag and need no permission
      // there, so they follow the preference alone.
      overlay: { ...settings.overlay, enabled: wantOverlay, extensionPages: settings.overlay.enabled },
      // Content scripts cannot read the preference's resolution themselves: `auto` means the browser
      // language the extension sees, which is what the rest of the UI uses too.
      locale: resolveLocale(settings.locale, browserLanguage(api)),
    } });
    const current = await registered();
    const legacy = LEGACY_SCRIPT_IDS.filter(id => current.has(id));
    if (legacy.length) await api.scripting.unregisterContentScripts({ ids: legacy });
    const shortcutsNew = await setScript(SHORTCUT_SCRIPT_ID, wantShortcuts, current);
    const overlayNew = await setScript(OVERLAY_SCRIPT_ID, wantOverlay, current);
    // Already-registered scripts pick up config changes through storage; only new ones need injecting.
    return { shortcuts: wantShortcuts, overlay: wantOverlay, state,
      inject: { shortcuts: shortcutsNew, overlay: overlayNew } };
  }

  /** Inject wanted scripts into pages that are already open so no refresh is required. */
  async function injectExisting(wanted) {
    const ids = [wanted.shortcuts && SHORTCUT_SCRIPT_ID, wanted.overlay && OVERLAY_SCRIPT_ID].filter(Boolean);
    if (!ids.length) return 0;
    const tabs = await api.tabs.query({ url: PAGE_ORIGINS });
    let injected = 0;
    // One unresponsive page must not stall the save that triggered this: the settings write is
    // already done, and the dynamic registration still covers that page's next load.
    const cap = new Promise(resolve => setTimeout(() => resolve('timeout'), INJECT_TIMEOUT_MS));
    await Promise.all(tabs.map(async tab => {
      try {
        const result = await Promise.race([
          Promise.all(ids.map(id => api.scripting.executeScript({
            target: { tabId: tab.id, allFrames: ALL_FRAMES[id] }, files: [SCRIPTS[id]] }))),
          cap,
        ]);
        if (result !== 'timeout') injected++;
      } catch {
        // Restricted or discarded page; the dynamic registration covers its next load.
      }
    }));
    return injected;
  }

  async function pingTab(tabId) {
    try {
      const reply = await api.tabs.sendMessage(tabId, { type: 'hiraishin-ping' });
      return reply?.ready === true;
    } catch {
      return false;
    }
  }

  return { platform, status, sync, injectExisting, pingTab };
}
