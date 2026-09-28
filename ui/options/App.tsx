import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { comboFromEvent, displayCombo, holdKeyLabel, nativeEligible, webEligible, reservedReason } from '../../src/keys.js';
import { CATEGORIES } from '../../src/actions.js';
import { ActionIcon, SettingsGlyph } from '../popup/icons';
import { WHEEL_SIZE, Wheel, sectorAt } from '../overlay/Wheel';
import { OVERLAY_HOLD_MODIFIERS, OVERLAY_SECTORS, PAGE_ORIGINS } from '../../src/settings.js';
import { api } from '../shared/api';
import type { ActionInfo, Capability, CustomTarget, Settings, SettingsView, TargetInfo } from '../shared/types';
import { WheelPositionDialog } from './WheelPositionDialog';
import { WheelActionPicker } from './WheelActionPicker';
import { WheelPositions, wheelDirection } from './WheelPositions';
import { createSettingsClient } from './settings-client';
import { UsageStats } from './UsageStats';

type Status = { message: string; kind: 'info' | 'error' } | null;
const CAPABILITY_LABEL: Record<Capability, string> = { navigate: '仅前往', fill: '前往 + 填入', send: '前往 + 填入 + 发送' };
const categories = CATEGORIES as Record<string, string>;

export function App() {
  const [view, setView] = useState<SettingsView | null>(null);
  const settingsClient = useMemo(() => createSettingsClient(api, setView), []);
  const [status, setStatus] = useState<Status>(null);
  const [recording, setRecording] = useState<{ action: ActionInfo; combo: string | null; note: string } | null>(null);
  const [targetsOpen, setTargetsOpen] = useState(false);

  const show = useCallback((message: string, kind: 'info' | 'error' = 'info') => {
    setStatus({ message, kind });
    setTimeout(() => setStatus(current => (current?.message === message ? null : current)), 4000);
  }, []);

  const load = useCallback(() => settingsClient.load(), [settingsClient]);
  useEffect(() => {
    load().catch(error => show((error as Error).message, 'error'));
    const reload = () => { if (document.visibilityState === 'visible') load().catch(() => {}); };
    window.addEventListener('focus', reload);
    document.addEventListener('visibilitychange', reload);
    // @types/chrome omits removeListener on these events although Chrome provides it.
    const permissionEvents = [chrome.permissions?.onAdded, chrome.permissions?.onRemoved] as Array<chrome.events.Event<() => void> | undefined>;
    for (const event of permissionEvents) event?.addListener(reload);
    return () => {
      window.removeEventListener('focus', reload);
      document.removeEventListener('visibilitychange', reload);
      for (const event of permissionEvents) event?.removeListener(reload);
    };
  }, [load, show]);

  const saveSettings = useCallback(async (mutate: (settings: Settings) => void) => {
    try { await settingsClient.save(mutate); show('已保存'); return true; }
    catch (error) { show((error as Error).message, 'error'); return false; }
  }, [settingsClient, show]);

  const setBinding = useCallback(async (actionId: string, combo: string | null) => {
    try { await settingsClient.setBinding(actionId, combo); show(combo ? '网页快捷键已保存。' : '已清除网页快捷键。'); }
    catch (error) { show((error as Error).message, 'error'); }
  }, [settingsClient, show]);

  const requestPagePermission = useCallback(async () => {
    const granted = await chrome.permissions.request({ origins: PAGE_ORIGINS });
    if (granted) await settingsClient.sync();
    return granted;
  }, [settingsClient]);

  const platform = view?.status.platform ?? 'unknown';
  const label = (combo: string) => (combo ? displayCombo(combo, platform) : '');

  if (!view) return <main className="page"><Header /><p className="lead">读取设置…</p>{status && <StatusBar status={status} />}</main>;

  return (
    <main className="page">
      <Header />

      <ActionsSection view={view} label={label} onRecord={action => setRecording({ action, combo: null, note: '' })}
        onClear={id => setBinding(id, null)} onGrant={async () => { const ok = await requestPagePermission(); show(ok ? '已允许访问网页。已有页面无需刷新。' : '未获得权限。', ok ? 'info' : 'error'); }}
        onSaveDisabled={sites => saveSettings(settings => { settings.webShortcuts.disabledSites = sites; })}
        onOpenNative={action => {
          chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
          show(`请在 Chrome 快捷键页为「${action.name}」设置组合，返回本页会显示实际绑定。`);
        }}
        onOverlay={enabled => saveSettings(settings => { settings.overlay.enabled = enabled; })}
        onHoldCode={code => saveSettings(settings => { settings.overlay.holdCode = code; })}
        onOpenTargets={() => setTargetsOpen(true)}
        saveSettings={saveSettings} />
      {targetsOpen && (
        <TargetsDialog view={view} saveSettings={saveSettings} show={show} onSync={settingsClient.sync}
          onClose={() => setTargetsOpen(false)} />
      )}
      {status && <StatusBar status={status} />}
      {recording && (
        <Recorder view={view} platform={platform} recording={recording} setRecording={setRecording}
          onSaveWeb={async () => {
            if (!recording.combo) return;
            if (!view.status.granted) {
              const granted = await requestPagePermission();
              if (!granted) show('未获得网页访问权限，快捷键已保存但未启用。', 'error');
            }
            const { action, combo } = recording;
            setRecording(null);
            await setBinding(action.id, combo);
          }}
          onNative={() => { setRecording(null); chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }); show('请在 Chrome 快捷键页为该动作设置组合，返回后这里会显示实际绑定。'); }} />
      )}
      <UsageStats actions={view.actions} />
      <footer className="settings-footer"><span>飛雷神 {chrome.runtime.getManifest().version}</span>
        <a href="privacy.html" target="_blank" rel="noreferrer">隐私与数据说明</a>
      </footer>
    </main>
  );
}

