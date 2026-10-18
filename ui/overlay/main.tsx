// Hold the configured key (Option on macOS, Alt elsewhere) while flicking. Release (or left-click)
// runs the selected action; destructive actions require confirmation. A closed shadow root keeps
// page styles and scripts out of the UI.
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { WHEEL_SIZE, Wheel, sectorAt } from './Wheel';
import { Confirmation, type CloseConfirmation } from './Confirmation';
import { MODIFIER_KEYS, isHoldKey, otherModifierDown, resolveHoldCode } from '../../src/keys.js';
import { LOCALE_TAGS, getLocale, setLocale, t } from '../../src/i18n.js';
import { unavailableReason, type AvailabilityState } from '../shared/availability';
import type { ActionInfo } from '../shared/types';
import sharedMarkCss from '../shared/action-mark.css';
import overlayCss from './styles.css';

interface OverlayState extends AvailabilityState { slots: (ActionInfo | null)[]; platform: string }

const HOST_ATTR = 'data-hiraishin-overlay';
/** How far the mouse has to move, once the key has been held long enough, before the wheel shows.
 *  Small enough to feel immediate, large enough that a resting hand never trips it. */
const FLICK_START = 6;
const HINT_DELAY = 2000;
const localeTag = () => LOCALE_TAGS[getLocale() as keyof typeof LOCALE_TAGS];
const guard = globalThis as Record<string, unknown>;
if (!guard.__hiraishinOverlay) {
  guard.__hiraishinOverlay = true;
  let host: HTMLElement | null = null;
  // Keep the root attachShadow returns: a closed root is not readable through host.shadowRoot,
  // so without this reference hover picking silently matched nothing.
  let shadow: ShadowRoot | null = null;
  let root: Root | null = null;
  let mount: HTMLElement | null = null;
  let armTimer = 0;
  let open = false;
  let state: OverlayState | null = null;
  let activeIndex: number | null = null;
  let hintTimer = 0;
  let hintVisible = false;
  let confirmation: CloseConfirmation | null = null;
  let gestureVersion = 0;
  let consumeClick = false;
  /** The wheel's centre in viewport coordinates; every direction is measured from here. */
  let position = { left: 0, top: 0 };
  /** Held long enough; now waiting for the flick that actually opens the wheel. */
  let armed = false;
  /** Where the pointer was when the hold completed: the wheel opens around that point, so the
   *  movement that revealed it already counts as the first part of the flick. */
  const origin = { x: 0, y: 0 };
  let opening = false;
  const pointer = { x: 0, y: 0 };
  /** Whether `pointer` is where the mouse really is. A page only learns the position from mouse
   *  events, so it is unknown until the mouse first moves over a freshly loaded page, and stale
   *  after the tab or window was left (the mouse moved elsewhere meanwhile). */
  let pointerKnown = false;
  /** Armed while the position was unknown: the origin is the first sample of the movement. */
  let originPending = false;
  let config = { enabled: false, extensionPages: false, holdCode: 'auto', holdMs: 0 };
  /** Extension pages (the settings page) load this same bundle from a <script> tag: no content
   *  script, no host permission, and a separate flag in the published config. Browser pages such
   *  as `chrome://extensions` stay out of reach — nothing may run there at all. */
  const ownPage = location.protocol === 'chrome-extension:';
  const armable = () => (ownPage ? config.extensionPages : config.enabled);
  /** The hold key resolved for this platform: `auto` cannot be compared against an event. */
  const holdKey = () => resolveHoldCode(config.holdCode, navigator.platform.startsWith('Mac') ? 'mac' : 'other');

  const isEditable = () => {
    const node = document.activeElement as HTMLElement | null;
    if (!node) return false;
    return node.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName);
  };

  function ensureHost() {
    if (host) return host;
    host = document.createElement('div');
    host.setAttribute(HOST_ATTR, '');
    // The host stays a zero-sized anchor: the backdrop and the panel inside are both fixed and
    // cover what they need to. A host that blankets the viewport only adds a full-page hit-test
    // layer over every page we run in.
    host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483646;display:none;';
    shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `${sharedMarkCss}\n${overlayCss}`;
    mount = document.createElement('div');
    mount.lang = localeTag();
    shadow.append(style, mount);
    (document.body || document.documentElement).append(host);
    root = createRoot(mount);
    return host;
  }

  /** Rendered synchronously: the gesture reads the wheel back from the DOM in the same frame. */
  function render() {
    if (!root || !state) return;
    flushSync(() => root!.render(
      confirmation ? <Confirmation state={confirmation} onCancel={hide} onConfirm={() => { void confirmClose(); }} />
      : <Wheel slots={state!.slots} activeIndex={activeIndex} position={position}
        hint={t('overlay.hint.release')} showHint={open && hintVisible} rightCount={state!.rightCount}
        unavailable={action => unavailableReason(action, state!)} />,
    ));
  }

  /** Open around where the flick started, but never so close to an edge that it would run out of
   *  screen: the centre keeps one full radius of room on every side. */
  function place() {
    const margin = WHEEL_SIZE / 2 + 8;
    const fit = (at: number, limit: number) => (margin * 2 >= limit
      ? limit / 2
      : Math.max(margin, Math.min(at, limit - margin)));
    position = { left: fit(origin.x, window.innerWidth), top: fit(origin.y, window.innerHeight) };
  }

  async function show() {
    const version = gestureVersion;
    const reply = await chrome.runtime.sendMessage({ type: 'overlay-state' }).catch(() => null);
    // A late state response must not reopen the wheel after release, Escape, or window blur.
    if (!armed || version !== gestureVersion) return;
    if (!reply?.ok || !reply.state?.slots?.some((slot: ActionInfo | null) => slot)) return;
    state = reply.state;
    activeIndex = null;
    place();
    ensureHost().style.display = 'block';
    open = true;
    scheduleHint();
    render();
    // The flick that revealed the wheel is part of the gesture, so it selects straight away.
    pick(pointer.x, pointer.y);
  }

  function hide() {
    cancelArm();
    clearHint();
    open = false;
    activeIndex = null;
    confirmation = null;
    if (host) host.style.display = 'none';
    // Render the cleared selection too: leaving it in the DOM would flash the last highlight for
    // one frame the next time the wheel opens.
    if (state) render();
  }

  function run(index: number | null) {
    const action = index === null ? null : state?.slots[index];
    if (action && state && !unavailableReason(action, state)) {
      if (action.kind === 'close-right') {
        void prepareClose();
        return;
      }
      chrome.runtime.sendMessage({ type: 'overlay-action', id: action.id }).catch(() => {});
    }
    hide();
  }

  async function prepareClose() {
    cancelArm();
    clearHint();
    open = false;
    activeIndex = null;
    const pending: CloseConfirmation = {
      count: state!.rightCount, token: null, busy: true, error: '',
      center: { x: position.left, y: position.top },
    };
    confirmation = pending;
    render();
    try {
      const reply = await chrome.runtime.sendMessage({ type: 'overlay-action', id: 'close-right' });
      if (confirmation !== pending) return;
      if (!reply?.ok || !reply.confirmation) throw new Error(reply?.error || t('overlay.error.verify'));
      pending.count = reply.confirmation.count;
      pending.token = reply.confirmation.token;
    } catch (error) {
      if (confirmation !== pending) return;
      pending.error = error instanceof Error ? error.message : t('overlay.error.verifyRetry');
    }
    pending.busy = false;
    render();
  }

  async function confirmClose() {
    const pending = confirmation;
    if (!pending?.token || pending.busy || pending.error) return;
    pending.busy = true;
    render();
    try {
      const reply = await chrome.runtime.sendMessage({ type: 'overlay-confirm-action', id: 'close-right', token: pending.token });
      if (confirmation !== pending) return;
      if (!reply?.ok || reply.status !== 'ok') throw new Error(reply?.error || t('overlay.error.notClosed'));
      hide();
    } catch (error) {
      if (confirmation !== pending) return;
      pending.busy = false;
      pending.token = null;
      pending.error = error instanceof Error ? error.message : t('overlay.error.closeFailed');
      render();
    }
  }

  function clearHint() {
    window.clearTimeout(hintTimer);
    hintTimer = 0;
    hintVisible = false;
  }

  function scheduleHint() {
    clearHint();
    const index = activeIndex;
    // The centre has guidance too; empty configured sectors still stay quiet.
    if (index !== null && !state?.slots[index]) return;
    hintTimer = window.setTimeout(() => {
      hintTimer = 0;
      if (!open || activeIndex !== index) return;
      hintVisible = true;
      render();
    }, HINT_DELAY);
  }

  /** Which sector the pointer is pointing at, by direction from the centre. Distance only decides
   *  whether anything is selected at all, never which one. */
  function pick(x: number, y: number) {
    if (!open || !state) return;
    const next = sectorAt(x - position.left, y - position.top, state.slots.length);
    if (next === activeIndex) return;
    activeIndex = next;
    scheduleHint();
    render();
  }

  // Armed with an unknown position, the wheel must open where the flick began, not at (0, 0) or
  // wherever the mouse was last seen. No API reports the cursor before it moves, so the closest
  // point is the movement's first sample: pointerrawupdate delivers samples before they are
  // coalesced into a frame (secure contexts only), and pointermove carries the coalesced ones.
  // Both are listened to only while that origin is pending, so ordinary pages pay nothing.
  const earlySample = (event: Event) => {
    const move = event as PointerEvent;
    if (!armed || !originPending || !move.isTrusted || move.pointerType !== 'mouse') return;
    const first = move.getCoalescedEvents?.()[0] ?? move;
    resolveOrigin(first.clientX, first.clientY);
  };
  const SAMPLE_EVENTS = ['pointerrawupdate', 'pointermove'];
  function awaitOrigin() {
    originPending = true;
    for (const type of SAMPLE_EVENTS) window.addEventListener(type, earlySample, { capture: true, passive: true });
  }
  function resolveOrigin(x: number, y: number) {
    origin.x = x;
    origin.y = y;
    originPending = false;
    for (const type of SAMPLE_EVENTS) window.removeEventListener(type, earlySample, { capture: true });
  }

  // Passive: this handler never cancels the event, and saying so keeps pointer moves on the
  // compositor's fast path on every page the user visits, panel open or not.
  document.addEventListener('mousemove', event => {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointerKnown = true;
    if (open) { pick(event.clientX, event.clientY); return; }
    // No earlier sample reached us (an insecure page has no pointerrawupdate): this event is the
    // first known point of the movement, so it becomes the origin rather than opening the wheel.
    if (armed && originPending) { resolveOrigin(event.clientX, event.clientY); return; }
    // Armed and the mouse starts moving: that is the flick, and it opens the wheel.
    if (armed && !opening && Math.hypot(pointer.x - origin.x, pointer.y - origin.y) >= FLICK_START) {
      opening = true;
      void show().finally(() => { opening = false; });
    }
  }, { capture: true, passive: true });

  document.addEventListener('keydown', event => {
    if (!event.isTrusted) return;
    if (confirmation) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); hide(); }
      // Keep typing out of the page while allowing the card's buttons and Tab focus loop.
      if (!['Tab', 'Enter', ' '].includes(event.key)) event.stopPropagation();
      return;
    }
    if (!armable() || !chrome.runtime?.id) return;
    const hold = holdKey();
    if (!isHoldKey(event, hold)) {
      // Any other key means a real shortcut is being typed, not the gesture: disarm, and close an
      // already open panel without running anything.
      cancelArm();
      if (open) hide();
      return;
    }
    // A held modifier repeats; only the first press starts the timer.
    if (open || armed || armTimer || event.repeat) return;
    // Modifier gestures also work in editors that autofocus on load. Character triggers stay
    // disabled there so ordinary typing plus a mouse movement never summons the wheel.
    if (otherModifierDown(event, hold) || (!MODIFIER_KEYS.includes(hold) && isEditable())) { cancelArm(); return; }
    const arm = () => {
      armTimer = 0;
      armed = true;
      if (pointerKnown) resolveOrigin(pointer.x, pointer.y);
      else awaitOrigin();
    };
    // Arm immediately by default; movement reveals the wheel.
    if (config.holdMs > 0) armTimer = window.setTimeout(arm, config.holdMs);
    else arm();
  }, true);

  const cancelArm = () => {
    gestureVersion++;
    if (armTimer) { clearTimeout(armTimer); armTimer = 0; }
    armed = false;
    if (originPending) resolveOrigin(origin.x, origin.y);
  };
  document.addEventListener('keyup', event => {
    if (!event.isTrusted || !isHoldKey(event, holdKey())) return;
    cancelArm();
    if (confirmation) { event.preventDefault(); return; }
    if (!open) return;
    // Releasing the key commits the highlighted action. Cancel the default too: on Windows and
    // Linux, releasing Alt alone otherwise opens Chrome's menu.
    event.preventDefault();
    run(activeIndex);
  }, true);

  document.addEventListener('mousedown', event => {
    consumeClick = false;
    if (confirmation) {
      // A document listener cannot see nodes inside a closed shadow root in composedPath().
      // Use the retained shadow reference and the card's actual bounds instead.
      const rect = shadow?.querySelector('[data-confirm-card]')?.getBoundingClientRect();
      const inside = rect && event.clientX >= rect.left && event.clientX <= rect.right
        && event.clientY >= rect.top && event.clientY <= rect.bottom;
      if (event.button === 2 || !inside) {
        event.preventDefault();
        event.stopPropagation();
        consumeClick = event.button === 0;
        hide();
      }
      return;
    }
    if (!open) { cancelArm(); return; }
    event.preventDefault();
    event.stopPropagation();
    if (event.button === 2) hide();
    else if (event.button === 0) {
      consumeClick = true;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointerKnown = true;
      pick(event.clientX, event.clientY);
      run(activeIndex);
    }
  }, true);
  // The click completing the wheel's mousedown must never activate the newly mounted card.
  document.addEventListener('click', event => {
    if (!consumeClick) return;
    consumeClick = false;
    event.preventDefault();
    event.stopPropagation();
  }, true);
  document.addEventListener('contextmenu', event => { if (open || confirmation) { event.preventDefault(); hide(); } }, true);
  document.addEventListener('keydown', event => { if (open && event.key === 'Escape') { event.preventDefault(); hide(); } }, true);
  // Leaving the window, the tab, or the page itself means the mouse may be anywhere next time.
  window.addEventListener('blur', () => { pointerKnown = false; cancelArm(); hide(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { pointerKnown = false; hide(); } });
  document.addEventListener('mouseout', event => { if (!event.relatedTarget) pointerKnown = false; }, { capture: true, passive: true });

  /** The service worker resolves the preference into pageConfig: a page has no settings access,
   *  and chrome.i18n here would only know the browser language, not the saved choice. */
  function applyLocale(locale: string | undefined) {
    if (!locale || locale === getLocale()) return;
    setLocale(locale, { labelDocument: false });
    if (mount) mount.lang = localeTag();
    if (state && (open || confirmation)) render();
  }

  const apply = (value: { overlay?: typeof config; locale?: string } | undefined) => {
    const next = { ...config, ...(value?.overlay ?? {}) };
    const enabledHere = ownPage ? next.extensionPages : next.enabled;
    if (!enabledHere || next.holdCode !== config.holdCode || next.holdMs !== config.holdMs) hide();
    config = next;
    applyLocale(value?.locale);
  };
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.pageConfig) apply(changes.pageConfig.newValue);
  });
  chrome.storage.local.get('pageConfig').then(result => apply(result.pageConfig)).catch(() => {});
}
