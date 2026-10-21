// Web shortcut listener (spec §6), plus the wheel's relay in embedded frames. Reads the published
// config only; it never reads page content. Classic content script, so the small combo helper is
// inlined here.
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
  const normalize = value => ({ keymap: value?.keymap ?? {}, disabledSites: Array.isArray(value?.disabledSites) ? value.disabledSites : [],
    overlay: value?.overlay ?? null });
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

  // The wheel lives in the top frame only (ui/overlay), but while the pointer is over an embedded
  // frame, or focus is inside one, the keys and moves of the gesture reach this frame alone. Here
  // they are recognised and handed over: a flick opens a port, the service worker passes it to the
  // top frame, and the top frame covers the page and takes the pointer from there. Only the
  // gesture's milestones cross; which sector runs is decided by the top frame's own pointer.
  if (window === window.top) return;
  /** Same distance as the top frame's FLICK_START (ui/overlay/main.tsx). */
  const FLICK_START = 6;
  const MODIFIER_KEYS = ['Meta', 'Alt', 'Control', 'Shift'];
  const MODIFIER_FLAGS = { Meta: 'metaKey', Alt: 'altKey', Control: 'ctrlKey', Shift: 'shiftKey' };
  /** Mirrors resolveHoldCode / isHoldKey / otherModifierDown in src/keys.js. */
  const holdCode = () => (!config.overlay?.holdCode || config.overlay.holdCode === 'auto' ? 'Alt' : config.overlay.holdCode);
  const isHold = (event, hold) => (MODIFIER_KEYS.includes(hold) ? event.key === hold : event.code === hold);
  const otherModifier = (event, hold) => (event.ctrlKey && hold !== 'Control') || (event.metaKey && hold !== 'Meta')
    || (event.altKey && hold !== 'Alt') || (event.shiftKey && hold !== 'Shift');
  const editable = () => {
    const node = /** @type {HTMLElement | null} */ (document.activeElement);
    return Boolean(node) && (node.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName));
  };
  const relayOn = () => Boolean(config.overlay?.enabled && chrome.runtime?.id);

  /** Screen coordinates, because the top frame cannot map this frame's own: a cross-origin parent
   *  does not reveal where the frame sits. Both frames share the screen. */
  let pointer = null;
  let armTimer = 0;
  let armed = false;
  let origin = null;
  /** Open from the flick until the release or cancel; closing it early tells the top frame. */
  let port = null;
  const disarm = () => { clearTimeout(armTimer); armTimer = 0; armed = false; origin = null; };
  const finish = kind => {
    const open = port;
    port = null;
    disarm();
    if (!open) return;
    try { open.postMessage({ kind }); open.disconnect(); } catch { /* the worker is gone; the top frame closes on the next move */ }
  };

  document.addEventListener('keydown', event => {
    if (!event.isTrusted || !relayOn()) return;
    const hold = holdCode();
    if (!isHold(event, hold)) {
      // Escape cancels like it does over the top frame; any other key is a real shortcut being typed.
      if (port && event.key === 'Escape') event.preventDefault();
      if (port) finish('cancel'); else disarm();
      return;
    }
    if (armed || armTimer || port || event.repeat) return;
    if (otherModifier(event, hold) || (!MODIFIER_KEYS.includes(hold) && editable())) return;
    const arm = () => { armTimer = 0; armed = true; origin = pointer; };
    if (config.overlay.holdMs > 0) armTimer = setTimeout(arm, config.overlay.holdMs);
    else arm();
  }, true);

  // Passive and cheap: every frame of every page runs this, and a move without the hold key down
  // only notes where the pointer is.
  document.addEventListener('mousemove', event => {
    if (!event.isTrusted || !relayOn()) return;
    pointer = { x: event.screenX, y: event.screenY };
    const hold = holdCode();
    const flag = MODIFIER_FLAGS[hold];
    // The modifier is up although no keyup arrived here (it went to the focused frame): the
    // gesture is over, whoever saw it end.
    if (flag && !event[flag]) { if (port) finish('cancel'); else if (armed) disarm(); return; }
    if (port) return;
    // A drag that began in this frame keeps the pointer captured here; the top frame could not
    // take it over, so the gesture does not start.
    if (event.buttons) { disarm(); return; }
    if (!armed) {
      // Focus may sit in another frame, which then gets the keydown: a held modifier still shows
      // on the move itself. A hold delay needs the keydown's time, so it only arms from there.
      if (!flag || otherModifier(event, hold) || config.overlay.holdMs > 0) return;
      armed = true;
      origin = pointer;
      return;
    }
    if (!origin) { origin = pointer; return; }
    if (Math.hypot(pointer.x - origin.x, pointer.y - origin.y) < FLICK_START) return;
    try { port = chrome.runtime.connect({ name: 'hiraishin-relay' }); } catch { disarm(); return; }
    port.onDisconnect.addListener(() => { port = null; disarm(); });
    port.postMessage({ kind: 'flick', screenX: origin.x, screenY: origin.y });
  }, { capture: true, passive: true });

  document.addEventListener('keyup', event => {
    if (!event.isTrusted || !relayOn() || !isHold(event, holdCode())) return;
    if (!port) { disarm(); return; }
    // Synchronously, here: on Windows and Linux the menu opens from the frame that sees Alt go up,
    // and waiting for the top frame's answer would be too late to stop it.
    event.preventDefault();
    finish('release');
  }, true);

  const leave = () => { pointer = null; if (port) finish('cancel'); else disarm(); };
  window.addEventListener('blur', leave);
  document.addEventListener('visibilitychange', () => { if (document.hidden) leave(); });
  document.addEventListener('mouseout', event => { if (!event.relatedTarget) pointer = null; }, { capture: true, passive: true });
})();
