// Keyboard combo helpers shared by the service worker, settings page and content scripts.
// Canonical form: modifiers in MODIFIER_ORDER joined by "+", followed by one key token,
// e.g. "Ctrl+Shift+Minus". "Ctrl" is the Windows / Linux Control key; on macOS the
// Command key is "Command" and the physical Control key is "MacCtrl", matching the
// vocabulary Chrome uses for extension commands.

export const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Command', 'MacCtrl'];
export const MODIFIER_KEYS = ['Meta', 'Alt', 'Control', 'Shift'];
const MODIFIERS = new Set(MODIFIER_ORDER);

const MODIFIER_ALIASES = {
  ctrl: 'Ctrl', control: 'Ctrl', '⌃': 'MacCtrl', macctrl: 'MacCtrl',
  alt: 'Alt', option: 'Alt', '⌥': 'Alt',
  shift: 'Shift', '⇧': 'Shift',
  command: 'Command', cmd: 'Command', meta: 'Command', '⌘': 'Command',
};

const KEY_ALIASES = {
  ',': 'Comma', comma: 'Comma', '.': 'Period', period: 'Period', '-': 'Minus', minus: 'Minus',
  '−': 'Minus', '=': 'Equal', equal: 'Equal', '/': 'Slash', slash: 'Slash', '\\': 'Backslash',
  backslash: 'Backslash', ';': 'Semicolon', semicolon: 'Semicolon', "'": 'Quote', quote: 'Quote',
  '[': 'BracketLeft', bracketleft: 'BracketLeft', ']': 'BracketRight', bracketright: 'BracketRight',
  '`': 'Backquote', backquote: 'Backquote', space: 'Space', ' ': 'Space',
  up: 'Up', arrowup: 'Up', '↑': 'Up', down: 'Down', arrowdown: 'Down', '↓': 'Down',
  left: 'Left', arrowleft: 'Left', '←': 'Left', right: 'Right', arrowright: 'Right', '→': 'Right',
  home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', insert: 'Insert', ins: 'Insert',
  delete: 'Delete', del: 'Delete', enter: 'Enter', return: 'Enter', backspace: 'Backspace', tab: 'Tab',
  medianexttrack: 'MediaNextTrack', mediaplaypause: 'MediaPlayPause', mediaprevtrack: 'MediaPrevTrack',
  mediastop: 'MediaStop',
};

// Keys Chrome accepts for native extension commands.
const NATIVE_KEYS = new Set([
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 'Comma', 'Period', 'Home', 'End', 'PageUp', 'PageDown',
  'Space', 'Insert', 'Delete', 'Up', 'Down', 'Left', 'Right',
  'MediaNextTrack', 'MediaPlayPause', 'MediaPrevTrack', 'MediaStop',
]);

const DISPLAY_KEYS = {
  Comma: ',', Period: '.', Minus: '-', Equal: '=', Slash: '/', Backslash: '\\', Semicolon: ';',
  Quote: "'", BracketLeft: '[', BracketRight: ']', Backquote: '`', Space: 'Space',
  Up: '↑', Down: '↓', Left: '←', Right: '→',
};

/** @param {string} code KeyboardEvent.code */
export function tokenFromCode(code) {
  if (typeof code !== 'string') return null;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^(Digit|Numpad)[0-9]$/.test(code)) return code.slice(-1);
  if (code === 'NumpadSubtract') return 'Minus';
  if (/^F([1-9]|1[0-2])$/.test(code)) return code;
  if (code === 'NumpadEnter') return 'Enter';
  return KEY_ALIASES[code.toLowerCase()] ?? null;
}

function normalizeKeyToken(token) {
  const trimmed = token.trim();
  if (!trimmed) return null;
  if (/^[a-z]$/i.test(trimmed)) return trimmed.toUpperCase();
  if (/^[0-9]$/.test(trimmed)) return trimmed;
  if (/^F([1-9]|1[0-2])$/i.test(trimmed)) return trimmed.toUpperCase();
  return KEY_ALIASES[trimmed.toLowerCase()] ?? null;
}

