import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { holdKeyLabel } from '../../src/keys.js';
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
  if (license.state === 'expired') return '试用已结束';
  if (license.state === 'revoked') return '授权已撤销';
  if (license.state !== 'trial' || !license.trialEndsAt) return '';
  const days = Math.ceil((license.trialEndsAt - Date.now()) / 86_400_000);
  return days <= NOTICE_DAYS ? `试用还剩 ${Math.max(days, 1)} 天` : '';
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
    if (windowId.current !== null) setState(await api.getState(windowId.current));
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
        if (live) setFatal((error as Error).message || '扩展程序暂时不可用。');
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
      setStatus({ message: (error as Error).message || '操作失败，请重试。', kind: 'error' });
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
      setStatus({ message: result.message || '已关闭标签页。', kind: 'info' });
      await refresh();
    } catch (error) {
      if (confirmationVersion.current === version) setConfirmation({ ...confirmation, token: null, busy: false, error: (error as Error).message });
    } finally { inFlight.current = false; setBusy(false); }
  };
  const slots = state?.settings.overlay.slots.map(id => state.actions.find(action => action.id === id && !action.panelInput) ?? null) ?? [];
  const unavailable = (action: ActionInfo) => state ? unavailableReason(action, {
    ...state, defaultTargetId: state.settings.defaultTargetId,
  }) : '正在读取…';
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
      <button className="icon-button" type="button" aria-label="打开设置" title="设置轮盘"
        onClick={() => { chrome.runtime.openOptionsPage(); window.close(); }}><SettingsGlyph /></button>
    </header>
    <div className="popup-wheel-stage" ref={stage}>
      {state && !confirmation && <div className="popup-wheel-frame">
        <Wheel slots={slots} activeIndex={activeIndex} position={{ left: WHEEL_SIZE / 2, top: WHEEL_SIZE / 2 }}
          showHint={hintVisible}
          hint="点击执行" confirmHint="点击后确认" idleTitle={empty ? '还没有配置动作' : '选择一个动作'}
          idleHint={empty ? '点击右上角设置' : '点击扇区执行'} unavailable={unavailable} rightCount={state.rightCount}
          busy={busy} onSelect={setActiveIndex} onActivate={activate} />
      </div>}
      {!state && <p className="empty-message" role="status">{fatal || '正在读取轮盘…'}</p>}
    </div>
    {confirmation && <Confirmation state={confirmation} onCancel={cancelConfirmation} onConfirm={() => { void confirmClose(); }} />}
    {status && <p className="status" role="status" aria-live="polite" data-kind={status.kind}>{status.message}</p>}
    {state && licenseNotice(state.license) && <aside className="setup-hint" aria-label="授权">
      <strong>{licenseNotice(state.license)}</strong>
      <p>购买或输入授权码后即可继续使用，设置和待处理内容都已保留。</p>
      <button type="button" onClick={() => { chrome.runtime.openOptionsPage(); window.close(); }}>购买 / 激活</button>
    </aside>}
    {state && state.settings.overlay.enabled && !state.shortcuts.granted && <aside className="setup-hint" aria-label="启用网页轮盘">
      <strong>在网页里也能用轮盘</strong>
      <p>按住 {holdKeyLabel(state.settings.overlay.holdCode, state.platform)} 并甩动鼠标，松开执行。首次使用需允许网页访问。</p>
      <button type="button" onClick={() => { chrome.runtime.openOptionsPage(); window.close(); }}>设置并启用</button>
    </aside>}
    {Boolean(state?.tasks.length) && <details className="pending-selections">
      <summary>待处理选区（{state!.tasks.length}）</summary>
      {state!.tasks.map(task => <div className="pending-selection" key={task.id}>
        <p>{task.targetName} · {task.message}</p><p className="task-preview">{task.preview}</p>
        <button type="button" disabled={busy} onClick={() => { void run(id => api.retryTask(task.id, id), true); }}>重试填入</button>
        <button type="button" disabled={busy} onClick={() => { void run(async () => {
          await navigator.clipboard.writeText(task.text); return { ok: true, message: '已复制待发送文字。' };
        }); }}>复制文字</button>
        <button type="button" disabled={busy} onClick={() => { void run(async () => { await api.removeTask(task.id); return { ok: true }; }); }}>清除</button>
      </div>)}
    </details>}
  </main>;
}
