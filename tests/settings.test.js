import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings, defaultSettings, DEFAULT_PINNED, createSettingsStore, SETTINGS_KEY } from '../src/settings.js';
import { createFakeChrome } from './fake-chrome.js';
import { holdKeyLabel, isHoldKey, otherModifierDown, resolveHoldCode } from '../src/keys.js';

test('the v1 minus toggle migrates into two web bindings', () => {
  const settings = normalizeSettings({ minusShortcuts: true });
  assert.deepEqual(settings.webShortcuts.bindings, { 'history-back': 'Ctrl+Minus', 'history-forward': 'Ctrl+Shift+Minus' });
  assert.deepEqual(normalizeSettings({ minusShortcuts: false }), defaultSettings());
  assert.deepEqual(normalizeSettings(undefined).pinnedActions, DEFAULT_PINNED);
});

test('stored values are validated field by field', () => {
  const settings = normalizeSettings({
    version: 2, returnAfterSend: 'yes', floatingButton: true, defaultTargetId: '',
    pinnedActions: ['close-right', 'close-right', 7],
    webShortcuts: { bindings: { 'close-right': 'ctrl+shift+w', bad: '', 'history-back': 'nope' }, disabledSites: ['Docs.Google.com', ''] },
    targets: { enabled: { chatgpt: 'fill', claude: 'bogus' }, custom: [
      { id: 'notes', name: ' Notes ', openUrl: 'https://notes.example/new', match: ['https://notes.example/*'], capability: 'fill', selectors: { input: ' textarea ' } },
      { id: 'notes', name: 'dup', openUrl: 'https://notes.example/' },
      { id: 'Bad Id', openUrl: 'https://x.y' },
      { id: 'ftp', openUrl: 'ftp://x.y' },
    ] },
  });
  assert.equal(settings.returnAfterSend, false);
  assert.equal('floatingButton' in settings, false, 'retired selection-button preference is discarded');
  assert.equal(settings.defaultTargetId, 'chatgpt');
  assert.deepEqual(settings.pinnedActions, ['close-right']);
  assert.deepEqual(settings.webShortcuts.bindings, { 'close-right': 'Ctrl+Shift+W' });
  assert.deepEqual(settings.webShortcuts.disabledSites, ['docs.google.com']);
  assert.deepEqual(settings.targets.enabled, { chatgpt: 'fill', claude: 'send' });
  assert.deepEqual(settings.targets.custom, [{
    id: 'notes', name: 'Notes', match: ['https://notes.example/*'], openUrl: 'https://notes.example/new',
    capability: 'fill', selectors: { input: 'textarea', submit: '' },
  }]);
});

test('an unknown default target falls back to the first built-in', () => {
  assert.equal(normalizeSettings({ version: 2, defaultTargetId: 'gone' }).defaultTargetId, 'chatgpt', 'falls back to the first built-in target');
  const custom = normalizeSettings({ version: 2, defaultTargetId: 'w', targets: { custom: [{ id: 'w', openUrl: 'https://w.example/' }] } });
  assert.equal(custom.defaultTargetId, 'w');
});

test('the store migrates v1 minus bindings to the physical Control key on macOS and persists v2', async () => {
  const mac = createFakeChrome({ platform: 'mac', local: { [SETTINGS_KEY]: { minusShortcuts: true } } });
  const settings = await createSettingsStore(mac.api).get();
  assert.deepEqual(settings.webShortcuts.bindings, { 'history-back': 'MacCtrl+Minus', 'history-forward': 'MacCtrl+Shift+Minus' });
  assert.equal(mac.data.local[SETTINGS_KEY].version, 4, 'written back so migration runs once');
  const win = createFakeChrome({ platform: 'win', local: { [SETTINGS_KEY]: { minusShortcuts: true } } });
  assert.deepEqual((await createSettingsStore(win.api).get()).webShortcuts.bindings, { 'history-back': 'Ctrl+Minus', 'history-forward': 'Ctrl+Shift+Minus' });
});

