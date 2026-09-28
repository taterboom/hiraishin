// Runs inside a target page (ChatGPT, Claude or a custom site) in the extension's isolated
// world. The service worker injects this file, then calls globalThis.__hiraishinAdapter.run().
// Selectors reflect the sites as last observed and must be re-checked against live pages
// (spec §8.4, R13). Every op reports observable facts only: "filled", "submitted" and
// "uncertain" are distinct outcomes.
(() => {
  if (globalThis.__hiraishinAdapter) return;

  const PROFILES = {
    claude: {
      input: ['div.ProseMirror[contenteditable="true"]', 'fieldset [contenteditable="true"]', '[contenteditable="true"][data-placeholder]', 'textarea'],
      send: ['button[aria-label="Send message"]', 'button[aria-label="Send Message"]'],
      stop: ['button[aria-label="Stop response"]', 'button[aria-label="Stop Response"]'],
      userMessage: ['[data-testid="user-message"]', '.font-user-message'],
      loginPaths: ['/login', '/magic-link'],
      loginMarkers: [],
    },
    chatgpt: {
      input: ['#prompt-textarea', 'div[contenteditable="true"][data-placeholder]', 'textarea[data-id]'],
      send: ['button[data-testid="send-button"]', 'button[aria-label="Send prompt"]'],
      stop: ['button[data-testid="stop-button"]', 'button[aria-label="Stop streaming"]', 'button[aria-label="Stop generating"]'],
      userMessage: ['[data-message-author-role="user"]'],
      loginPaths: ['/auth'],
      loginMarkers: ['[data-testid="login-button"]', '[data-testid="welcome-login-button"]'],
    },
  };

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const compact = text => String(text ?? '').replace(/\s+/g, '');

  function profileFor(payload) {
    if (PROFILES[payload.site]) return PROFILES[payload.site];
    const input = payload.selectors?.input ? [payload.selectors.input] : ['textarea', '[contenteditable="true"]'];
    const send = payload.selectors?.submit ? [payload.selectors.submit] : [];
    return { input, send, stop: [], userMessage: [], loginPaths: [], loginMarkers: [] };
  }

  function visible(element) {
    if (!element || !(element instanceof Element)) return false;
    if (element.closest('[hidden], [aria-hidden="true"]')) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function findFirst(selectors) {
    for (const selector of selectors) {
      try {
        for (const element of document.querySelectorAll(selector)) if (visible(element)) return element;
      } catch {
        // Invalid custom selector: skip it.
      }
    }
    return null;
  }

  const isField = element => element.tagName === 'TEXTAREA' || element.tagName === 'INPUT';
  const readText = element => (isField(element) ? element.value : element.innerText ?? element.textContent ?? '').replace(/\n+$/, '');
  const countUserMessages = profile => profile.userMessage.reduce((total, selector) => {
    try { return total + document.querySelectorAll(selector).length; } catch { return total; }
  }, 0);

  function setFieldValue(element, value) {
    const proto = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(element, value); else element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function placeCaretAtEnd(element) {
    element.focus();
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function insertIntoEditable(element, text) {
    placeCaretAtEnd(element);
    const before = compact(readText(element));
    const contains = () => compact(readText(element)).includes(compact(text).slice(0, 200));
    if (document.execCommand('insertText', false, text) && contains()) return true;
    if (compact(readText(element)) !== before) return contains();
    // Rich editors that ignore execCommand usually accept a synthetic paste.
    try {
      const data = new DataTransfer();
      data.setData('text/plain', text);
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    } catch {
      // DataTransfer construction unavailable; fall through.
    }
    return contains();
  }

  async function probe(payload) {
    const profile = profileFor(payload);
    const input = findFirst(profile.input);
    const path = location.pathname;
    const loginPage = profile.loginPaths.some(prefix => path.startsWith(prefix)) || findFirst(profile.loginMarkers) !== null;
    if (!input && loginPage) return { state: 'login', draft: '' };
    if (!input) return { state: 'missing', draft: '' };
    if (findFirst(profile.stop)) return { state: 'generating', draft: readText(input) };
    return { state: 'ready', draft: readText(input) };
  }

  async function fill(payload) {
    const profile = profileFor(payload);
    const input = findFirst(profile.input);
    if (!input) return { ok: false, reason: 'missing' };
    const existing = readText(input);
    const text = existing.trim() && payload.mode === 'append' ? `\n\n${payload.text}` : payload.text;
    let ok;
    if (isField(input)) {
      setFieldValue(input, existing.trim() && payload.mode === 'append' ? existing + text : payload.text);
      ok = compact(readText(input)).includes(compact(payload.text).slice(0, 200));
    } else {
      ok = insertIntoEditable(input, text);
    }
    return { ok, value: readText(input) };
  }

  async function submit(payload) {
    const profile = profileFor(payload);
    const input = findFirst(profile.input);
    if (!input) return { submitted: false, reason: 'missing' };
    const before = countUserMessages(profile);
    // Editors enable their send button asynchronously after text is inserted; give them a moment.
    const isDisabled = element => element.disabled || element.getAttribute('aria-disabled') === 'true';
    let button = findFirst(profile.send);
    const waitStart = Date.now();
    while (button && isDisabled(button) && Date.now() - waitStart < (payload.enableTimeoutMs ?? 1500)) {
      await sleep(100);
      button = findFirst(profile.send) ?? button;
    }
    if (button && isDisabled(button)) return { submitted: false, reason: 'send-disabled' };
    if (button) {
      button.click();
    } else {
      input.focus();
      for (const type of ['keydown', 'keypress', 'keyup']) {
        input.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      }
    }
    const started = Date.now();
    while (Date.now() - started < (payload.timeoutMs ?? 8000)) {
      await sleep(150);
      if (countUserMessages(profile) > before) return { submitted: true, evidence: 'message-appeared' };
      const cleared = !readText(input).trim();
      if (cleared && (findFirst(profile.stop) || Date.now() - started > 600)) return { submitted: true, evidence: 'editor-cleared' };
    }
    return { submitted: 'uncertain', reason: 'no-evidence' };
  }

  async function focus(payload) {
    const input = findFirst(profileFor(payload).input);
    if (!input) return { ok: false };
    placeCaretAtEnd(input);
    return { ok: true };
  }

  const ops = { probe, fill, submit, focus };
  globalThis.__hiraishinAdapter = {
    async run(op, payload = {}) {
      if (!ops[op]) return { error: `unknown op ${op}` };
      try { return await ops[op](payload); } catch (error) { return { error: error?.message || String(error) }; }
    },
  };
})();
