import { normalizeCombo } from './keys.js';
import { BUILTIN_TARGETS } from './targets.js';

export const SETTINGS_VERSION = 4;
export const SETTINGS_KEY = 'settings';
export const PAGE_ORIGINS = ['http://*/*', 'https://*/*'];
export const TARGET_CAPABILITIES = ['navigate', 'fill', 'send'];
/** The gesture arms on a modifier held alone (either side counts) or a
 *  single character key. Letters are allowed because the gesture is suppressed while an editable
 *  element has focus, so holding the key never swallows typing.
 *  `auto` uses Option on macOS and Alt elsewhere, leaving Command available for common shortcuts. */
export const OVERLAY_HOLD_MODIFIERS = ['Meta', 'Alt', 'Control', 'Shift'];
export const isOverlayHoldCode = code => typeof code === 'string'
  && (code === 'auto' || OVERLAY_HOLD_MODIFIERS.includes(code) || /^(Key[A-Z]|Digit[0-9])$/.test(code));
/** The wheel is divided into this many equal sectors; the slot array's length picks one. */
export const OVERLAY_SECTORS = [4, 6, 8, 12];
export const DEFAULT_PINNED = [
  'history-back', 'history-forward', 'switch-previous-tab', 'close-right',
  'duplicate-tab', 'send-default-target',
];
const MINUS_BINDINGS = { 'history-back': 'Ctrl+Minus', 'history-forward': 'Ctrl+Shift+Minus' };

/**
 * @typedef {{ id: string, name: string, match: string[], openUrl: string,
 *   capability: 'navigate' | 'fill' | 'send', selectors: { input: string, submit: string } }} CustomTarget
 * @typedef {{ version: number, returnAfterSend: boolean,
 *   defaultTargetId: string, pinnedActions: string[],
 *   webShortcuts: { bindings: Record<string, string>, disabledSites: string[] },
 *   overlay: { enabled: boolean, holdCode: string, holdMs: number, slots: (string | null)[] },
 *   targets: { enabled: Record<string, 'navigate' | 'fill' | 'send'>, custom: CustomTarget[] } }} Settings
 */

/** @returns {Settings} */
export function defaultSettings() {
  return {
    version: SETTINGS_VERSION,
    returnAfterSend: false,
    defaultTargetId: BUILTIN_TARGETS[0].id,
    pinnedActions: [...DEFAULT_PINNED],
    webShortcuts: { bindings: {}, disabledSites: [] },
    // Hold Option / Alt and flick towards a sector to pick it, release to run. holdMs is an
    // optional delay before arming; the default is immediate, with movement revealing the wheel.
    // Slots are the sectors clockwise from twelve o'clock; an empty one draws a blank sector.
    // In editable elements, only modifier triggers may arm; character triggers stay disabled.
    overlay: { enabled: true, holdCode: 'auto', holdMs: 0, slots: [...DEFAULT_PINNED] },
    targets: { enabled: /** @type {Record<string, 'navigate' | 'fill' | 'send'>} */ (
      Object.fromEntries(BUILTIN_TARGETS.map(target => [target.id, target.capability]))), custom: [] },
  };
}

const isString = value => typeof value === 'string';
const stringList = value => (Array.isArray(value) ? value.filter(isString).map(item => item.trim()).filter(Boolean) : []);

export function isHttpUrl(value) {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
}

export function sanitizeCustomTarget(raw) {
  if (!raw || typeof raw !== 'object' || !isString(raw.id) || !/^[a-z0-9-]{1,40}$/.test(raw.id)) return null;
  if (!isString(raw.openUrl) || !isHttpUrl(raw.openUrl.trim())) return null;
  const openUrl = raw.openUrl.trim();
  const match = stringList(raw.match).filter(isHttpUrl);
  return {
    id: raw.id,
    name: isString(raw.name) && raw.name.trim() ? raw.name.trim().slice(0, 40) : new URL(openUrl).hostname,
    match: match.length ? match : [`${new URL(openUrl).origin}/*`],
    openUrl,
    capability: TARGET_CAPABILITIES.includes(raw.capability) ? raw.capability : 'navigate',
    selectors: {
      input: isString(raw.selectors?.input) ? raw.selectors.input.trim() : '',
      submit: isString(raw.selectors?.submit) ? raw.selectors.submit.trim() : '',
    },
  };
}

