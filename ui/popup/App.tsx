import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { holdKeyLabel } from '../../src/keys.js';
import { applyLocalePreference, t } from '../../src/i18n.js';
import { api } from '../shared/api';
import { unavailableReason } from '../shared/availability';
import { Wheel, WHEEL_SIZE } from '../overlay/Wheel';
import { Confirmation, type CloseConfirmation } from '../overlay/Confirmation';
import { SettingsGlyph } from './icons';
import type { ActionInfo, ActionResult, LicenseView, PanelState } from '../shared/types';

const SWITCHING_KINDS = new Set(['history', 'previous-tab', 'transfer', 'new-window']);
const NOTICE_DAYS = 3;

/** Only when it matters: the last few trial days, or no longer allowed. Never mid-gesture. */
function licenseNotice(license: LicenseView): string {
  if (license.state === 'expired') return t('popup.license.expired');
  if (license.state === 'revoked') return t('popup.license.revoked');
  if (license.state !== 'trial' || !license.trialEndsAt) return '';
  const days = Math.ceil((license.trialEndsAt - Date.now()) / 86_400_000);
  return days <= NOTICE_DAYS ? t('popup.license.daysLeft', { count: Math.max(days, 1) }) : '';
}
type Status = { message: string; kind: 'info' | 'error' } | null;