/**
 * Parse a combo written in any of the accepted spellings. Returns null for unusable input.
 * @param {string} text
 * @returns {{ modifiers: string[], key: string } | null}
 */
export function parseCombo(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  let parts;
  if (text.includes('+')) {
    // A trailing "+" would be the Equal key spelled as a symbol; keep it simple and reject.
    parts = text.split('+').map(part => part.trim());
    if (parts.some(part => part === '')) return null;
  } else {
    // Symbol style such as "⌃⌘," where modifiers are glyphs followed by the key.
    parts = [];
    let rest = text.trim();
    while (rest && MODIFIER_ALIASES[rest[0]]) { parts.push(rest[0]); rest = rest.slice(1); }
    if (rest) parts.push(rest);
  }
  const modifiers = new Set();
  let key = null;
  for (const part of parts) {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()];
    if (modifier) { modifiers.add(modifier); continue; }
    if (key !== null) return null;
    key = normalizeKeyToken(part);
    if (key === null) return null;
  }
  if (key === null) return null;
  return { modifiers: MODIFIER_ORDER.filter(item => modifiers.has(item)), key };
}

/** @param {{ modifiers: string[], key: string } | null} parsed */
export function canonical(parsed) {
  if (!parsed) return '';
  return [...MODIFIER_ORDER.filter(item => parsed.modifiers.includes(item)), parsed.key].join('+');
}

/** Canonical combo string or "" for unusable input. */
export function normalizeCombo(text) {
  return canonical(parseCombo(text));
}

/**
 * Chrome reports native bindings in manifest vocabulary, where "Ctrl" means Command on macOS.
 * Convert to the canonical device-specific form so it can be compared with web combos.
 */
export function normalizeNative(shortcut, platform) {
  const parsed = parseCombo(shortcut);
  if (!parsed) return '';
  if (platform === 'mac') {
    parsed.modifiers = parsed.modifiers.map(item => (item === 'Ctrl' ? 'Command' : item));
    parsed.modifiers = MODIFIER_ORDER.filter(item => parsed.modifiers.includes(item));
  }
  return canonical(parsed);
}

/** Canonical combo for a keyboard event, or null when no key token or primary modifier. */
export function comboFromEvent(event, platform) {
  const key = tokenFromCode(event.code);
  if (!key) return null;
  const modifiers = [];
  if (platform === 'mac') {
    if (event.metaKey) modifiers.push('Command');
    if (event.ctrlKey) modifiers.push('MacCtrl');
  } else if (event.ctrlKey || event.metaKey) {
    modifiers.push('Ctrl');
  }
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  const combo = canonical({ modifiers, key });
  return webEligible(combo) ? combo : null;
}

/** Whether a combo can be a Chrome native command on this platform. */
export function nativeEligible(combo, platform) {
  const parsed = parseCombo(combo);
  if (!parsed || !NATIVE_KEYS.has(parsed.key)) return false;
  const primary = parsed.modifiers.filter(item => item !== 'Shift');
  if (primary.length !== 1) return false;
  const allowed = platform === 'mac' ? ['Command', 'MacCtrl', 'Alt'] : ['Ctrl', 'Alt'];
  return allowed.includes(primary[0]);
}

/** Whether a combo has a real key and at least one non-Shift modifier. */
export function webEligible(combo) {
  const parsed = parseCombo(combo);
  if (!parsed) return false;
  return parsed.modifiers.some(item => item !== 'Shift' && MODIFIERS.has(item));
}

/** Human-readable label for the settings page and panel. */
export function displayCombo(combo, platform) {
  const parsed = parseCombo(combo);
  if (!parsed) return '';
  const key = DISPLAY_KEYS[parsed.key] ?? parsed.key;
  if (platform === 'mac') {
    const glyphs = { MacCtrl: '⌃', Alt: '⌥', Shift: '⇧', Command: '⌘', Ctrl: '⌘' };
    return ['MacCtrl', 'Alt', 'Shift', 'Command', 'Ctrl'].filter(item => parsed.modifiers.includes(item))
      .map(item => glyphs[item]).join('') + key;
  }
  return [...parsed.modifiers, key].join('+');
}