function Header() {
  return (
    <header className="brand">
      <img className="brand-mark" src="icons/mark.svg" alt="" width="46" height="46" />
      <div>
        <h1>飛雷神 <span>HIRAISHIN</span></h1>
        <p>配置轮盘分区、快捷键与 AI 目标。</p>
      </div>
    </header>
  );
}

function StatusBar({ status }: { status: NonNullable<Status> }) {
  return <p className="status" role="status" aria-live="polite" data-kind={status.kind}>{status.message}</p>;
}

/** Only what the two key columns cannot show on their own: a binding that will not actually fire. */
function webProblem(action: ActionInfo, view: SettingsView): string {
  if (!action.web || !action.webBinding) return '';
  if (!view.status.granted) return '等待网站授权，需先允许访问网页';
  if (action.shadowed) return '已由浏览器快捷键承接，网页内不再执行';
  if (action.conflict) return '与其他动作使用了同一组合，只有第一个生效';
  return '';
}

/** Twenty-odd rows read better clustered by category than as one flat list. */
function groupByCategory(actions: ActionInfo[]) {
  const groups = new Map<string, ActionInfo[]>();
  for (const action of actions) {
    if (!groups.has(action.category)) groups.set(action.category, []);
    groups.get(action.category)!.push(action);
  }
  return groups;
}