/** Accept any stored shape, including the v1 prototype's `{ minusShortcuts }`. */
export function normalizeSettings(raw) {
  const settings = defaultSettings();
  if (!raw || typeof raw !== 'object') return settings;
  if (raw.version === undefined && raw.minusShortcuts === true) {
    settings.webShortcuts.bindings = { ...MINUS_BINDINGS };
    return settings;
  }
  if (typeof raw.returnAfterSend === 'boolean') settings.returnAfterSend = raw.returnAfterSend;
  if (isString(raw.defaultTargetId) && raw.defaultTargetId) settings.defaultTargetId = raw.defaultTargetId;
  if (Array.isArray(raw.pinnedActions)) settings.pinnedActions = [...new Set(stringList(raw.pinnedActions))];
  const bindings = raw.webShortcuts?.bindings;
  if (bindings && typeof bindings === 'object') {
    settings.webShortcuts.bindings = {};
    for (const [actionId, combo] of Object.entries(bindings)) {
      const normalized = normalizeCombo(combo);
      if (isString(actionId) && normalized) settings.webShortcuts.bindings[actionId] = normalized;
    }
  }
  settings.webShortcuts.disabledSites = [...new Set(stringList(raw.webShortcuts?.disabledSites).map(site => site.toLowerCase()))];
  if (typeof raw.overlay?.enabled === 'boolean') settings.overlay.enabled = raw.overlay.enabled;
  if (isOverlayHoldCode(raw.overlay?.holdCode)) settings.overlay.holdCode = raw.overlay.holdCode;
  if (Number.isFinite(raw.overlay?.holdMs)) settings.overlay.holdMs = Math.min(Math.max(Math.round(raw.overlay.holdMs), 0), 1500);
  // v2 shipped a letter (Z) as the only hold key; v3 hands that choice back to the platform.
  if (Number(raw.version) < 3 && raw.overlay?.holdCode === 'KeyZ') settings.overlay.holdCode = 'auto';
  if (Array.isArray(raw.overlay?.slots)) {
    const slots = raw.overlay.slots.map(slot => (isString(slot) && slot ? slot : null));
    // The length is the sector count, so it has to be one of the shapes the wheel can draw.
    const size = OVERLAY_SECTORS.includes(slots.length) ? slots.length
      : OVERLAY_SECTORS.reduce((best, n) => (Math.abs(n - slots.length) < Math.abs(best - slots.length) ? n : best));
    settings.overlay.slots = Array.from({ length: size }, (_, index) => slots[index] ?? null);
  } else if (Number(raw.version) < 4 && Array.isArray(raw.pinnedActions)) {
    // v3 drew the pinned actions as a grid; the wheel starts from that same list.
    const pinned = stringList(raw.pinnedActions).slice(0, 8);
    const size = OVERLAY_SECTORS.find(n => n >= pinned.length) ?? 12;
    settings.overlay.slots = Array.from({ length: size }, (_, index) => pinned[index] ?? null);
  }
  const enabled = raw.targets?.enabled;
  if (enabled && typeof enabled === 'object') {
    for (const [id, level] of Object.entries(enabled)) {
      if (TARGET_CAPABILITIES.includes(level)) settings.targets.enabled[id] = level;
    }
  }
  if (Array.isArray(raw.targets?.custom)) {
    const seen = new Set();
    settings.targets.custom = raw.targets.custom.map(sanitizeCustomTarget).filter(target => {
      if (!target || seen.has(target.id)) return false;
      seen.add(target.id);
      return true;
    });
  }
  const knownTargets = [...BUILTIN_TARGETS.map(target => target.id), ...settings.targets.custom.map(target => target.id)];
  if (!knownTargets.includes(settings.defaultTargetId)) settings.defaultTargetId = BUILTIN_TARGETS[0].id;
  return settings;
}

const isLegacy = raw => raw && typeof raw === 'object' && raw.version === undefined && 'minusShortcuts' in raw;

/** Storage wrapper so every reader sees the same normalized shape. */
export function createSettingsStore(api) {
  return {
    async get() {
      const saved = await api.storage.local.get(SETTINGS_KEY);
      const raw = saved[SETTINGS_KEY];
      if (!isLegacy(raw)) return normalizeSettings(raw);
      // v1 stored a boolean; its listener keyed on the physical Control key, which is "MacCtrl" on macOS.
      const settings = normalizeSettings(raw);
      const os = (await Promise.resolve(api.runtime?.getPlatformInfo?.()).catch(() => null))?.os;
      if (os === 'mac') {
        for (const [id, combo] of Object.entries(settings.webShortcuts.bindings)) settings.webShortcuts.bindings[id] = combo.replace(/^Ctrl\+/, 'MacCtrl+');
      }
      await api.storage.local.set({ [SETTINGS_KEY]: settings });
      return settings;
    },
    async set(settings) {
      const normalized = normalizeSettings(settings);
      await api.storage.local.set({ [SETTINGS_KEY]: normalized });
      return normalized;
    },
    async update(mutate) {
      const current = await this.get();
      const next = mutate(structuredClone(current)) ?? current;
      return this.set(next);
    },
  };
}