test('a custom target without match patterns defaults to its origin', () => {
  const [target] = normalizeSettings({ version: 2, targets: { custom: [{ id: 'w', openUrl: 'https://w.example/path?x=1' }] } }).targets.custom;
  assert.deepEqual(target.match, ['https://w.example/*']);
  assert.equal(target.name, 'w.example');
  assert.equal(target.capability, 'navigate');
});

test('the overlay hold key accepts a modifier, resolves per platform, and migrates away from Z', () => {
  assert.equal(defaultSettings().overlay.enabled, true, 'new installs enable the wheel by default');
  assert.equal(normalizeSettings({}).overlay.enabled, true, 'missing preferences use the default');
  assert.equal(normalizeSettings({ version: 4, overlay: { enabled: false } }).overlay.enabled, false,
    'a saved opt-out survives normalization');
  assert.equal(defaultSettings().overlay.holdCode, 'auto', 'no one key is usable on every platform');
  assert.equal(resolveHoldCode('auto', 'mac'), 'Alt');
  assert.equal(resolveHoldCode('auto', 'win'), 'Alt', 'the Windows key is claimed by the OS');
  assert.equal(resolveHoldCode('KeyZ', 'mac'), 'KeyZ', 'an explicit choice is kept as is');
  assert.equal(normalizeSettings({ version: 3, overlay: { holdCode: 'Meta' } }).overlay.holdCode, 'Meta');
  assert.equal(normalizeSettings({ version: 3, overlay: { holdCode: 'MetaLeft' } }).overlay.holdCode, 'auto',
    'sides are not stored: either Command key arms the gesture');
  assert.equal(normalizeSettings({ version: 2, overlay: { holdCode: 'KeyZ' } }).overlay.holdCode, 'auto',
    'v2 shipped Z as the only hold key');
  assert.equal(normalizeSettings({ version: 3, overlay: { holdCode: 'KeyZ' } }).overlay.holdCode, 'KeyZ',
    'but a later explicit Z stays');
});

test('the hold key reads as its key cap and matches either side of a modifier', () => {
  assert.equal(holdKeyLabel('auto', 'mac'), '⌥ Option');
  assert.equal(holdKeyLabel('auto', 'win'), 'Alt');
  assert.equal(holdKeyLabel('KeyZ', 'mac'), 'Z');
  assert.ok(isHoldKey({ key: 'Meta', code: 'MetaRight' }, 'Meta'), 'the right Command key counts too');
  assert.ok(!isHoldKey({ key: 'Alt', code: 'AltLeft' }, 'Meta'));
  assert.ok(isHoldKey({ key: 'z', code: 'KeyZ' }, 'KeyZ'));
  // Holding Command alone must arm; Command with Shift is the start of a real shortcut.
  assert.ok(!otherModifierDown({ metaKey: true }, 'Meta'));
  assert.ok(otherModifierDown({ metaKey: true, shiftKey: true }, 'Meta'));
});

test('the wheel slots decide the sector count and carry over from the pinned actions', () => {
  assert.deepEqual(defaultSettings().overlay.slots, DEFAULT_PINNED, 'the wheel starts from the pinned six');
  const eight = normalizeSettings({ version: 4, overlay: { slots: ['history-back', null, null, null, 'duplicate-tab', null, null, null] } });
  assert.equal(eight.overlay.slots.length, 8, 'the array length is the sector count');
  assert.equal(eight.overlay.slots[4], 'duplicate-tab');
  // A length the wheel cannot draw snaps to the nearest one it can, keeping what still fits.
  const odd = normalizeSettings({ version: 4, overlay: { slots: ['a', 'b', 'c', 'd', 'e'] } });
  assert.equal(odd.overlay.slots.length, 4);
  assert.deepEqual(odd.overlay.slots, ['a', 'b', 'c', 'd']);
  assert.deepEqual(normalizeSettings({ version: 4, overlay: { slots: ['a', 7, '', null] } }).overlay.slots,
    ['a', null, null, null], 'anything that is not an id reads as an empty sector');
  // v3 drew the pinned actions as a grid, so the wheel inherits that list on upgrade.
  const upgraded = normalizeSettings({ version: 3, pinnedActions: ['history-back', 'duplicate-tab', 'close-right'] });
  assert.deepEqual(upgraded.overlay.slots, ['history-back', 'duplicate-tab', 'close-right', null]);
});