function ActionsSection({ view, label, onRecord, onClear, onGrant, onSaveDisabled, onOpenNative, onOpenTargets, onOverlay, onHoldCode, saveSettings }: {
  view: SettingsView; label: (combo: string) => string; onRecord: (action: ActionInfo) => void; onClear: (id: string) => void;
  onGrant: () => void; onSaveDisabled: (sites: string[]) => void; onOpenNative: (action: ActionInfo) => void;
  onOpenTargets: () => void;
  onOverlay: (enabled: boolean) => void;
  onHoldCode: (code: string) => void;
  saveSettings: (change: (settings: Settings) => void) => Promise<boolean>;
}) {
  const [positionAction, setPositionAction] = useState<ActionInfo | null>(null);
  const overlayEnabled = view.settings.overlay.enabled;
  const [sites, setSites] = useState(view.settings.webShortcuts.disabledSites.join('\n'));
  useEffect(() => { setSites(view.settings.webShortcuts.disabledSites.join('\n')); }, [view.settings.webShortcuts.disabledSites]);
  const groups = groupByCategory(view.actions.filter(action => !action.panelInput));
  return (
    <section id="actions" aria-labelledby="actions-heading">
      <div className="actions-head">
        <h2 id="actions-heading">动作</h2>
        <button className="button subtle" type="button" onClick={() => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })}>打开 Chrome 快捷键管理 ↗</button>
      </div>
      <p className="lead">工具栏与网页轮盘共用下方分区配置。浏览器快捷键由 Chrome 管理；网页快捷键在已授权的网页内生效。</p>

      <div className="overlay-settings">
        <div className="overlay-settings-head">
          <label className="toggle overlay-toggle">
            <input type="checkbox" checked={overlayEnabled} aria-expanded={overlayEnabled} aria-controls="wheel-settings"
              onChange={event => onOverlay(event.target.checked)} />
            <span>
              <strong>在网页中使用轮盘</strong>
              <small>开启后，按住按键并甩动鼠标即可使用。</small>
            </span>
          </label>
        </div>
        {overlayEnabled && <div id="wheel-settings">
          {!view.status.granted && <div className="overlay-permission-note">
            <p>轮盘已开启。允许网页访问后，即可按住 {holdKeyLabel(view.settings.overlay.holdCode, view.status.platform)} 并甩动鼠标使用。</p>
            <button type="button" className="button" onClick={onGrant}>允许在网页使用</button>
          </div>}
          <div className="overlay-controls">
            <label className="hold-field">
              <span>触发按键</span>
              <select className="hold-select" aria-label="轮盘触发按键" value={view.settings.overlay.holdCode}
                onChange={event => onHoldCode(event.target.value)}>
                <option value="auto">{`默认（${holdKeyLabel('auto', view.status.platform)}）`}</option>
                {OVERLAY_HOLD_MODIFIERS.map((code: string) => (
                  <option key={code} value={code}>{holdKeyLabel(code, view.status.platform)}</option>
                ))}
                <option value="KeyZ">Z</option>
              </select>
            </label>
            <p className="overlay-gesture">按住{view.settings.overlay.holdMs > 0 ? ` ${view.settings.overlay.holdMs} 毫秒` : ''}
              <span aria-hidden="true"> → </span>甩动选择<span aria-hidden="true"> → </span>松开执行</p>
          </div>
          <details className="overlay-help">
            <summary>使用说明与取消方式</summary>
            <p>仅按住按键不会弹出；松手时指针在圆心则不执行。右键或 Esc 取消，按其他键或切换窗口会收起。关闭右侧标签页需再次确认。</p>
            <p>输入框内也可使用 Option / Alt 等修饰键甩动触发；字母、数字触发键在输入框内禁用。需要网页访问权限；地址栏与 Chrome 内部页面不适用。</p>
          </details>
        </div>}
        <WheelSettings view={view} saveSettings={saveSettings} />
      </div>
      <table className="shortcut-table">
        <thead><tr><th>动作</th><th>轮盘位置</th><th>浏览器快捷键</th><th>网页快捷键</th></tr></thead>
        <tbody>
          {[...groups].map(([category, actions]) => [
            <tr key={`group-${category}`} className="group-row">
              {/* The flex row lives in a wrapper: `display: flex` on a `th` drops it out of the
                  table formatting context, so colSpan stops working and the text stacks vertically. */}
              <th colSpan={4}>
                <div className="group-row-inner">
                  <span className="group-label">{categories[category] ?? category}</span>
                  {/* An icon, not a label: 11px text beside an 11px group heading competed with it. */}
                  {category === 'ai' && (
                    <button type="button" className="group-action" onClick={onOpenTargets}
                      title="管理 AI 目标与发送行为" aria-label="管理 AI 目标与发送行为">
                      <SettingsGlyph />
                    </button>
                  )}
                </div>
              </th>
            </tr>,
            ...actions.map(action => {
              const problem = webProblem(action, view);
              return (
                <tr key={action.id} data-action-id={action.id}>
                  {/* Same reason as the group row: a flex `td` leaves the table formatting context,
                      so its height and bottom border stop matching the other cells in the row. */}
                  <td className="action-cell">
                    <div className="action-cell-inner"><ActionIcon action={action} /><span className="action-details">
                      <span>{action.name}</span>
                    </span></div>
                  </td>
                  <td className="wheel-position-cell">
                    <button type="button" className={`wheel-position-button${view.settings.overlay.slots.includes(action.id) ? '' : ' empty'}`} aria-label={`设置「${action.name}」的位置`}
                      aria-haspopup="dialog" onClick={() => setPositionAction(action)}>
                      {view.settings.overlay.slots.includes(action.id)
                        ? <WheelPositions actionId={action.id} slots={view.settings.overlay.slots} />
                        : '设置'}
                    </button>
                  </td>
                  <td className={action.command ? 'kbd-cell' : 'muted'}>
                    {action.command ? (
                      <>
                        {/* Native bindings live in Chrome's own settings; clicking the key opens them. */}
                        <button type="button" className={`kbd-button${action.nativeCombo ? '' : ' empty'}`}
                          title="在 Chrome 快捷键页设置" onClick={() => onOpenNative(action)}>
                          {label(action.nativeCombo) || '未绑定'}
                        </button>
                        {!action.nativeCombo && action.suggested && <span className="hint warn">默认 {label(action.suggested)} 未生效，可能被其他扩展占用</span>}
                      </>
                    ) : action.web ? '仅网页快捷键' : '仅面板'}
                  </td>
                  <td className={action.web ? 'kbd-cell' : 'muted'}>
                    {action.web ? (
                      <>
                        <button type="button" className={`kbd-button${action.webBinding ? '' : ' empty'}`} title={action.webBinding ? '点击修改' : '点击录入'} onClick={() => onRecord(action)}>
                          {label(action.webBinding) || '录入'}
                        </button>
                        {action.webBinding && <button type="button" className="clear" title="清除" aria-label={`清除 ${action.name} 的网页快捷键`} onClick={() => onClear(action.id)}>×</button>}
                        {problem && <span className="hint warn">{problem}</span>}
                      </>
                    ) : '—'}
                  </td>
                </tr>
              );
            }),
          ])}
        </tbody>
      </table>
      {positionAction && <WheelPositionDialog action={positionAction} view={view}
        onAssign={index => saveSettings(settings => { settings.overlay.slots[index] = positionAction.id; })}
        onClose={() => setPositionAction(null)} />}
      <KeyProbe view={view} label={label} />
      <details className="advanced">
        <summary>按网站停用网页快捷键</summary>
        <label htmlFor="disabled-sites">每行一个域名，例如 docs.google.com</label>
        <textarea id="disabled-sites" rows={3} spellCheck={false} value={sites} onChange={event => setSites(event.target.value)} />
        <button className="button" style={{verticalAlign: 'top', marginLeft: 8}} type="button" onClick={() => onSaveDisabled(sites.split('\n').map(line => line.trim().toLowerCase()).filter(Boolean))}>保存</button>
      </details>
    </section>
  );
}