export function App() {
  const [state, setState] = useState<PanelState | null>(null);
  const [busy, setBusy] = useState(true);
  const [status, setStatus] = useState<Status>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [hintVisible, setHintVisible] = useState(false);
  const [confirmation, setConfirmation] = useState<CloseConfirmation | null>(null);
  const [fatal, setFatal] = useState('');
  const windowId = useRef<number | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  const confirmationVersion = useRef(0);
  useLayoutEffect(() => {
    setHintVisible(false);
    if (!state || confirmation) return;
    const timer = window.setTimeout(() => setHintVisible(true), 2000);
    return () => window.clearTimeout(timer);
  }, [activeIndex, state, confirmation]);

  const refresh = useCallback(async () => {
    if (windowId.current === null) return;
    const next = await api.getState(windowId.current);
    // Before the first state arrives the browser language applies; from here on the saved choice.
    applyLocalePreference(next.settings.locale);
    setState(next);
  }, []);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const current = await chrome.windows.getCurrent();
        if (!live) return;
        windowId.current = current.id ?? null;
        await refresh();
      } catch (error) {
        if (live) setFatal((error as Error).message || t('popup.error.unavailable'));
      } finally {
        if (live) setBusy(false);
      }
    })();
    return () => { live = false; };
  }, [refresh]);

  const run = async (call: (id: number) => Promise<ActionResult>, closeOnSwitch = false) => {
    if (inFlight.current || windowId.current === null) return;
    inFlight.current = true; setBusy(true); setStatus(null);
    try {
      const result = await call(windowId.current);
      const switched = ['ok', 'navigated', 'sent'].includes(result.status ?? '') || result.changed;
      if (closeOnSwitch && switched) { window.close(); return; }
      await refresh();
      if (result.message) setStatus({ message: result.message, kind: result.notify ? 'error' : 'info' });
    } catch (error) {
      setStatus({ message: (error as Error).message || t('popup.error.failed'), kind: 'error' });
      await refresh().catch(() => {});
    } finally { inFlight.current = false; setBusy(false); }
  };
  const cancelConfirmation = () => {
    confirmationVersion.current++;
    setConfirmation(null); setActiveIndex(null);
  };
  const prepareClose = async () => {
    if (inFlight.current || windowId.current === null || !state) return;
    const version = ++confirmationVersion.current;
    const rect = stage.current!.getBoundingClientRect();
    const pending: CloseConfirmation = { count: state.rightCount, token: null, busy: true, error: '',
      center: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } };
    inFlight.current = true; setBusy(true); setStatus(null); setConfirmation(pending);
    try {
      const preview = await api.previewPopupClose(windowId.current);
      if (confirmationVersion.current === version) setConfirmation({ ...pending, ...preview, busy: false });
    } catch (error) {
      if (confirmationVersion.current === version) setConfirmation({ ...pending, busy: false, error: (error as Error).message });
    } finally { inFlight.current = false; setBusy(false); }
  };
  const confirmClose = async () => {
    if (inFlight.current || windowId.current === null || !confirmation?.token || confirmation.error) return;
    const version = confirmationVersion.current;
    inFlight.current = true; setBusy(true);
    setConfirmation({ ...confirmation, busy: true });
    try {
      const result = await api.confirmPopupClose(windowId.current, confirmation.token);
      if (confirmationVersion.current !== version) return;
      setConfirmation(null); setActiveIndex(null);
      setStatus({ message: result.message || t('popup.closed'), kind: 'info' });
      await refresh();
    } catch (error) {
      if (confirmationVersion.current === version) setConfirmation({ ...confirmation, token: null, busy: false, error: (error as Error).message });
    } finally { inFlight.current = false; setBusy(false); }
  };
  const slots = state?.settings.overlay.slots.map(id => state.actions.find(action => action.id === id && !action.panelInput) ?? null) ?? [];
  const unavailable = (action: ActionInfo) => state ? unavailableReason(action, {
    ...state, defaultTargetId: state.settings.defaultTargetId,
  }) : t('popup.loading');
  const activate = (index: number) => {
    const action = slots[index];
    if (!action || busy || unavailable(action)) return;
    if (action.kind === 'close-right') { void prepareClose(); return; }
    void run(id => api.runAction(action.id, id), SWITCHING_KINDS.has(action.kind) && action.mode !== 'fill');
  };
  const empty = state && !slots.some(Boolean);
  return <main className="app" aria-busy={busy}>
    <header className="brand">
      <h1>飛雷神 <span>HIRAISHIN</span></h1>
      <button className="icon-button" type="button" aria-label={t('popup.settings.aria')} title={t('popup.settings.title')}
        onClick={() => { chrome.runtime.openOptionsPage(); window.close(); }}><SettingsGlyph /></button>
    </header>
    <div className="popup-wheel-stage" ref={stage}>
      {state && !confirmation && <div className="popup-wheel-frame">
        <Wheel slots={slots} activeIndex={activeIndex} position={{ left: WHEEL_SIZE / 2, top: WHEEL_SIZE / 2 }}
          showHint={hintVisible}
          hint={t('popup.wheel.hint')} confirmHint={t('popup.wheel.confirmHint')}
          idleTitle={empty ? t('popup.wheel.emptyTitle') : t('popup.wheel.idleTitle')}
          idleHint={empty ? t('popup.wheel.emptyHint') : t('popup.wheel.idleHint')} unavailable={unavailable} rightCount={state.rightCount}
          busy={busy} onSelect={setActiveIndex} onActivate={activate} />
      </div>}
      {!state && <p className="empty-message" role="status">{fatal || t('popup.wheel.loading')}</p>}
    </div>
    {confirmation && <Confirmation state={confirmation} onCancel={cancelConfirmation} onConfirm={() => { void confirmClose(); }} />}
    {status && <p className="status" role="status" aria-live="polite" data-kind={status.kind}>{status.message}</p>}
    {state && licenseNotice(state.license) && <aside className="setup-hint" aria-label={t('popup.license.label')}>
      <strong>{licenseNotice(state.license)}</strong>
      <p>{t('popup.license.body')}</p>
      <button type="button" onClick={() => { chrome.runtime.openOptionsPage(); window.close(); }}>{t('popup.license.button')}</button>
    </aside>}
    {state && state.settings.overlay.enabled && !state.shortcuts.granted && <aside className="setup-hint" aria-label={t('popup.overlaySetup.label')}>
      <strong>{t('popup.overlaySetup.title')}</strong>
      <p>{t('popup.overlaySetup.body', { key: holdKeyLabel(state.settings.overlay.holdCode, state.platform) })}</p>
      <button type="button" onClick={() => { chrome.runtime.openOptionsPage(); window.close(); }}>{t('popup.overlaySetup.button')}</button>
    </aside>}
    {Boolean(state?.tasks.length) && <details className="pending-selections">
      <summary>{t('popup.tasks.summary', { count: state!.tasks.length })}</summary>
      {state!.tasks.map(task => <div className="pending-selection" key={task.id}>
        <p>{task.targetName} · {task.message}</p><p className="task-preview">{task.preview}</p>
        <button type="button" disabled={busy} onClick={() => { void run(id => api.retryTask(task.id, id), true); }}>{t('popup.tasks.retry')}</button>
        <button type="button" disabled={busy} onClick={() => { void run(async () => {
          await navigator.clipboard.writeText(task.text); return { ok: true, message: t('popup.tasks.copied') };
        }); }}>{t('popup.tasks.copy')}</button>
        <button type="button" disabled={busy} onClick={() => { void run(async () => { await api.removeTask(task.id); return { ok: true }; }); }}>{t('popup.tasks.clear')}</button>
      </div>)}
    </details>}
  </main>;
}
