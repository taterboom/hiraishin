// Web shortcut listener (spec §6). Reads the published keymap only; it never reads page
// content. Classic content script, so the small combo helper is inlined here.
(() => {
  if (globalThis.__hiraishinShortcuts) return;
  globalThis.__hiraishinShortcuts = true;
  const platform = /Mac|iPhone|iPad/.test(navigator.platform) ? 'mac' : 'other';
  let config = { keymap: {}, disabledSites: [] };
  let pending = false;

  const ALIASES = { Comma: 'Comma', Period: 'Period', Minus: 'Minus', NumpadSubtract: 'Minus', Equal: 'Equal', Slash: 'Slash',
    Backslash: 'Backslash', Semicolon: 'Semicolon', Quote: 'Quote', BracketLeft: 'BracketLeft', BracketRight: 'BracketRight',
    Backquote: 'Backquote', Space: 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert', Delete: 'Delete', Enter: 'Enter',
    NumpadEnter: 'Enter', Backspace: 'Backspace', Tab: 'Tab' };
  const token = code => {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^(Digit|Numpad)[0-9]$/.test(code)) return code.slice(-1);
    if (/^F([1-9]|1[0-2])$/.test(code)) return code;
    return ALIASES[code] ?? null;
  };
  const combo = event => {
    const key = token(event.code);
    if (!key) return null;
    const mods = [];
    if (platform === 'mac') { if (event.metaKey) mods.push('Command'); if (event.ctrlKey) mods.push('MacCtrl'); }
    else if (event.ctrlKey || event.metaKey) mods.push('Ctrl');
    if (event.altKey) mods.push('Alt');
    if (event.shiftKey) mods.push('Shift');
    if (!mods.some(item => item !== 'Shift')) return null;
    const order = ['Ctrl', 'Alt', 'Shift', 'Command', 'MacCtrl'];
    return [...order.filter(item => mods.includes(item)), key].join('+');
  };
  const normalize = value => ({ keymap: value?.keymap ?? {}, disabledSites: Array.isArray(value?.disabledSites) ? value.disabledSites : [] });
  const siteHost = () => {
    try { return window.top.location.hostname; } catch {
      const origins = location.ancestorOrigins;
      try { return origins && origins.length ? new URL(origins[origins.length - 1]).hostname : location.hostname; } catch { return location.hostname; }
    }
  };
  const disabledHere = () => config.disabledSites.includes(siteHost().toLowerCase());
  const active = () => Object.keys(config.keymap).length > 0 && !disabledHere();

  const onKey = event => {
    if (!chrome.runtime?.id) { document.removeEventListener('keydown', onKey, true); return; }
    if (!event.isTrusted || event.isComposing || !active()) return;
    const id = combo(event);
    const binding = id && config.keymap[id];
    if (!binding) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const allowRepeat = binding.repeat === 'allow';
    if ((pending || event.repeat) && !allowRepeat) return;
    if (pending) return;
    pending = true;
    chrome.runtime.sendMessage({ type: 'web-shortcut', actionId: binding.id, combo: id })
      .catch(() => {})
      .finally(() => { pending = false; });
  };

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.pageConfig) config = normalize(changes.pageConfig.newValue);
  });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type === 'hiraishin-ping' && window === window.top) respond({ ready: true, active: active() });
  });
  chrome.storage.local.get('pageConfig').then(result => { config = normalize(result.pageConfig); }).catch(() => {});
  document.addEventListener('keydown', onKey, true);
})();