function KeyProbe({ view, label }: { view: SettingsView; label: (combo: string) => string }) {
  const [result, setResult] = useState<string>('');
  const platform = view.status.platform;
  return (
    <details className="advanced">
      <summary>试按区：检查一个组合键能否到达网页</summary>
      <p className="lead">把光标放进输入框并按下组合键。这里能显示出来，说明按键没有被系统或浏览器拦截；如果按了却没有任何反应，就是被拦截了，网页快捷键不会生效。</p>
      <input className="probe" placeholder="在这里按组合键" onKeyDown={event => {
        event.preventDefault();
        const combo = comboFromEvent(event, platform);
        if (!combo) { setResult(['Control', 'Shift', 'Alt', 'Meta'].includes(event.key) ? '' : '需要 Ctrl / Alt / Command 等修饰键加一个按键。'); return; }
        const owner = view.actions.find(action => action.webBinding === combo || action.nativeCombo === combo);
        const notes = [`收到 ${label(combo)}`];
        if (owner) notes.push(`当前绑定：${owner.name}${owner.nativeCombo === combo ? '（浏览器快捷键）' : '（网页快捷键）'}`);
        else notes.push('尚未绑定任何动作');
        const reserved = reservedReason(combo, platform);
        if (reserved) notes.push(reserved);
        setResult(notes.join(' · '));
      }} />
      {result && <p className="probe-result">{result}</p>}
    </details>
  );
}

const emptyTarget = (): CustomTarget => ({ id: '', name: '', openUrl: '', match: [], capability: 'navigate', selectors: { input: '', submit: '' } });

/** The wheel's sectors, clockwise from twelve o'clock. Changing the count keeps whatever still
 *  fits, because re-picking every action after a count change would be tedious; sectors a smaller
 *  count cuts off come back when the count grows again. */