// Combos the browser or OS handles before any page or extension sees them. Web shortcuts
// bound to these never fire; native commands cannot use most of them either.
const RESERVED = {
  common: ['Ctrl+T', 'Ctrl+N', 'Ctrl+W', 'Ctrl+Shift+T', 'Ctrl+Shift+N', 'Ctrl+Shift+W', 'Ctrl+Tab', 'Ctrl+Shift+Tab', 'Ctrl+L', 'Ctrl+F',
    'Ctrl+H', 'Ctrl+J', 'Ctrl+D', 'Ctrl+Shift+B', 'Ctrl+Shift+O', 'Ctrl+Shift+Delete', 'Ctrl+1', 'Ctrl+2', 'Ctrl+3', 'Ctrl+4', 'Ctrl+5',
    'Ctrl+6', 'Ctrl+7', 'Ctrl+8', 'Ctrl+9', 'Ctrl+PageUp', 'Ctrl+PageDown', 'Alt+F4', 'Alt+Left', 'Alt+Right', 'Alt+Home', 'Alt+D', 'Alt+F', 'Alt+E'],
  mac: ['Command+T', 'Command+N', 'Command+W', 'Shift+Command+T', 'Shift+Command+N', 'Shift+Command+W', 'Command+Q', 'Command+H', 'Command+M',
    'Command+L', 'Command+F', 'Command+Y', 'Command+D', 'Alt+Command+B', 'Shift+Command+B', 'Command+Comma', 'Command+Space', 'MacCtrl+Space',
    'Command+Tab', 'Shift+Command+Tab', 'Alt+Command+Left', 'Alt+Command+Right', 'Command+1', 'Command+2', 'Command+3', 'Command+4',
    'Command+5', 'Command+6', 'Command+7', 'Command+8', 'Command+9', 'MacCtrl+Up', 'MacCtrl+Down', 'MacCtrl+Left', 'MacCtrl+Right'],
};

/** Human-readable reason when a combo is known to be taken by the browser or OS, else "". */
export function reservedReason(combo, platform) {
  const normalized = normalizeCombo(combo);
  if (!normalized) return '';
  const list = platform === 'mac' ? RESERVED.mac : RESERVED.common;
  if (list.includes(normalized)) return platform === 'mac' ? '这是 macOS 或 Chrome 的保留组合，网页收不到该按键。' : '这是 Chrome 的保留组合，网页收不到该按键。';
  return '';
}

/** Option on macOS and Alt elsewhere share the DOM key `Alt`. Keep explicit choices intact. */
export function resolveHoldCode(code, platform) {
  return code === 'auto' ? 'Alt' : code;
}

/** Show a hold key the way its key cap reads. */
export function holdKeyLabel(code, platform) {
  const resolved = resolveHoldCode(code, platform);
  if (/^Key[A-Z]$/.test(resolved)) return resolved.slice(3);
  if (/^Digit[0-9]$/.test(resolved)) return resolved.slice(-1);
  const mac = platform === 'mac';
  return { Meta: mac ? '⌘ Command' : 'Win', Alt: mac ? '⌥ Option' : 'Alt',
    Control: mac ? '⌃ Control' : 'Ctrl', Shift: mac ? '⇧ Shift' : 'Shift' }[resolved] ?? resolved;
}

/** True when this keyboard event is the hold key itself (either side of a modifier counts). */
export function isHoldKey(event, resolved) {
  return MODIFIER_KEYS.includes(resolved) ? event.key === resolved : event.code === resolved;
}

/** True when a modifier other than the hold key is down, which means the user is building a real
 *  shortcut rather than holding the gesture key alone. */
export function otherModifierDown(event, resolved) {
  return (event.ctrlKey && resolved !== 'Control') || (event.metaKey && resolved !== 'Meta')
    || (event.altKey && resolved !== 'Alt') || (event.shiftKey && resolved !== 'Shift');
}