function WheelSettings({ view, saveSettings }: {
  view: SettingsView; saveSettings: (change: (settings: Settings) => void) => Promise<boolean>;
}) {
  const slots = view.settings.overlay.slots;
  const [picked, setPicked] = useState(0);
  const choices = view.actions.filter(action => !action.panelInput);
  // Sectors dropped by a smaller count, kept for this page session so switching back restores
  // them: a one-click control makes an accidental 12 → 4 far more likely than a select did.
  const dropped = useRef<(string | null)[]>([]);
  const resize = (size: number) => {
    if (size === slots.length) return;
    setPicked(current => Math.min(current, size - 1));
    saveSettings(settings => {
      const latest = settings.overlay.slots;
      const known = [...latest, ...dropped.current.slice(latest.length)];
      dropped.current = known;
      settings.overlay.slots = Array.from({ length: size }, (_, index) => known[index] ?? null);
    });
  };
  return (
    <div className="wheel-config" role="group" aria-labelledby="wheel-heading">
      <div className="wheel-config-head">
        <h3 id="wheel-heading">轮盘分区</h3>
      </div>
      <div className="wheel-editor">
        <div className="wheel-preview">
          {/* Not a drawing of the wheel: the wheel itself, the same component and the same stylesheet
              the page injects, only scaled down. Clicking picks a sector through `sectorAt`, the very
              function the gesture uses, so the two can never disagree about which way a sector faces.
              The scaled frame is also what contains the wheel's fixed positioning: a transformed
              ancestor becomes the containing block for its fixed descendants. */}
          <div className="wheel-stage" onClick={event => {
            const stage = event.currentTarget.getBoundingClientRect();
            const at = sectorAt(event.clientX - (stage.left + stage.width / 2),
              event.clientY - (stage.top + stage.height / 2), slots.length);
            if (at !== null) setPicked(at);
          }}>
            <div className="wheel-frame">
              <Wheel slots={slots.map(id => (id ? choices.find(item => item.id === id) ?? null : null))}
                activeIndex={picked} position={{ left: WHEEL_SIZE / 2, top: WHEEL_SIZE / 2 }}
                hint="点击一瓣选中" unavailable={() => ''} />
            </div>
          </div>
        </div>
        <div className="wheel-side">
        <div className="slot-count">
          <span id="slot-count-label">分区数</span>
          <div className="segmented" role="radiogroup" aria-labelledby="slot-count-label">
            {OVERLAY_SECTORS.map((count: number) => <label key={count} className="segment">
              <input type="radio" name="slot-count" value={count} checked={slots.length === count}
                onChange={() => resize(count)} />
              <span>{count}</span>
            </label>)}
          </div>
        </div>
        <div className="wheel-assignment">
          <p className="assignment-caption">当前分区</p>
          <strong className="selected-direction">{wheelDirection(picked, slots.length)}<span>第 {picked + 1} 瓣</span></strong>
          <div className="slot-assign">
            <span>分区动作</span>
            <WheelActionPicker key={`${slots.length}:${picked}`} actions={choices} value={slots[picked]} slots={slots}
              onChange={id => saveSettings(settings => {
                settings.overlay.slots = slots.map((current, at) => at === picked ? id : current);
              })} />
          </div>
          <p className="assignment-hint">点击轮盘可切换分区。留空的分区松手时不会执行任何动作。</p>
        </div>
        </div>
      </div>
    </div>
  );
}

function TargetsDialog({ view, saveSettings, show, onSync, onClose }: {
  view: SettingsView; saveSettings: (mutate: (settings: Settings) => void) => Promise<boolean>;
  show: (message: string, kind?: 'info' | 'error') => void; onSync: () => Promise<SettingsView>;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = dialogRef.current; if (dialog && !dialog.open) dialog.showModal(); }, []);
  const [form, setForm] = useState<CustomTarget>(emptyTarget());
  const [matchText, setMatchText] = useState('');
  const [open, setOpen] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const edit = (target: TargetInfo) => {
    setForm({ id: target.id, name: target.name, openUrl: target.openUrl, match: target.match, capability: target.capability, selectors: { ...target.selectors } });
    setMatchText(target.match.join('\n'));
    setOpen(true);
    setTimeout(() => nameRef.current?.focus(), 0);
  };
  const slugify = (name: string) => {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'target';
    const ids = new Set(view.targets.map(target => target.id));
    let id = base;
    let counter = 2;
    while (ids.has(id)) id = `${base}-${counter++}`;
    return id;
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setSaveError('');
    const target: CustomTarget = {
      ...form, id: form.id || slugify(form.name), name: form.name.trim(), openUrl: form.openUrl.trim(),
      match: matchText.split('\n').map(line => line.trim()).filter(Boolean),
      selectors: { input: form.selectors.input.trim(), submit: form.selectors.submit.trim() },
    };
    const saved = await saveSettings(settings => {
      settings.targets.custom = settings.targets.custom.filter(item => item.id !== target.id);
      settings.targets.custom.push(target);
    });
    setSaving(false);
    if (!saved) { setSaveError('未能保存，请重试。填写的内容已保留。'); return; }
    setForm(emptyTarget()); setMatchText(''); setOpen(false);
  };

  return (
    <dialog className="wide" ref={dialogRef} onClose={onClose} aria-labelledby="targets-heading">
      <div className="dialog-head">
        <h3 id="targets-heading">AI 目标与发送行为</h3>
        <button type="button" className="icon-close" aria-label="关闭" onClick={() => dialogRef.current?.close()}>×</button>
      </div>
      <p className="lead">填入和发送需要访问目标网站的权限。目标选择规则：当前窗口最左侧匹配的标签页，没有则在来源标签右侧新建。</p>
      <label className="field"><span>默认目标</span>
        <select value={view.settings.defaultTargetId} onChange={event => {
          const value = event.target.value;
          void saveSettings(settings => { settings.defaultTargetId = value; });
        }}>
          {view.targets.map(target => <option key={target.id} value={target.id}>{target.name}</option>)}
        </select>
      </label>
      <div className="target-list">
        {view.targets.map(target => (
          <div key={target.id} className="target-card">
            <div className="target-head"><strong>{target.name}</strong><span className="muted">{target.openUrl}</span></div>
            <div className="target-controls">
              {target.builtin ? (
                <select aria-label={`${target.name} 的能力`} value={target.capability} onChange={event => {
                  const value = event.target.value as Capability;
                  void saveSettings(settings => { settings.targets.enabled[target.id] = value; });
                }}>
                  {(Object.keys(CAPABILITY_LABEL) as Capability[]).map(value => <option key={value} value={value}>{CAPABILITY_LABEL[value]}</option>)}
                </select>
              ) : <span className="pill muted">{CAPABILITY_LABEL[target.capability]}</span>}
              <span className={`pill ${target.granted ? 'ok' : 'warn'}`}>{target.granted ? '网站权限已允许' : '未允许访问网站'}</span>
              {!target.granted && target.capability !== 'navigate' && (
                <button type="button" className="button small" onClick={async () => {
                  const granted = await chrome.permissions.request({ origins: target.origins });
                  if (granted) { await onSync(); show(`已允许访问 ${target.name}。`); } else show('未获得权限。', 'error');
                }}>允许访问</button>
              )}
              {!target.builtin && (
                <>
                  <button type="button" className="link" onClick={() => edit(target)}>编辑</button>
                  <button type="button" className="link danger" onClick={() => saveSettings(settings => {
                    settings.targets.custom = settings.targets.custom.filter(item => item.id !== target.id);
                    if (settings.defaultTargetId === target.id) settings.defaultTargetId = view.targets.find(item => item.builtin)!.id;
                  })}>删除</button>
                </>
              )}
            </div>
            <p className="muted small-text">匹配：{target.match.join('，')}</p>
          </div>
        ))}
      </div>
      <details className="advanced" open={open} onToggle={event => setOpen((event.target as HTMLDetailsElement).open)}>
        <summary>添加自定义目标</summary>
        <form className="target-form" onSubmit={submit}>
          <label className="field"><span>名称</span><input ref={nameRef} required maxLength={40} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
          <label className="field"><span>打开地址</span><input type="url" required placeholder="https://example.com/chat" value={form.openUrl} onChange={event => setForm({ ...form, openUrl: event.target.value })} /></label>
          <label className="field"><span>匹配规则（每行一个，* 为通配）</span><textarea rows={2} placeholder="https://example.com/chat/*" value={matchText} onChange={event => setMatchText(event.target.value)} /></label>
          <label className="field"><span>能力</span>
            <select value={form.capability} onChange={event => setForm({ ...form, capability: event.target.value as Capability })}>
              {(Object.keys(CAPABILITY_LABEL) as Capability[]).map(value => <option key={value} value={value}>{CAPABILITY_LABEL[value]}</option>)}
            </select>
          </label>
          <label className="field"><span>输入框选择器（可选）</span><input placeholder="textarea, [contenteditable=true]" value={form.selectors.input} onChange={event => setForm({ ...form, selectors: { ...form.selectors, input: event.target.value } })} /></label>
          <label className="field"><span>发送按钮选择器（可选）</span><input placeholder="button[type=submit]" value={form.selectors.submit} onChange={event => setForm({ ...form, selectors: { ...form.selectors, submit: event.target.value } })} /></label>
          {saveError && <p className="form-error" role="alert">{saveError}</p>}
          <div className="form-buttons">
            <button className="button" type="submit" disabled={saving}>{saving ? '保存中…' : '保存目标'}</button>
            <button className="button subtle" type="button" onClick={() => { setForm(emptyTarget()); setMatchText(''); }}>清空</button>
          </div>
        </form>
      </details>

      <h4>发送行为</h4>
      <label className="toggle">
        <input type="checkbox" checked={view.settings.returnAfterSend} onChange={event => {
          const checked = event.target.checked;
          void saveSettings(settings => { settings.returnAfterSend = checked; });
        }} />
        <span><strong>发送后返回来源页</strong><small>确认消息提交后回到原标签页；默认停留在 AI 页面。“仅填入”始终停留。</small></span>
      </label>
    </dialog>
  );
}

function Recorder({ view, platform, recording, setRecording, onSaveWeb, onNative }: {
  view: SettingsView; platform: string;
  recording: { action: ActionInfo; combo: string | null; note: string };
  setRecording: (value: { action: ActionInfo; combo: string | null; note: string } | null) => void;
  onSaveWeb: () => void; onNative: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; if (dialog && !dialog.open) dialog.showModal(); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      const combo = comboFromEvent(event, platform);
      if (!combo) {
        if (!['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) setRecording({ ...recording, note: '需要 Ctrl / Alt / Command 等修饰键加一个按键。' });
        return;
      }
      const taken = view.actions.find(item => item.id !== recording.action.id && (item.nativeCombo === combo || item.webBinding === combo));
      const notes: string[] = [];
      if (taken) notes.push(`该组合已用于“${taken.name}”，保存后会冲突。`);
      const reserved = reservedReason(combo, platform);
      if (reserved) notes.push(reserved);
      notes.push(nativeEligible(combo, platform)
        ? 'Chrome 支持此组合：推荐在 Chrome 快捷键页设置为浏览器快捷键，全局生效；也可仅在网页内使用。'
        : 'Chrome 原生不支持此组合，将作为网页快捷键，仅在允许注入脚本的网页内生效。');
      if (/Ctrl\+(Shift\+)?Minus$/.test(combo) && platform !== 'mac') notes.push('Windows / Linux 上将替代“缩小页面”的浏览器快捷键。');
      setRecording({ ...recording, combo, note: notes.join(' ') });
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [view, platform, recording, setRecording]);

  const nativeOk = recording.combo ? nativeEligible(recording.combo, platform) : false;
  return (
    <dialog ref={ref} onClose={() => setRecording(null)}>
      <h3>录入快捷键：{recording.action.name}</h3>
      <p>按下想要的组合键。录入期间不会执行任何动作。</p>
      <p className="combo">{recording.combo ? displayCombo(recording.combo, platform) : '等待按键…'}</p>
      <p className="note">{recording.note}</p>
      <div className="form-buttons">
        {nativeOk && recording.action.command && <button className="button" type="button" onClick={onNative}>在 Chrome 中设置此组合 ↗</button>}
        {recording.combo && webEligible(recording.combo) && <button className="button" type="button" onClick={onSaveWeb}>{nativeOk ? '仅网页内使用' : '保存并启用网页快捷键'}</button>}
        <button className="button subtle" type="button" onClick={() => ref.current?.close()}>取消</button>
      </div>
    </dialog>
  );
}
